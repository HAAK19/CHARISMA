import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  Fingerprint,
  Globe,
  Lock,
  MessageSquare,
  Palette,
  Phone,
  Radio,
  Server,
  Settings,
  Shield,
  Users,
  X,
} from 'lucide-react';
import { NostrEvent } from 'nostr-tools/pure';
import {
  AppLanguage,
  CallLogEntry,
  ChatMessage,
  Conversation,
  CustomizationConfig,
  DecryptedAccountSecrets,
  EncryptedEnvelopePayload,
  FriendRequestRecord,
  InAppNotificationItem,
  LocalKeyBundle,
  MessageAttachment,
  MessageKind,
  PrivacyPlusConfig,
  PublicUser,
  RelayConfig,
  SavedThemePreset,
  StorySlide,
  VaultItem,
} from './types/charisma';
import { TRANSLATIONS } from './i18n/translations';
import {
  DEFAULT_CUSTOMIZATION,
  DEFAULT_PRIVACY,
  localDb,
  toPublicUser,
} from './storage/localDb';
import {
  decryptEnvelope,
  encryptEnvelope,
  hashPin,
  sha256Hex,
} from './crypto/charismaCrypto';
import {
  encodeNpub,
  parseNostrPublicIdentifier,
} from './nostr/nostrIdentity';
import {
  buildContactListEvent,
  buildNip17DirectMessageWraps,
  buildNip59SignalWrap,
  buildProfileMetadataEvent,
  buildRelayListEvent,
  CharismaNostrSignal,
  unwrapNip17OrNip59Event,
} from './nostr/nostrProtocol';
import { DEFAULT_NOSTR_RELAYS, NostrRelayPool, pingRelayUrl } from './nostr/nostrRelayPool';
import { verifyBiometricLock } from './utils/biometricLock';
import {
  applyThemeToDocument,
  getPageCardStyle,
  getPageShellStyle,
  normalizeCustomization,
} from './utils/themeEngine';
import { AuthScreen } from './components/AuthScreen';
import { ChatsView } from './components/ChatsView';
import { ContactsView } from './components/ContactsView';
import { StoriesChannelsView } from './components/StoriesChannelsView';
import { ActiveCallSession, CallsView } from './components/CallsView';
import { HubView, TransferProgressState } from './components/HubView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { RelaysModal } from './components/RelaysModal';
import { SettingsStudioModal } from './components/SettingsStudioModal';
import { ThemeStudioModal } from './components/ThemeStudioModal';

type MainTab = 'chats' | 'contacts' | 'stories' | 'calls' | 'hub';

const LOCAL_MESH_CHANNEL = 'charisma_local_mesh_v1';

export default function App() {
  const [booting, setBooting] = useState(true);
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [customization, setCustomization] = useState<CustomizationConfig>(DEFAULT_CUSTOMIZATION);
  const [livePreviewCustomization, setLivePreviewCustomization] = useState<CustomizationConfig | null>(null);
  const [privacy, setPrivacy] = useState<PrivacyPlusConfig>(DEFAULT_PRIVACY);

  // Local Unlocked Session State (Held in RAM only, never sent to any server)
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [keyBundle, setKeyBundle] = useState<LocalKeyBundle | null>(null);
  const [dataMasterKeyB64, setDataMasterKeyB64] = useState<string | null>(null);
  const [nostrPrivateKeyHex, setNostrPrivateKeyHex] = useState<string | null>(null);
  const [nsec, setNsec] = useState<string | null>(null);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);

  // Decentralized Nostr Relays & Offline Outbox
  const [relays, setRelays] = useState<RelayConfig[]>(DEFAULT_NOSTR_RELAYS);
  const [outboxCount, setOutboxCount] = useState(0);
  const [showRelaysModal, setShowRelaysModal] = useState(false);

  // App Lock
  const [appLocked, setAppLocked] = useState(false);
  const [appPinInput, setAppPinInput] = useState('');
  const [appLockError, setAppLockError] = useState<string | null>(null);

  // Navigation & Local Data
  const [activeTab, setActiveTab] = useState<MainTab>('chats');
  const [showSettings, setShowSettings] = useState(false);
  const [showThemeStudio, setShowThemeStudio] = useState(false);
  const [savedThemes, setSavedThemes] = useState<SavedThemePreset[]>([]);
  const [notifications, setNotifications] = useState<InAppNotificationItem[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<PublicUser[]>([]);
  const [allAccountsPublic, setAllAccountsPublic] = useState<PublicUser[]>([]);
  const [friendRequests, setFriendRequests] = useState<{
    incoming: FriendRequestRecord[];
    outgoing: FriendRequestRecord[];
  }>({ incoming: [], outgoing: [] });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stories, setStories] = useState<StorySlide[]>([]);
  const [callLogs, setCallLogs] = useState<CallLogEntry[]>([]);
  const [vaultItems, setVaultItems] = useState<VaultItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [pendingInspectPeer, setPendingInspectPeer] = useState<PublicUser | null>(null);

  // Local BroadcastChannel Bus + Decentralized Nostr Relay Pool
  const meshRef = useRef<BroadcastChannel | null>(null);
  const relayPoolRef = useRef<NostrRelayPool | null>(null);
  const seenWrapIdsRef = useRef<Set<string>>(new Set());
  const flushingOutboxRef = useRef(false);
  const deepLinkHandledRef = useRef(false);

  // WebRTC Calling (Signaled over NIP-59 or Local BroadcastChannel; configurable STUN/TURN)
  const [activeCall, setActiveCall] = useState<ActiveCallSession | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const callPcRef = useRef<RTCPeerConnection | null>(null);
  const pendingOfferRef = useRef<{
    fromUserId: string;
    sdp: RTCSessionDescriptionInit;
    kind: 'audio' | 'video';
    callId: string;
  } | null>(null);

  // WebRTC Direct Transfer
  const [transferState, setTransferState] = useState<TransferProgressState | null>(null);
  const transferPcRef = useRef<RTCPeerConnection | null>(null);

  // Latest state refs
  const directoryRef = useRef(directoryUsers);
  directoryRef.current = directoryUsers;
  const keyBundleRef = useRef(keyBundle);
  keyBundleRef.current = keyBundle;
  const masterKeyRef = useRef(dataMasterKeyB64);
  masterKeyRef.current = dataMasterKeyB64;
  const nostrSkRef = useRef(nostrPrivateKeyHex);
  nostrSkRef.current = nostrPrivateKeyHex;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const privacyRef = useRef(privacy);
  privacyRef.current = privacy;
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const relaysRef = useRef(relays);
  relaysRef.current = relays;

  const t = TRANSLATIONS[language];

  const effectiveCustomization = livePreviewCustomization || customization;

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);

  useEffect(() => {
    applyThemeToDocument(effectiveCustomization);
  }, [effectiveCustomization]);

  const pushInAppNotification = useCallback(
    (title: string, body: string, kind: InAppNotificationItem['kind'] = 'theme') => {
      const id = `notif_${crypto.randomUUID()}`;
      setNotifications((prev) => [{ id, title, body, kind, createdAt: Date.now() }, ...prev].slice(0, 3));
      window.setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
      }, 4500);
    },
    [],
  );

  // Initial language & global appearance load
  useEffect(() => {
    (async () => {
      try {
        const [lang, cust] = await Promise.all([
          localDb.getLanguage(),
          localDb.getCustomization(),
        ]);
        if (lang) setLanguage(lang);
        if (cust) setCustomization(cust);
      } catch {
        // Fallback cleanly to defaults if IndexedDB is temporarily unavailable
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // Disappearing message timer loop
  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setMessages((prev) => {
        let changed = false;
        const next = prev.filter((m) => {
          if (m.expiresAt && now >= m.expiresAt) {
            changed = true;
            localDb.deleteMessage(currentUser.userId, m.msgId);
            return false;
          }
          return true;
        });
        return changed ? next : prev;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [currentUser]);

  const getRtcConfiguration = useCallback((): RTCConfiguration => {
    const p = privacyRef.current;
    const iceServers: RTCIceServer[] = [];
    if (p.stunServerUrl?.trim()) {
      iceServers.push({ urls: p.stunServerUrl.trim() });
    }
    if (p.customTurnUrl?.trim()) {
      iceServers.push({
        urls: p.customTurnUrl.trim(),
        username: p.customTurnUsername?.trim() || undefined,
        credential: p.customTurnCredential || undefined,
      });
    }
    return { iceServers };
  }, []);

  const refreshDirectory = useCallback(async (query = '') => {
    const me = currentUserRef.current;
    if (!me) return;
    const [allAccounts, nostrPeers, reqs] = await Promise.all([
      localDb.listLocalAccounts(),
      localDb.listNostrPeers(),
      localDb.listFriendRequests(me.userId),
    ]);
    const myFreshRecord = allAccounts.find((acc) => acc.userId === me.userId);
    let freshMe = me;
    if (myFreshRecord) {
      freshMe = toPublicUser(myFreshRecord, true);
      setCurrentUser(freshMe);
      setBlockedUserIds(freshMe.blockedUserIds);
    }

    const localPublic = allAccounts
      .filter((acc) => acc.userId !== me.userId)
      .map((acc) => toPublicUser(acc, true));

    const seenPubkeys = new Set<string>(
      [freshMe.nostrPubkeyHex, ...localPublic.map((u) => u.nostrPubkeyHex)]
        .filter(Boolean)
        .map((pk) => pk.toLowerCase()),
    );

    const remotePublic = nostrPeers.filter(
      (p) => p.nostrPubkeyHex && !seenPubkeys.has(p.nostrPubkeyHex.toLowerCase()),
    );

    const allPublic = [...localPublic, ...remotePublic];
    setAllAccountsPublic(allPublic);
    setFriendRequests(reqs);

    const q = query.trim().toLowerCase().replace(/^@/, '');
    const peers = allPublic
      .filter((u) => !u.blockedUserIds.includes(me.userId))
      .filter(
        (u) =>
          !q ||
          u.username.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q) ||
          u.userId.toLowerCase().includes(q) ||
          (u.npub || '').toLowerCase().includes(q) ||
          (u.nostrPubkeyHex || '').toLowerCase() === q,
      );
    setDirectoryUsers(peers);
  }, []);

  const broadcastMesh = useCallback((event: string, data: unknown) => {
    try {
      meshRef.current?.postMessage({ event, data });
    } catch {
      // Ignore if BroadcastChannel is unavailable
    }
  }, []);

  const refreshOutboxCount = useCallback(async () => {
    const me = currentUserRef.current;
    if (!me) return;
    const pending = await localDb.listPendingNostrWraps(me.userId);
    setOutboxCount(pending.length);
  }, []);

  const publishNostrEventWithOutbox = useCallback(
    async (
      event: NostrEvent,
      explicitRelays?: string[],
    ): Promise<{ publishedRelays: string[]; failedRelays: string[] }> => {
      const pool = relayPoolRef.current;
      const me = currentUserRef.current;
      if (!pool) {
        if (me) {
          await localDb.savePendingNostrWrap(me.userId, event, explicitRelays);
          await refreshOutboxCount();
        }
        return { publishedRelays: [], failedRelays: explicitRelays || [] };
      }

      const res = await pool.publishEvent(event, explicitRelays);
      if (res.publishedRelays.length === 0 && me) {
        await localDb.savePendingNostrWrap(me.userId, event, explicitRelays);
        await refreshOutboxCount();
      }
      return res;
    },
    [refreshOutboxCount],
  );

  const flushNostrOutbox = useCallback(async () => {
    const me = currentUserRef.current;
    const pool = relayPoolRef.current;
    if (!me || !pool || flushingOutboxRef.current) return;
    if (pool.getConnectedUrls('write').length === 0) return;

    flushingOutboxRef.current = true;
    try {
      const pending = await localDb.listPendingNostrWraps(me.userId);
      for (const item of pending) {
        const res = await pool.publishEvent(
          item.wrapEvent,
          item.targetRelays.length > 0 ? item.targetRelays : undefined,
        );
        if (res.publishedRelays.length > 0) {
          await localDb.deletePendingNostrWrap(item.eventId);
        }
      }
      const remaining = await localDb.listPendingNostrWraps(me.userId);
      setOutboxCount(remaining.length);
    } finally {
      flushingOutboxRef.current = false;
    }
  }, []);

  const sendNostrSignalToPeer = useCallback(
    async (peer: PublicUser, signal: CharismaNostrSignal, queueIfOffline = true) => {
      const skHex = nostrSkRef.current;
      if (!skHex || !peer.nostrPubkeyHex || peer.userId === currentUserRef.current?.userId) return;
      const wrap = buildNip59SignalWrap(skHex, peer.nostrPubkeyHex, signal);
      const targets =
        peer.relayHints && peer.relayHints.length > 0
          ? Array.from(new Set([...(relayPoolRef.current?.getConnectedUrls('write') || []), ...peer.relayHints]))
          : undefined;
      if (queueIfOffline) {
        await publishNostrEventWithOutbox(wrap, targets);
      } else {
        await relayPoolRef.current?.publishEvent(wrap, targets, 3000);
      }
    },
    [publishNostrEventWithOutbox],
  );

  const ensureNostrPeerFromMetadata = useCallback(
    async (
      pubkeyHex: string,
      kind0Content?: string,
      fallback?: Partial<PublicUser>,
    ): Promise<PublicUser> => {
      const cleanHex = pubkeyHex.trim().toLowerCase();
      const [localAccounts, existingRemote] = await Promise.all([
        localDb.listLocalAccounts(),
        localDb.getNostrPeerByPubkey(cleanHex),
      ]);

      const localMatch = localAccounts.find(
        (a) => (a.nostrPubkeyHex || '').toLowerCase() === cleanHex,
      );
      if (localMatch) {
        return toPublicUser(localMatch, true);
      }

      let meta: Record<string, unknown> = {};
      if (kind0Content) {
        try {
          meta = JSON.parse(kind0Content) as Record<string, unknown>;
        } catch {
          // Ignore invalid JSON kind:0 content
        }
      }

      const npub = encodeNpub(cleanHex);
      const shortHex = cleanHex.slice(0, 8);
      const rawName =
        (typeof meta.name === 'string' && meta.name.trim()) ||
        fallback?.username ||
        existingRemote?.username ||
        `nostr_${shortHex}`;
      const normalizedUsername =
        rawName.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24) || `nostr_${shortHex}`;
      const displayName =
        (typeof meta.display_name === 'string' && meta.display_name.trim()) ||
        (typeof meta.name === 'string' && meta.name.trim()) ||
        fallback?.displayName ||
        existingRemote?.displayName ||
        `Nostr (${npub.slice(0, 12)}…)`;
      const bio =
        (typeof meta.about === 'string' ? meta.about : undefined) ??
        fallback?.bio ??
        existingRemote?.bio ??
        '';
      const picture =
        (typeof meta.picture === 'string' && /^https?:\/\//i.test(meta.picture)
          ? meta.picture
          : undefined) ||
        fallback?.avatarDataUrl ||
        existingRemote?.avatarDataUrl;
      const allowSearchByDisplayName =
        typeof meta.charisma_search_dn === 'boolean'
          ? meta.charisma_search_dn
          : (fallback?.allowSearchByDisplayName ?? existingRemote?.allowSearchByDisplayName ?? true);

      const palette = ['#00E5FF', '#9D4EDD', '#2DD4BF', '#38BDF8', '#F472B6', '#FB923C'];
      const colorIdx = parseInt(cleanHex.slice(0, 2), 16) % palette.length;

      const peer: PublicUser = {
        userId: existingRemote?.userId || `nostr_${cleanHex}`,
        nostrPubkeyHex: cleanHex,
        npub,
        username: normalizedUsername,
        displayName,
        bio,
        hideOnline: existingRemote?.hideOnline ?? true,
        hideLastSeen: existingRemote?.hideLastSeen ?? true,
        allowSearchByDisplayName,
        avatarColor: existingRemote?.avatarColor || fallback?.avatarColor || palette[colorIdx],
        avatarEmoji: existingRemote?.avatarEmoji || fallback?.avatarEmoji || '◈',
        avatarDataUrl: picture,
        ecdhPublicKeyJwk: fallback?.ecdhPublicKeyJwk || existingRemote?.ecdhPublicKeyJwk || { kty: 'EC', crv: 'P-256', x: cleanHex.slice(0, 32) },
        ecdsaPublicKeyJwk: fallback?.ecdsaPublicKeyJwk || existingRemote?.ecdsaPublicKeyJwk || { kty: 'EC', crv: 'P-256', x: cleanHex.slice(32, 64) },
        isOnline: existingRemote?.isOnline ?? false,
        lastSeenAt: existingRemote?.lastSeenAt ?? null,
        blockedUserIds: existingRemote?.blockedUserIds || [],
        friendIds: existingRemote?.friendIds || [],
        relayHints:
          fallback?.relayHints && fallback.relayHints.length > 0
            ? fallback.relayHints
            : (existingRemote?.relayHints || []),
      };

      await localDb.upsertNostrPeer(peer);
      await refreshDirectory('');
      return peer;
    },
    [refreshDirectory],
  );

  const sendEncryptedToPeer = useCallback(
    async (
      peer: PublicUser,
      convId: string,
      envelopeId: string,
      envelopeType: EncryptedEnvelopePayload['envelopeType'],
      plaintextObj: unknown,
    ) => {
      const bundle = keyBundleRef.current;
      const me = currentUserRef.current;
      if (!bundle || !me) return;
      if (peer.userId === me.userId) return; // Note-to-Self stays inside own encrypted store
      // Remote Nostr peers without valid local P-256 JWK communicate strictly via NIP-17/NIP-59
      if (peer.userId.startsWith('nostr_') && !peer.ecdhPublicKeyJwk?.y) return;

      const encryptedPayload = await encryptEnvelope(
        bundle,
        peer.ecdhPublicKeyJwk,
        envelopeType,
        plaintextObj,
      );

      const envelope = {
        envelopeId,
        fromUserId: me.userId,
        toUserId: peer.userId,
        payload: encryptedPayload,
        queuedAt: Date.now(),
      };

      // Persist opaque E2EE envelope locally for offline recipient profile on same device & notify open local tab
      await localDb.enqueueLocalEnvelope(envelope);
      broadcastMesh('relay:envelope', envelope);
    },
    [broadcastMesh],
  );

  const handleIncomingEnvelope = useCallback(
    async (envelope: {
      envelopeId: string;
      fromUserId: string;
      toUserId?: string;
      payload: EncryptedEnvelopePayload;
    }) => {
      const bundle = keyBundleRef.current;
      const mk = masterKeyRef.current;
      const me = currentUserRef.current;
      if (!bundle || !mk || !me) return;
      if (envelope.toUserId && envelope.toUserId !== me.userId) return;
      if (me.blockedUserIds.includes(envelope.fromUserId)) return;

      let sender = directoryRef.current.find((u) => u.userId === envelope.fromUserId);
      if (!sender) {
        await refreshDirectory('');
        sender = directoryRef.current.find((u) => u.userId === envelope.fromUserId);
      }

      try {
        const plain = await decryptEnvelope<Record<string, unknown>>(
          bundle,
          envelope.payload,
          sender?.ecdsaPublicKeyJwk,
        );

        const type = envelope.payload.envelopeType;
        if (type === 'message') {
          const convId =
            typeof plain.groupConvId === 'string'
              ? plain.groupConvId
              : `dm_${[me.userId, envelope.fromUserId].sort().join('_')}`;

          const existingConv = conversationsRef.current.find((c) => c.convId === convId);
          const disappearSec = existingConv?.disappearTtlSec || 0;

          const incomingMsg: ChatMessage = {
            msgId: String(plain.msgId || envelope.envelopeId),
            convId,
            senderId: envelope.fromUserId,
            senderName: sender?.displayName || String(plain.senderName || 'Contact'),
            kind: (plain.kind as MessageKind) || 'text',
            text: String(plain.text || ''),
            attachment: plain.attachment as MessageAttachment | undefined,
            replyTo: plain.replyTo as ChatMessage['replyTo'],
            forwardedFrom: plain.forwardedFrom as string | undefined,
            reactions: {},
            status: 'delivered',
            isStarred: false,
            isPinned: false,
            expiresAt: disappearSec > 0 ? Date.now() + disappearSec * 1000 : undefined,
            createdAt: Number(plain.createdAt || Date.now()),
          };

          await localDb.saveMessage(me.userId, mk, incomingMsg);
          setMessages((prev) =>
            prev.some((m) => m.msgId === incomingMsg.msgId) ? prev : [...prev, incomingMsg],
          );

          const updatedConv: Conversation = existingConv
            ? {
                ...existingConv,
                lastMessagePreview: incomingMsg.text || incomingMsg.kind,
                lastMessageAt: incomingMsg.createdAt,
                unreadCount: existingConv.unreadCount + 1,
              }
            : {
                convId,
                type: plain.groupConvId ? 'group' : 'direct',
                peerUserId: plain.groupConvId ? undefined : envelope.fromUserId,
                title: String(plain.groupTitle || sender?.displayName || 'Contact'),
                avatarColor: sender?.avatarColor || '#00E5FF',
                avatarEmoji: sender?.avatarEmoji || '◈',
                memberIds: Array.isArray(plain.memberIds)
                  ? (plain.memberIds as string[])
                  : [me.userId, envelope.fromUserId],
                adminIds: [envelope.fromUserId],
                lastMessagePreview: incomingMsg.text || incomingMsg.kind,
                lastMessageAt: incomingMsg.createdAt,
                unreadCount: 1,
                isPinned: false,
                isArchived: false,
                isMuted: false,
                isLocked: false,
                disappearTtlSec: 0,
                draftText: '',
                typingUserIds: [],
                recordingUserIds: [],
              };

          await localDb.saveConversation(me.userId, mk, updatedConv);
          setConversations((prev) => {
            const exists = prev.some((c) => c.convId === updatedConv.convId);
            return exists
              ? prev.map((c) => (c.convId === updatedConv.convId ? updatedConv : c))
              : [updatedConv, ...prev];
          });

          if (!existingConv?.isMuted) {
            pushInAppNotification(
              incomingMsg.senderName,
              privacyRef.current.hideNotificationPreviews
                ? (language === 'ar' ? 'رسالة مشفرة جديدة' : 'New encrypted message')
                : incomingMsg.text || incomingMsg.kind,
              'message',
            );
          }

          if (sender) {
            await sendEncryptedToPeer(sender, convId, `ack_${incomingMsg.msgId}`, 'ack', {
              msgId: incomingMsg.msgId,
              status: privacyRef.current.sendReadReceipts ? 'read' : 'delivered',
            });

            if (privacyRef.current.autoReplyEnabled && privacyRef.current.autoReplyText.trim()) {
              const autoMsgId = `msg_${crypto.randomUUID()}`;
              const autoMsg: ChatMessage = {
                msgId: autoMsgId,
                convId,
                senderId: me.userId,
                senderName: me.displayName,
                kind: 'text',
                text: privacyRef.current.autoReplyText,
                reactions: {},
                status: 'sent',
                isStarred: false,
                isPinned: false,
                createdAt: Date.now(),
              };
              await localDb.saveMessage(me.userId, mk, autoMsg);
              setMessages((prev) => [...prev, autoMsg]);
              await sendEncryptedToPeer(sender, convId, autoMsgId, 'message', autoMsg);
            }
          }
        } else if (type === 'ack') {
          const targetId = String(plain.msgId || '');
          const nextStatus = plain.status === 'read' ? 'read' : 'delivered';
          setMessages((prev) =>
            prev.map((m) => {
              if (m.msgId === targetId) {
                const updated = { ...m, status: nextStatus as ChatMessage['status'] };
                localDb.saveMessage(me.userId, mk, updated);
                return updated;
              }
              return m;
            }),
          );
        } else if (type === 'typing' || type === 'recording') {
          const convId = String(plain.convId || `dm_${[me.userId, envelope.fromUserId].sort().join('_')}`);
          const active = Boolean(plain.active);
          setConversations((prev) =>
            prev.map((c) => {
              if (c.convId !== convId) return c;
              const field = type === 'typing' ? 'typingUserIds' : 'recordingUserIds';
              const currentList = c[field];
              const nextList = active
                ? Array.from(new Set([...currentList, envelope.fromUserId]))
                : currentList.filter((id) => id !== envelope.fromUserId);
              return { ...c, [field]: nextList };
            }),
          );
        } else if (type === 'edit') {
          const targetId = String(plain.msgId || '');
          const newText = String(plain.text || '');
          setMessages((prev) =>
            prev.map((m) => {
              if (m.msgId === targetId) {
                const updated = { ...m, text: newText, editedAt: Date.now() };
                localDb.saveMessage(me.userId, mk, updated);
                return updated;
              }
              return m;
            }),
          );
        } else if (type === 'delete_request') {
          const targetId = String(plain.msgId || '');
          setMessages((prev) =>
            prev.map((m) => {
              if (m.msgId === targetId) {
                const updated = { ...m, deletedForEveryone: true, text: '' };
                localDb.saveMessage(me.userId, mk, updated);
                return updated;
              }
              return m;
            }),
          );
        } else if (type === 'reaction') {
          const targetId = String(plain.msgId || '');
          const emoji = String(plain.emoji || '👍');
          setMessages((prev) =>
            prev.map((m) => {
              if (m.msgId !== targetId) return m;
              const list = m.reactions[emoji] || [];
              const nextList = list.includes(envelope.fromUserId)
                ? list.filter((id) => id !== envelope.fromUserId)
                : [...list, envelope.fromUserId];
              const updated = { ...m, reactions: { ...m.reactions, [emoji]: nextList } };
              localDb.saveMessage(me.userId, mk, updated);
              return updated;
            }),
          );
        }
      } catch {
        // Ignore undecryptable or tampered envelope
      }
    },
    [refreshDirectory, sendEncryptedToPeer],
  );

  // P2P WebRTC Signaling Handler (BroadcastChannel + Encrypted Nostr NIP-59 Wraps)
  const dispatchRtcSignal = useCallback(
    async (
      peer: PublicUser,
      signal: Record<string, unknown>,
      nostrSignal: CharismaNostrSignal,
    ) => {
      broadcastMesh('rtc:signal', signal);
      if (peer.nostrPubkeyHex && !peer.userId.startsWith('usr_offline')) {
        await sendNostrSignalToPeer(peer, nostrSignal, false);
      }
    },
    [broadcastMesh, sendNostrSignalToPeer],
  );

  const handleRtcSignal = useCallback(
    async (signal: Record<string, unknown>) => {
      const me = currentUserRef.current;
      if (!me) return;
      if (signal.toUserId !== me.userId) return;

      const fromUserId = String(signal.fromUserId || '');
      const kind = String(signal.signalType || '');
      let peer = directoryRef.current.find((u) => u.userId === fromUserId);
      if (!peer && fromUserId.startsWith('nostr_')) {
        peer = await ensureNostrPeerFromMetadata(fromUserId.slice(6));
      }

      const sendReplySignal = async (
        targetPeer: PublicUser | undefined,
        meshPayload: Record<string, unknown>,
        nostrPayload: CharismaNostrSignal,
      ) => {
        broadcastMesh('rtc:signal', meshPayload);
        if (targetPeer?.nostrPubkeyHex) {
          await sendNostrSignalToPeer(targetPeer, nostrPayload, false);
        }
      };

      if (kind === 'call_offer' && peer) {
        const sdp = signal.sdp as RTCSessionDescriptionInit;
        const callKind = signal.callKind === 'video' ? 'video' : 'audio';
        const callId = String(signal.callId || `call_${crypto.randomUUID()}`);
        pendingOfferRef.current = { fromUserId: peer.userId, sdp, kind: callKind, callId };
        setActiveCall({
          callId,
          peer,
          kind: callKind,
          direction: 'incoming',
          state: 'ringing',
          startedAt: Date.now(),
          micMuted: false,
          cameraEnabled: callKind === 'video',
          speakerEnabled: true,
        });
        setActiveTab('calls');
      } else if (kind === 'call_answer' && callPcRef.current) {
        const sdp = signal.sdp as RTCSessionDescriptionInit;
        await callPcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
        setActiveCall((prev) => (prev ? { ...prev, state: 'connected' } : null));
      } else if (kind === 'call_ice' && callPcRef.current) {
        const candidate = signal.candidate as RTCIceCandidateInit;
        if (candidate) await callPcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else if (kind === 'call_hangup') {
        callPcRef.current?.close();
        callPcRef.current = null;
        setActiveCall(null);
      } else if (kind === 'transfer_offer' && peer) {
        const sdp = signal.sdp as RTCSessionDescriptionInit;
        const fileName = String(signal.fileName || 'file.bin');
        const sizeBytes = Number(signal.sizeBytes || 0);
        const transferId = String(signal.transferId || crypto.randomUUID());

        const pc = new RTCPeerConnection(getRtcConfiguration());
        transferPcRef.current = pc;
        const receivedChunks: ArrayBuffer[] = [];
        let receivedBytes = 0;

        setTransferState({
          transferId,
          peerName: peer.displayName,
          fileName,
          sizeBytes,
          transferredBytes: 0,
          direction: 'receive',
          status: 'negotiating',
        });

        pc.onicecandidate = (ev) => {
          if (ev.candidate && peer) {
            const cand = ev.candidate.toJSON();
            sendReplySignal(
              peer,
              {
                fromUserId: me.userId,
                toUserId: peer.userId,
                signalType: 'transfer_ice',
                candidate: cand,
              },
              { signalKind: 'transfer_ice', transferId, candidate: cand },
            );
          }
        };

        pc.ondatachannel = (ev) => {
          const dc = ev.channel;
          dc.binaryType = 'arraybuffer';
          dc.onmessage = async (msgEv) => {
            if (typeof msgEv.data === 'string') {
              const meta = JSON.parse(msgEv.data) as { done?: boolean; expectedSha256?: string };
              if (meta.done) {
                const blob = new Blob(receivedChunks);
                const fullBuf = await blob.arrayBuffer();
                const digest = await sha256Hex(fullBuf);
                const verified = !meta.expectedSha256 || digest === meta.expectedSha256;
                setTransferState((prev) =>
                  prev ? { ...prev, status: verified ? 'verified' : 'error', sha256Hex: digest } : null,
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);
                pc.close();
              }
            } else if (msgEv.data instanceof ArrayBuffer) {
              receivedChunks.push(msgEv.data);
              receivedBytes += msgEv.data.byteLength;
              setTransferState((prev) =>
                prev ? { ...prev, transferredBytes: receivedBytes, status: 'transferring' } : null,
              );
            }
          };
        };

        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendReplySignal(
          peer,
          {
            fromUserId: me.userId,
            toUserId: peer.userId,
            signalType: 'transfer_answer',
            sdp: answer,
          },
          { signalKind: 'transfer_answer', transferId, sdp: answer },
        );
      } else if (kind === 'transfer_answer' && transferPcRef.current) {
        const sdp = signal.sdp as RTCSessionDescriptionInit;
        await transferPcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      } else if (kind === 'transfer_ice' && transferPcRef.current) {
        const candidate = signal.candidate as RTCIceCandidateInit;
        if (candidate) await transferPcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    },
    [broadcastMesh, ensureNostrPeerFromMetadata, getRtcConfiguration, sendNostrSignalToPeer],
  );

  // Process Incoming Decentralized NIP-17 Direct Messages & NIP-59 Encrypted Signals
  const handleIncomingNostrWrap = useCallback(
    async (wrapEvent: NostrEvent) => {
      const me = currentUserRef.current;
      const skHex = nostrSkRef.current;
      const mk = masterKeyRef.current;
      if (!me || !skHex || !mk) return;
      if (seenWrapIdsRef.current.has(wrapEvent.id)) return;
      seenWrapIdsRef.current.add(wrapEvent.id);

      const unwrapped = unwrapNip17OrNip59Event(wrapEvent, skHex);
      if (!unwrapped) return;

      const isSelfSent = unwrapped.senderPubkeyHex === me.nostrPubkeyHex.toLowerCase();
      const counterPubkey = isSelfSent
        ? unwrapped.recipientPubkeys.find((p) => p !== me.nostrPubkeyHex.toLowerCase()) ||
          me.nostrPubkeyHex.toLowerCase()
        : unwrapped.senderPubkeyHex;

      let peer = directoryRef.current.find(
        (u) => u.nostrPubkeyHex?.toLowerCase() === counterPubkey,
      );
      if (!peer) {
        if (counterPubkey === me.nostrPubkeyHex.toLowerCase()) {
          peer = me;
        } else {
          const fallbackMeta =
            unwrapped.signal &&
            (unwrapped.signal.signalKind === 'friend_request' ||
              unwrapped.signal.signalKind === 'friend_accept')
              ? {
                  username: unwrapped.signal.username,
                  displayName: unwrapped.signal.displayName,
                  bio: unwrapped.signal.bio,
                  relayHints: unwrapped.signal.relayHints,
                  ecdhPublicKeyJwk: unwrapped.signal.ecdhPublicKeyJwk,
                  ecdsaPublicKeyJwk: unwrapped.signal.ecdsaPublicKeyJwk,
                }
              : undefined;
          peer = await ensureNostrPeerFromMetadata(counterPubkey, undefined, fallbackMeta);
          // Background NIP-0 metadata enrichment if missing profile details
          if (!fallbackMeta && relayPoolRef.current) {
            relayPoolRef.current
              .queryOnce([{ kinds: [0], authors: [counterPubkey], limit: 1 }], undefined, 2500)
              .then((events) => {
                if (events[0]?.content) {
                  ensureNostrPeerFromMetadata(counterPubkey, events[0].content);
                }
              })
              .catch(() => {});
          }
        }
      }

      if (!isSelfSent && me.blockedUserIds.includes(peer.userId)) return;

      const sig = unwrapped.signal;
      if (sig) {
        if (isSelfSent) return; // Control signals from self are handled directly at origin

        if (sig.signalKind === 'friend_request') {
          await ensureNostrPeerFromMetadata(counterPubkey, undefined, {
            username: sig.username,
            displayName: sig.displayName,
            bio: sig.bio,
            relayHints: sig.relayHints,
            ecdhPublicKeyJwk: sig.ecdhPublicKeyJwk,
            ecdsaPublicKeyJwk: sig.ecdsaPublicKeyJwk,
          });
          await localDb.recordIncomingNostrFriendRequest({
            requestId: sig.requestId,
            fromUserId: peer.userId,
            toUserId: me.userId,
            fromNostrPubkeyHex: counterPubkey,
            toNostrPubkeyHex: me.nostrPubkeyHex,
          });
          await refreshDirectory('');
          pushInAppNotification(
            language === 'ar' ? 'طلب صداقة عبر Nostr' : 'Nostr Friend Request',
            language === 'ar'
              ? `أرسل ${sig.displayName || peer.displayName} طلب صداقة مشفر`
              : `${sig.displayName || peer.displayName} sent an encrypted friend request`,
            'friend',
          );
          return;
        }

        if (sig.signalKind === 'friend_accept') {
          await ensureNostrPeerFromMetadata(counterPubkey, undefined, {
            username: sig.username,
            displayName: sig.displayName,
            bio: sig.bio,
            relayHints: sig.relayHints,
            ecdhPublicKeyJwk: sig.ecdhPublicKeyJwk,
            ecdsaPublicKeyJwk: sig.ecdsaPublicKeyJwk,
          });
          const updatedMe = await localDb.addFriendDirect(me.userId, peer.userId);
          setCurrentUser(updatedMe);
          await refreshDirectory('');
          pushInAppNotification(
            language === 'ar' ? 'تم قبول طلب الصداقة' : 'Friend Request Accepted',
            language === 'ar'
              ? `أصبح ${peer.displayName} صديقك على Nostr`
              : `${peer.displayName} accepted your friend request`,
            'friend',
          );
          return;
        }

        if (sig.signalKind === 'friend_decline') {
          await localDb.declineFriendRequest(sig.requestId, me.userId);
          await refreshDirectory('');
          return;
        }

        if (sig.signalKind === 'reaction') {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.msgId !== sig.targetMsgId && m.nostrRumorId !== sig.targetMsgId) return m;
              const list = m.reactions[sig.emoji] || [];
              const nextList = list.includes(peer!.userId)
                ? list.filter((id) => id !== peer!.userId)
                : [...list, peer!.userId];
              const updated = { ...m, reactions: { ...m.reactions, [sig.emoji]: nextList } };
              localDb.saveMessage(me.userId, mk, updated);
              return updated;
            }),
          );
          return;
        }

        if (sig.signalKind === 'edit') {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.msgId !== sig.targetMsgId && m.nostrRumorId !== sig.targetMsgId) return m;
              const updated = { ...m, text: sig.newText, editedAt: Date.now() };
              localDb.saveMessage(me.userId, mk, updated);
              return updated;
            }),
          );
          return;
        }

        if (sig.signalKind === 'delete') {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.msgId !== sig.targetMsgId && m.nostrRumorId !== sig.targetMsgId) return m;
              const updated = { ...m, deletedForEveryone: true, text: '' };
              localDb.saveMessage(me.userId, mk, updated);
              return updated;
            }),
          );
          return;
        }

        if (sig.signalKind === 'typing' || sig.signalKind === 'recording') {
          const convId = `dm_${[me.userId, peer.userId].sort().join('_')}`;
          setConversations((prev) =>
            prev.map((c) => {
              if (c.convId !== convId) return c;
              const field = sig.signalKind === 'typing' ? 'typingUserIds' : 'recordingUserIds';
              const cur = c[field];
              const next = sig.active
                ? Array.from(new Set([...cur, peer!.userId]))
                : cur.filter((id) => id !== peer!.userId);
              return { ...c, [field]: next };
            }),
          );
          return;
        }

        if (sig.signalKind === 'read_ack') {
          const nextStatus = sig.status === 'read' ? 'read' : 'delivered';
          setMessages((prev) =>
            prev.map((m) => {
              if (m.msgId !== sig.targetMsgId && m.nostrRumorId !== sig.targetMsgId) return m;
              const updated = { ...m, status: nextStatus as ChatMessage['status'] };
              localDb.saveMessage(me.userId, mk, updated);
              return updated;
            }),
          );
          return;
        }

        if (
          sig.signalKind === 'rtc_offer' ||
          sig.signalKind === 'rtc_answer' ||
          sig.signalKind === 'rtc_ice' ||
          sig.signalKind === 'rtc_hangup' ||
          sig.signalKind === 'transfer_offer' ||
          sig.signalKind === 'transfer_answer' ||
          sig.signalKind === 'transfer_ice'
        ) {
          const mapType: Record<string, string> = {
            rtc_offer: 'call_offer',
            rtc_answer: 'call_answer',
            rtc_ice: 'call_ice',
            rtc_hangup: 'call_hangup',
            transfer_offer: 'transfer_offer',
            transfer_answer: 'transfer_answer',
            transfer_ice: 'transfer_ice',
          };
          await handleRtcSignal({
            fromUserId: peer.userId,
            toUserId: me.userId,
            signalType: mapType[sig.signalKind],
            callId: 'callId' in sig ? sig.callId : undefined,
            callKind: 'callKind' in sig ? sig.callKind : undefined,
            transferId: 'transferId' in sig ? sig.transferId : undefined,
            fileName: 'fileName' in sig ? sig.fileName : undefined,
            sizeBytes: 'sizeBytes' in sig ? sig.sizeBytes : undefined,
            sdp: 'sdp' in sig ? sig.sdp : undefined,
            candidate: 'candidate' in sig ? sig.candidate : undefined,
          });
          return;
        }

        if (sig.signalKind === 'attachment') {
          const msgId = sig.msgId || unwrapped.rumorId;
          if (messagesRef.current.some((m) => m.msgId === msgId || m.nostrRumorId === unwrapped.rumorId)) {
            return;
          }

          const sigGroupPubkeys = Array.isArray(sig.memberPubkeys)
            ? Array.from(
                new Set(
                  sig.memberPubkeys
                    .map((pk) => pk.toLowerCase())
                    .filter((pk) => pk !== me.nostrPubkeyHex.toLowerCase()),
                ),
              )
            : [];
          const isGroupAttachment = sigGroupPubkeys.length > 1;
          let convId = `dm_${[me.userId, peer.userId].sort().join('_')}`;
          let resolvedMemberIds = [me.userId, peer.userId];
          let existingConv = conversationsRef.current.find((c) => c.convId === convId);

          if (isGroupAttachment) {
            const otherMembers = await Promise.all(
              sigGroupPubkeys.map((pk) => {
                const known = directoryRef.current.find((u) => u.nostrPubkeyHex?.toLowerCase() === pk);
                return known ? Promise.resolve(known) : ensureNostrPeerFromMetadata(pk);
              }),
            );
            resolvedMemberIds = Array.from(new Set([me.userId, ...otherMembers.map((u) => u.userId)]));
            const sortedMemberKey = resolvedMemberIds.slice().sort().join(',');
            const matchedLocalGroup = conversationsRef.current.find(
              (c) =>
                c.type === 'group' &&
                c.memberIds.slice().sort().join(',') === sortedMemberKey &&
                (!sig.groupTitle || c.title === sig.groupTitle),
            );
            convId =
              matchedLocalGroup?.convId ||
              `nostr_grp_${sigGroupPubkeys.slice().sort().join('_').slice(0, 28)}`;
            existingConv =
              matchedLocalGroup || conversationsRef.current.find((c) => c.convId === convId);
          }

          const disappearSec = existingConv?.disappearTtlSec || 0;
          const incomingMsg: ChatMessage = {
            msgId,
            convId,
            senderId: peer.userId,
            senderName: peer.displayName,
            kind: sig.kind,
            text: sig.text,
            attachment: sig.attachment as unknown as MessageAttachment,
            reactions: {},
            status: 'delivered',
            isStarred: false,
            isPinned: false,
            expiresAt: disappearSec > 0 ? Date.now() + disappearSec * 1000 : undefined,
            createdAt: unwrapped.createdAtMs,
            nostrRumorId: unwrapped.rumorId,
            deliveryMode: 'nip17',
          };
          await localDb.saveMessage(me.userId, mk, incomingMsg);
          setMessages((prev) =>
            prev.some((m) => m.msgId === incomingMsg.msgId) ? prev : [...prev, incomingMsg],
          );

          const updatedConv: Conversation = existingConv
            ? {
                ...existingConv,
                lastMessagePreview: sig.text || sig.kind,
                lastMessageAt: incomingMsg.createdAt,
                unreadCount: existingConv.unreadCount + 1,
              }
            : {
                convId,
                type: isGroupAttachment ? 'group' : 'direct',
                peerUserId: isGroupAttachment ? undefined : peer.userId,
                title: isGroupAttachment ? sig.groupTitle || peer.displayName : peer.displayName,
                avatarColor: isGroupAttachment ? '#9D4EDD' : peer.avatarColor,
                avatarEmoji: isGroupAttachment ? '⬡' : peer.avatarEmoji,
                memberIds: resolvedMemberIds,
                adminIds: [peer.userId],
                lastMessagePreview: sig.text || sig.kind,
                lastMessageAt: incomingMsg.createdAt,
                unreadCount: 1,
                isPinned: false,
                isArchived: false,
                isMuted: false,
                isLocked: false,
                disappearTtlSec: 0,
                draftText: '',
                typingUserIds: [],
                recordingUserIds: [],
              };
          await localDb.saveConversation(me.userId, mk, updatedConv);
          setConversations((prev) =>
            prev.some((c) => c.convId === updatedConv.convId)
              ? prev.map((c) => (c.convId === updatedConv.convId ? updatedConv : c))
              : [updatedConv, ...prev],
          );
          await sendNostrSignalToPeer(
            peer,
            {
              signalKind: 'read_ack',
              targetMsgId: msgId,
              status: privacyRef.current.sendReadReceipts ? 'read' : 'delivered',
            },
            false,
          );
          return;
        }
      }

      // Standard NIP-17 Kind 14 Private Direct Message (Interoperable across Nostr clients)
      if (unwrapped.kind === 14 && unwrapped.text.trim()) {
        if (
          messagesRef.current.some(
            (m) =>
              m.nostrRumorId === unwrapped.rumorId ||
              m.msgId === unwrapped.rumorId ||
              (isSelfSent &&
                m.senderId === me.userId &&
                m.text === unwrapped.text &&
                Math.abs(m.createdAt - unwrapped.createdAtMs) < 10_000),
          )
        ) {
          return;
        }

        const otherPubkeys = Array.from(
          new Set(
            [unwrapped.senderPubkeyHex, ...unwrapped.recipientPubkeys].filter(
              (pk) => pk !== me.nostrPubkeyHex.toLowerCase(),
            ),
          ),
        );
        const isGroupNip17 = otherPubkeys.length > 1;
        const resolvedOtherMembers = isGroupNip17
          ? await Promise.all(
              otherPubkeys.map((pk) => {
                const known = directoryRef.current.find((u) => u.nostrPubkeyHex?.toLowerCase() === pk);
                return known ? Promise.resolve(known) : ensureNostrPeerFromMetadata(pk);
              }),
            )
          : [peer];

        const resolvedMemberIds =
          peer.userId === me.userId
            ? [me.userId]
            : Array.from(new Set([me.userId, ...resolvedOtherMembers.map((u) => u.userId)]));

        let convId =
          peer.userId === me.userId
            ? `self_${me.userId}`
            : isGroupNip17
            ? `nostr_grp_${otherPubkeys.slice().sort().join('_').slice(0, 28)}`
            : `dm_${[me.userId, peer.userId].sort().join('_')}`;

        let existingConv = conversationsRef.current.find((c) => c.convId === convId);
        if (isGroupNip17 && !existingConv) {
          const sortedMemberKey = resolvedMemberIds.slice().sort().join(',');
          existingConv = conversationsRef.current.find(
            (c) =>
              c.type === 'group' &&
              c.memberIds.slice().sort().join(',') === sortedMemberKey &&
              (!unwrapped.conversationTitle || c.title === unwrapped.conversationTitle),
          );
          if (existingConv) convId = existingConv.convId;
        }

        const disappearSec = existingConv?.disappearTtlSec || 0;
        const replyTarget = unwrapped.replyToEventId
          ? messagesRef.current.find(
              (m) =>
                m.nostrRumorId === unwrapped.replyToEventId || m.msgId === unwrapped.replyToEventId,
            )
          : undefined;

        const incomingMsg: ChatMessage = {
          msgId: `nip17_${unwrapped.rumorId.slice(0, 20)}`,
          convId,
          senderId: isSelfSent ? me.userId : peer.userId,
          senderName: isSelfSent ? me.displayName : peer.displayName,
          kind: 'text',
          text: unwrapped.text,
          replyTo: replyTarget
            ? {
                msgId: replyTarget.msgId,
                senderName: replyTarget.senderName,
                previewText: replyTarget.text,
              }
            : undefined,
          reactions: {},
          status: isSelfSent ? 'sent' : 'delivered',
          isStarred: false,
          isPinned: false,
          expiresAt: disappearSec > 0 ? Date.now() + disappearSec * 1000 : undefined,
          createdAt: unwrapped.createdAtMs,
          nostrRumorId: unwrapped.rumorId,
          deliveryMode: 'nip17',
        };

        await localDb.saveMessage(me.userId, mk, incomingMsg);
        setMessages((prev) =>
          prev.some((m) => m.msgId === incomingMsg.msgId || m.nostrRumorId === unwrapped.rumorId)
            ? prev
            : [...prev, incomingMsg],
        );

        const updatedConv: Conversation = existingConv
          ? {
              ...existingConv,
              memberIds: isGroupNip17
                ? Array.from(new Set([...existingConv.memberIds, ...resolvedMemberIds]))
                : existingConv.memberIds,
              lastMessagePreview: incomingMsg.text,
              lastMessageAt: incomingMsg.createdAt,
              unreadCount: isSelfSent ? existingConv.unreadCount : existingConv.unreadCount + 1,
            }
          : {
              convId,
              type: isGroupNip17 ? 'group' : 'direct',
              peerUserId: isGroupNip17 ? undefined : peer.userId,
              title: unwrapped.conversationTitle || peer.displayName,
              avatarColor: isGroupNip17 ? '#9D4EDD' : peer.avatarColor,
              avatarEmoji: isGroupNip17 ? '⬡' : peer.avatarEmoji,
              memberIds: resolvedMemberIds,
              adminIds: [peer.userId],
              lastMessagePreview: incomingMsg.text,
              lastMessageAt: incomingMsg.createdAt,
              unreadCount: isSelfSent ? 0 : 1,
              isPinned: false,
              isArchived: false,
              isMuted: false,
              isLocked: false,
              disappearTtlSec: 0,
              draftText: '',
              typingUserIds: [],
              recordingUserIds: [],
            };

        await localDb.saveConversation(me.userId, mk, updatedConv);
        setConversations((prev) =>
          prev.some((c) => c.convId === updatedConv.convId)
            ? prev.map((c) => (c.convId === updatedConv.convId ? updatedConv : c))
            : [updatedConv, ...prev],
        );

        if (!isSelfSent) {
          if (!existingConv?.isMuted) {
            pushInAppNotification(
              peer.displayName,
              privacyRef.current.hideNotificationPreviews
                ? (language === 'ar' ? 'رسالة مشفرة جديدة عبر Nostr' : 'New Nostr NIP-17 encrypted message')
                : incomingMsg.text,
              'message',
            );
          }

          await sendNostrSignalToPeer(
            peer,
            {
              signalKind: 'read_ack',
              targetMsgId: unwrapped.rumorId,
              status: privacyRef.current.sendReadReceipts ? 'read' : 'delivered',
            },
            false,
          );

          if (privacyRef.current.autoReplyEnabled && privacyRef.current.autoReplyText.trim()) {
            const replyWrapRes = buildNip17DirectMessageWraps(
              skHex,
              [{ publicKey: peer.nostrPubkeyHex }],
              privacyRef.current.autoReplyText,
            );
            for (const w of replyWrapRes.wraps) {
              await publishNostrEventWithOutbox(w);
            }
          }
        }
      }
    },
    [
      ensureNostrPeerFromMetadata,
      handleRtcSignal,
      language,
      publishNostrEventWithOutbox,
      pushInAppNotification,
      refreshDirectory,
      sendNostrSignalToPeer,
    ],
  );

  // Connect Nostr Relay Pool when unlocked & subscribe to NIP-17/NIP-59 kind 1059 gift wraps
  useEffect(() => {
    const userId = currentUser?.userId;
    const myPubkey = currentUser?.nostrPubkeyHex;
    if (!userId || !myPubkey || !nostrPrivateKeyHex || !dataMasterKeyB64) return;

    let cancelled = false;
    let pool: NostrRelayPool | null = null;
    let unsubStatus: (() => void) | null = null;
    let unsubWraps: (() => void) | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const savedRelays = await localDb.getRelays(userId);
      if (cancelled) return;
      setRelays(savedRelays);
      await refreshOutboxCount();

      pool = new NostrRelayPool(savedRelays);
      relayPoolRef.current = pool;

      unsubStatus = pool.onStatusChange((statuses) => {
        if (cancelled) return;
        setRelays(statuses);
        if (statuses.some((r) => r.write && r.status === 'connected')) {
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = setTimeout(() => {
            flushNostrOutbox();
          }, 700);
        }
      });

      // NIP-59 randomizes wrap created_at up to ~48h earlier, so look back 200,000s (~55h)
      const sinceSec = Math.floor(Date.now() / 1000) - 200_000;
      const filter = {
        kinds: [1059],
        '#p': [myPubkey.toLowerCase()],
        since: sinceSec,
      };

      unsubWraps = pool.subscribe([filter], undefined, (event) => {
        handleIncomingNostrWrap(event);
      });

      // Initial catch-up poll shortly after first sockets connect
      setTimeout(() => {
        if (!cancelled && pool) {
          pool.queryOnce([filter], undefined, 4000).then((events) => {
            for (const ev of events) {
              handleIncomingNostrWrap(ev);
            }
          });
          flushNostrOutbox();
        }
      }, 1500);
    })();

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
      unsubWraps?.();
      unsubStatus?.();
      pool?.destroy();
      relayPoolRef.current = null;
    };
  }, [
    currentUser?.userId,
    currentUser?.nostrPubkeyHex,
    nostrPrivateKeyHex,
    dataMasterKeyB64,
    flushNostrOutbox,
    handleIncomingNostrWrap,
    refreshOutboxCount,
  ]);

  // Handle cross-country direct web invite links (?peer=nprofile1... or ?peer=npub1...) once unlocked
  useEffect(() => {
    if (!currentUser || !dataMasterKeyB64 || deepLinkHandledRef.current) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const peerParam = params.get('peer')?.trim();
    if (!peerParam) return;
    deepLinkHandledRef.current = true;

    try {
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', cleanUrl);
    } catch {
      // Ignore history errors in restricted frames
    }

    const timer = window.setTimeout(async () => {
      try {
        const resolved = await handleLookupNostrPubkey(peerParam);
        if (resolved && resolved.userId !== currentUser.userId) {
          setPendingInspectPeer(resolved);
          setActiveTab('contacts');
          pushInAppNotification(
            language === 'ar' ? 'تم استيراد دعوة Nostr' : 'Nostr Peer Imported',
            language === 'ar'
              ? `تم العثور على ${resolved.displayName} (@${resolved.username})`
              : `Loaded profile for ${resolved.displayName} (@${resolved.username})`,
            'friend',
          );
        }
      } catch {
        // Ignore invalid invite tokens
      }
    }, 1000);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.userId, dataMasterKeyB64]);

  // Connect local BroadcastChannel when unlocked
  useEffect(() => {
    if (!currentUser || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(LOCAL_MESH_CHANNEL);
    meshRef.current = channel;

    channel.onmessage = async (ev) => {
      const msg = ev.data as { event?: string; data?: unknown };
      if (!msg?.event) return;
      if (msg.event === 'relay:envelope') {
        const env = msg.data as {
          envelopeId: string;
          fromUserId: string;
          toUserId: string;
          payload: EncryptedEnvelopePayload;
        };
        if (env.toUserId === currentUser.userId) {
          await localDb.consumeLocalEnvelopes(currentUser.userId);
          await handleIncomingEnvelope(env);
        }
      } else if (msg.event === 'rtc:signal') {
        await handleRtcSignal(msg.data as Record<string, unknown>);
      } else if (msg.event === 'directory:refresh') {
        await refreshDirectory('');
      } else if (msg.event === 'friend:sync') {
        const payload = msg.data as {
          action?: 'request_sent' | 'request_accepted' | 'request_updated';
          toUserId?: string;
          fromDisplayName?: string;
          fromUsername?: string;
        };
        await refreshDirectory('');
        if (payload?.toUserId === currentUser.userId) {
          const actor = payload.fromDisplayName || (payload.fromUsername ? `@${payload.fromUsername}` : 'CHARISMA');
          if (payload.action === 'request_sent') {
            pushInAppNotification(
              language === 'ar' ? 'طلب صداقة جديد' : 'New Friend Request',
              language === 'ar'
                ? `أرسل ${actor} طلب صداقة إليك`
                : `${actor} sent you a friend request`,
              'friend',
            );
          } else if (payload.action === 'request_accepted') {
            pushInAppNotification(
              language === 'ar' ? 'تم قبول طلب الصداقة' : 'Friend Request Accepted',
              language === 'ar'
                ? `أصبح ${actor} صديقك الآن`
                : `${actor} accepted your friend request`,
              'friend',
            );
          }
        }
      }
    };

    broadcastMesh('directory:refresh', { userId: currentUser.userId });

    return () => {
      channel.close();
      meshRef.current = null;
    };
  }, [currentUser, broadcastMesh, handleIncomingEnvelope, handleRtcSignal, language, pushInAppNotification, refreshDirectory]);

  // Unlock local session & decrypt per-user data from IndexedDB
  async function handleAuthenticated({
    user,
    secrets,
  }: {
    user: PublicUser;
    secrets: DecryptedAccountSecrets;
  }) {
    const mk = secrets.dataMasterKeyB64;
    seenWrapIdsRef.current.clear();
    setCurrentUser(user);
    setKeyBundle(secrets.keyBundle);
    setDataMasterKeyB64(mk);
    setNostrPrivateKeyHex(secrets.nostrPrivateKeyHex || null);
    setNsec(secrets.nsec || null);
    setBlockedUserIds(user.blockedUserIds);

    const [cust, priv, convs, msgs, st, calls, vault, themes, savedRelays] = await Promise.all([
      localDb.getCustomization(user.userId),
      localDb.getPrivacyPlus(user.userId),
      localDb.getConversations(user.userId, mk),
      localDb.getAllMessages(user.userId, mk),
      localDb.getStories(user.userId, mk),
      localDb.getCalls(user.userId, mk),
      localDb.getVaultItems(user.userId),
      localDb.listSavedThemes(user.userId),
      localDb.getRelays(user.userId),
    ]);

    if (cust) setCustomization(cust);
    setSavedThemes(themes);
    setRelays(savedRelays);
    if (priv) {
      setPrivacy(priv);
      if (priv.appLockEnabled) setAppLocked(true);
    }
    setConversations(convs);
    setMessages(msgs);

    if (st.length === 0) {
      const welcomeStory: StorySlide = {
        storyId: `st_welcome_${user.userId}`,
        authorId: user.userId,
        authorName: user.displayName,
        authorEmoji: user.avatarEmoji,
        authorColor: user.avatarColor,
        kind: 'image',
        overlayText: 'CHARISMA — Offline & Decentralized Space',
        mediaDataUrl: '/src/assets/images/charisma_story_sample_1795329660387.jpg',
        allowDownload: true,
        privacyMode: 'all',
        allowedViewerIds: [],
        muted: false,
        reactions: [],
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      };
      await localDb.saveStory(user.userId, mk, welcomeStory);
      setStories([welcomeStory]);
    } else {
      setStories(st);
    }

    setCallLogs(calls);
    setVaultItems(vault);

    const [allAccounts, nostrPeers, reqs] = await Promise.all([
      localDb.listLocalAccounts(),
      localDb.listNostrPeers(),
      localDb.listFriendRequests(user.userId),
    ]);
    const localPublic = allAccounts
      .filter((acc) => acc.userId !== user.userId)
      .map((acc) => toPublicUser(acc, true));
    const seenPks = new Set<string>(
      [user.nostrPubkeyHex, ...localPublic.map((u) => u.nostrPubkeyHex)]
        .filter(Boolean)
        .map((pk) => pk.toLowerCase()),
    );
    const remotePublic = nostrPeers.filter(
      (p) => p.nostrPubkeyHex && !seenPks.has(p.nostrPubkeyHex.toLowerCase()),
    );
    const allPublic = [...localPublic, ...remotePublic];
    const peers = allPublic.filter((u) => !u.blockedUserIds.includes(user.userId));

    setAllAccountsPublic(allPublic);
    setFriendRequests(reqs);
    setDirectoryUsers(peers);
    directoryRef.current = peers;
    keyBundleRef.current = secrets.keyBundle;
    masterKeyRef.current = mk;
    nostrSkRef.current = secrets.nostrPrivateKeyHex || null;
    currentUserRef.current = user;
    conversationsRef.current = convs;
    messagesRef.current = msgs;

    if (reqs.incoming.length > 0) {
      pushInAppNotification(
        language === 'ar' ? 'طلبات صداقة معلّقة' : 'Pending Friend Requests',
        language === 'ar'
          ? `لديك ${reqs.incoming.length} طلب صداقة وارد بانتظار المراجعة`
          : `You have ${reqs.incoming.length} incoming friend request(s)`,
        'friend',
      );
    }

    const queuedEnvs = await localDb.consumeLocalEnvelopes(user.userId);
    for (const env of queuedEnvs) {
      await handleIncomingEnvelope(env);
    }
  }

  function handleSignOut() {
    callPcRef.current?.close();
    transferPcRef.current?.close();
    localStream?.getTracks().forEach((tr) => tr.stop());
    relayPoolRef.current?.destroy();
    relayPoolRef.current = null;
    seenWrapIdsRef.current.clear();
    setActiveCall(null);
    setLocalStream(null);
    setRemoteStream(null);
    setCurrentUser(null);
    setKeyBundle(null);
    setDataMasterKeyB64(null);
    setNostrPrivateKeyHex(null);
    setNsec(null);
    setBlockedUserIds([]);
    setDirectoryUsers([]);
    setAllAccountsPublic([]);
    setFriendRequests({ incoming: [], outgoing: [] });
    setConversations([]);
    setMessages([]);
    setStories([]);
    setCallLogs([]);
    setVaultItems([]);
    setSavedThemes([]);
    setOutboxCount(0);
    setShowRelaysModal(false);
    setActiveConvId(null);
    setPrivacy(DEFAULT_PRIVACY);
    setShowSettings(false);
    setShowThemeStudio(false);
    setLivePreviewCustomization(null);
  }

  async function handleSendFriendRequest(toUserId: string, toNostrPubkeyHex?: string) {
    if (!currentUser) return;
    const target =
      allAccountsPublic.find(
        (u) =>
          u.userId === toUserId ||
          (toNostrPubkeyHex && u.nostrPubkeyHex?.toLowerCase() === toNostrPubkeyHex.toLowerCase()),
      ) || undefined;
    const req = await localDb.sendFriendRequest(
      currentUser.userId,
      target?.userId || toUserId,
      toNostrPubkeyHex || target?.nostrPubkeyHex,
    );
    await refreshDirectory('');
    const action = req.status === 'accepted' ? 'request_accepted' : 'request_sent';
    broadcastMesh('friend:sync', {
      action,
      toUserId: target?.userId || toUserId,
      fromDisplayName: currentUser.displayName,
      fromUsername: currentUser.username,
    });

    const targetPk = toNostrPubkeyHex || target?.nostrPubkeyHex;
    if (target && targetPk) {
      await sendNostrSignalToPeer(target, {
        signalKind: action === 'request_accepted' ? 'friend_accept' : 'friend_request',
        requestId: req.requestId,
        username: currentUser.username,
        displayName: currentUser.displayName,
        bio: currentUser.bio,
        relayHints: relays.filter((r) => r.read).map((r) => r.url),
        ecdhPublicKeyJwk: currentUser.ecdhPublicKeyJwk,
        ecdsaPublicKeyJwk: currentUser.ecdsaPublicKeyJwk,
      });
    }

    pushInAppNotification(
      language === 'ar' ? 'نظام الأصدقاء' : 'Friends',
      action === 'request_accepted'
        ? (language === 'ar' ? 'تمت إضافة الصديق تلقائياً لوجود طلب متبادل' : 'Matched mutual request — you are now friends')
        : (language === 'ar' ? 'تم إرسال طلب الصداقة عبر الشبكة اللامركزية' : 'Encrypted friend request dispatched'),
      'friend',
    );
  }

  async function handleAcceptFriendRequest(requestId: string) {
    if (!currentUser) return;
    const req = await localDb.acceptFriendRequest(requestId, currentUser.userId);
    await refreshDirectory('');
    broadcastMesh('friend:sync', {
      action: 'request_accepted',
      toUserId: req.fromUserId,
      fromDisplayName: currentUser.displayName,
      fromUsername: currentUser.username,
    });
    const peer = allAccountsPublic.find(
      (u) => u.userId === req.fromUserId || (req.fromNostrPubkeyHex && u.nostrPubkeyHex === req.fromNostrPubkeyHex),
    );
    if (peer?.nostrPubkeyHex) {
      await sendNostrSignalToPeer(peer, {
        signalKind: 'friend_accept',
        requestId: req.requestId,
        username: currentUser.username,
        displayName: currentUser.displayName,
        bio: currentUser.bio,
        relayHints: relays.filter((r) => r.read).map((r) => r.url),
        ecdhPublicKeyJwk: currentUser.ecdhPublicKeyJwk,
        ecdsaPublicKeyJwk: currentUser.ecdsaPublicKeyJwk,
      });
    }
  }

  async function handleDeclineFriendRequest(requestId: string) {
    if (!currentUser) return;
    const req = friendRequests.incoming.find((r) => r.requestId === requestId);
    await localDb.declineFriendRequest(requestId, currentUser.userId);
    await refreshDirectory('');
    broadcastMesh('friend:sync', { action: 'request_updated' });
    if (req) {
      const peer = allAccountsPublic.find((u) => u.userId === req.fromUserId);
      if (peer?.nostrPubkeyHex) {
        await sendNostrSignalToPeer(peer, { signalKind: 'friend_decline', requestId });
      }
    }
  }

  async function handleCancelFriendRequest(requestId: string) {
    if (!currentUser) return;
    await localDb.cancelFriendRequest(requestId, currentUser.userId);
    await refreshDirectory('');
    broadcastMesh('friend:sync', { action: 'request_updated' });
  }

  async function handleRemoveFriend(friendUserId: string) {
    if (!currentUser) return;
    const updated = await localDb.removeFriend(currentUser.userId, friendUserId);
    setCurrentUser(updated);
    await refreshDirectory('');
    broadcastMesh('friend:sync', { action: 'request_updated' });
  }

  async function handleToggleFavorite(targetUserId: string) {
    if (!currentUser) return;
    const updated = await localDb.toggleFavorite(currentUser.userId, targetUserId);
    setCurrentUser(updated);
    await refreshDirectory('');
  }

  async function handleLookupNostrPubkey(
    identifier: string,
    fallbackMeta?: Partial<PublicUser>,
  ): Promise<PublicUser | null> {
    const parsed = parseNostrPublicIdentifier(identifier);
    if (!parsed) return null;
    if (currentUser && parsed.pubkeyHex === currentUser.nostrPubkeyHex.toLowerCase()) {
      return currentUser;
    }

    const pool = relayPoolRef.current;
    let kind0Content: string | undefined;
    let discoveredRelays: string[] = [...parsed.relayHints];

    if (pool) {
      const targetUrls = Array.from(
        new Set([...pool.getConnectedUrls('read'), ...parsed.relayHints]),
      );
      const events = await pool.queryOnce(
        [{ kinds: [0, 10002], authors: [parsed.pubkeyHex], limit: 4 }],
        targetUrls.length > 0 ? targetUrls : undefined,
        3500,
      );
      const latestMeta = events
        .filter((e) => e.kind === 0)
        .sort((a, b) => b.created_at - a.created_at)[0];
      if (latestMeta) kind0Content = latestMeta.content;

      const latestRelayList = events
        .filter((e) => e.kind === 10002)
        .sort((a, b) => b.created_at - a.created_at)[0];
      if (latestRelayList) {
        const listUrls = latestRelayList.tags
          .filter((t) => t[0] === 'r' && typeof t[1] === 'string' && t[1].startsWith('wss://'))
          .map((t) => t[1]);
        discoveredRelays = Array.from(new Set([...discoveredRelays, ...listUrls]));
      }
    }

    return ensureNostrPeerFromMetadata(parsed.pubkeyHex, kind0Content, {
      ...fallbackMeta,
      relayHints: discoveredRelays,
    });
  }

  async function handleSearchNip50Users(query: string): Promise<PublicUser[]> {
    const pool = relayPoolRef.current;
    if (!pool || !query.trim()) return [];
    const searchUrls = pool.getConnectedUrls('search');
    if (searchUrls.length === 0) return [];

    const events = await pool.queryOnce(
      [{ kinds: [0], search: query.trim(), limit: 15 }],
      searchUrls,
      4000,
    );

    const latestByAuthor = new Map<string, NostrEvent>();
    for (const ev of events) {
      const prev = latestByAuthor.get(ev.pubkey);
      if (!prev || ev.created_at > prev.created_at) {
        latestByAuthor.set(ev.pubkey, ev);
      }
    }

    const results: PublicUser[] = [];
    for (const [pubkey, ev] of latestByAuthor.entries()) {
      if (currentUser && pubkey.toLowerCase() === currentUser.nostrPubkeyHex.toLowerCase()) continue;
      const peer = await ensureNostrPeerFromMetadata(pubkey, ev.content);
      if (!blockedUserIds.includes(peer.userId)) {
        results.push(peer);
      }
    }
    return results;
  }

  async function handlePublishProfileAndRelays(): Promise<{
    publishedRelays: string[];
    failedRelays: string[];
  }> {
    if (!currentUser || !nostrPrivateKeyHex || !relayPoolRef.current) {
      return { publishedRelays: [], failedRelays: [] };
    }
    const profileEv = buildProfileMetadataEvent(nostrPrivateKeyHex, {
      username: currentUser.username,
      displayName: currentUser.displayName,
      bio: currentUser.bio,
      allowSearchByDisplayName: currentUser.allowSearchByDisplayName,
    });
    const relayListEv = buildRelayListEvent(nostrPrivateKeyHex, relays);
    const friendPubkeys = allAccountsPublic
      .filter((u) => currentUser.friendIds.includes(u.userId) && u.nostrPubkeyHex)
      .map((u) => u.nostrPubkeyHex);
    const contactEv = buildContactListEvent(nostrPrivateKeyHex, friendPubkeys);

    const [profileRes] = await Promise.all([
      relayPoolRef.current.publishEvent(profileEv),
      relayPoolRef.current.publishEvent(relayListEv),
      relayPoolRef.current.publishEvent(contactEv),
    ]);
    return profileRes;
  }

  async function handleBlockOrUnblockUser(targetUserId: string, block: boolean) {
    if (!currentUser) return;
    const updated = await localDb.blockOrUnblockUser(currentUser.userId, targetUserId, block);
    setBlockedUserIds(updated.blockedUserIds);
    setCurrentUser(updated);
    await refreshDirectory('');
    broadcastMesh('friend:sync', { action: 'request_updated' });
  }

  function handleChangeLanguage(lang: AppLanguage) {
    setLanguage(lang);
    localDb.setLanguage(lang);
  }

  function handleUpdateCustomization(patch: Partial<CustomizationConfig>) {
    setCustomization((prev) => {
      const next = normalizeCustomization({ ...prev, ...patch });
      localDb.setCustomization(next, currentUser?.userId);
      localDb.setCustomization(next);
      return next;
    });
  }

  function handleApplyStudioTheme(nextCfg: CustomizationConfig) {
    const normalized = normalizeCustomization(nextCfg);
    setCustomization(normalized);
    setLivePreviewCustomization(null);
    setShowThemeStudio(false);
    localDb.setCustomization(normalized, currentUser?.userId);
    localDb.setCustomization(normalized);
    pushInAppNotification(
      t.themeStudioTitle,
      language === 'ar' ? 'تم حفظ وتطبيق الثيم الجديد محلياً' : 'Theme applied and saved locally',
      'theme',
    );
  }

  function handleUpdatePrivacy(patch: Partial<PrivacyPlusConfig>) {
    setPrivacy((prev) => {
      const next = { ...prev, ...patch };
      if (currentUser) localDb.setPrivacyPlus(currentUser.userId, next);
      return next;
    });
  }

  async function handleStartDirectChat(peer: PublicUser) {
    if (!currentUser || !dataMasterKeyB64) return;
    const isSelfNote = peer.userId === currentUser.userId;
    const convId = isSelfNote
      ? `self_${currentUser.userId}`
      : `dm_${[currentUser.userId, peer.userId].sort().join('_')}`;

    const existing = conversations.find((c) => c.convId === convId);
    if (existing) {
      setActiveConvId(existing.convId);
      setActiveTab('chats');
      return;
    }

    const newConv: Conversation = {
      convId,
      type: 'direct',
      peerUserId: peer.userId,
      title: isSelfNote
        ? language === 'ar' ? 'مفكرتي الشخصية المشفرة' : 'Note to Self'
        : peer.displayName,
      avatarColor: peer.avatarColor,
      avatarEmoji: peer.avatarEmoji,
      memberIds: isSelfNote ? [currentUser.userId] : [currentUser.userId, peer.userId],
      adminIds: [currentUser.userId],
      lastMessagePreview: language === 'ar' ? 'مساحة محلية مشفرة' : 'AES-256-GCM Encrypted Space',
      lastMessageAt: Date.now(),
      unreadCount: 0,
      isPinned: false,
      isArchived: false,
      isMuted: false,
      isLocked: false,
      disappearTtlSec: 0,
      draftText: '',
      typingUserIds: [],
      recordingUserIds: [],
    };
    await localDb.saveConversation(currentUser.userId, dataMasterKeyB64, newConv);
    setConversations((prev) => [newConv, ...prev]);
    setActiveConvId(convId);
    setActiveTab('chats');
  }

  async function handleCreateGroup(
    title: string,
    description: string,
    members: PublicUser[],
    adminsOnly: boolean,
  ) {
    if (!currentUser || !dataMasterKeyB64) return;
    const convId = `grp_${crypto.randomUUID()}`;
    const newConv: Conversation = {
      convId,
      type: 'group',
      title,
      description,
      avatarColor: '#9D4EDD',
      avatarEmoji: '⬡',
      memberIds: [currentUser.userId, ...members.map((m) => m.userId)],
      adminIds: [currentUser.userId],
      adminsOnly,
      inviteCode: `local/${convId.slice(4, 12)}`,
      lastMessagePreview: `Group created (${members.length + 1} members)`,
      lastMessageAt: Date.now(),
      unreadCount: 0,
      isPinned: false,
      isArchived: false,
      isMuted: false,
      isLocked: false,
      disappearTtlSec: 0,
      draftText: '',
      typingUserIds: [],
      recordingUserIds: [],
    };
    await localDb.saveConversation(currentUser.userId, dataMasterKeyB64, newConv);
    setConversations((prev) => [newConv, ...prev]);
    setActiveConvId(convId);
  }

  async function handleSendMessage(
    convId: string,
    payload: {
      kind: MessageKind;
      text: string;
      attachment?: MessageAttachment;
      replyTo?: ChatMessage['replyTo'];
      forwardedFrom?: string;
      scheduledAt?: number;
    },
  ) {
    if (!currentUser || !dataMasterKeyB64) return;
    const conv = conversations.find((c) => c.convId === convId);
    if (!conv) return;

    const msgId = `msg_${crypto.randomUUID()}`;
    const now = Date.now();
    const disappearSec = conv.disappearTtlSec || 0;
    const msg: ChatMessage = {
      msgId,
      convId,
      senderId: currentUser.userId,
      senderName: currentUser.displayName,
      kind: payload.kind,
      text: payload.text,
      attachment: payload.attachment,
      replyTo: payload.replyTo,
      forwardedFrom: payload.forwardedFrom,
      reactions: {},
      status: 'sent',
      isStarred: false,
      isPinned: false,
      scheduledAt: payload.scheduledAt,
      expiresAt: disappearSec > 0 ? now + disappearSec * 1000 : undefined,
      createdAt: now,
    };

    await localDb.saveMessage(currentUser.userId, dataMasterKeyB64, msg);
    setMessages((prev) => [...prev, msg]);

    const updatedConv: Conversation = {
      ...conv,
      lastMessagePreview: payload.text || payload.kind,
      lastMessageAt: now,
    };
    await localDb.saveConversation(currentUser.userId, dataMasterKeyB64, updatedConv);
    setConversations((prev) => prev.map((c) => (c.convId === convId ? updatedConv : c)));

    const deliverNow = async () => {
      const targetIds = conv.memberIds.filter((id) => id !== currentUser.userId);
      const targetPeers = targetIds
        .map((uid) => directoryUsers.find((u) => u.userId === uid))
        .filter((u): u is PublicUser => Boolean(u));

      for (const peer of targetPeers) {
        await sendEncryptedToPeer(peer, convId, msgId, 'message', {
          ...msg,
          groupConvId: conv.type === 'group' ? conv.convId : undefined,
          groupTitle: conv.type === 'group' ? conv.title : undefined,
          memberIds: conv.memberIds,
        });
      }

      const skHex = nostrPrivateKeyHex;
      if (skHex && targetPeers.some((p) => p.nostrPubkeyHex)) {
        const nostrPeers = targetPeers.filter((p) => p.nostrPubkeyHex);
        let ackCount = 0;
        let sentRumorId: string | undefined;

        if (!payload.attachment && payload.kind === 'text') {
          const replyRumorId = payload.replyTo
            ? messages.find((m) => m.msgId === payload.replyTo?.msgId)?.nostrRumorId
            : undefined;
          const { wraps, rumorId } = buildNip17DirectMessageWraps(
            skHex,
            nostrPeers.map((p) => ({
              publicKey: p.nostrPubkeyHex,
              relayUrl: p.relayHints?.[0],
            })),
            payload.text,
            {
              conversationTitle: conv.type === 'group' ? conv.title : undefined,
              replyToEventId: replyRumorId,
            },
          );
          sentRumorId = rumorId;
          for (const wrap of wraps) {
            const pTag = wrap.tags.find((tg) => tg[0] === 'p')?.[1]?.toLowerCase();
            const targetPeer = nostrPeers.find((p) => p.nostrPubkeyHex.toLowerCase() === pTag);
            const targetUrls = targetPeer?.relayHints?.length
              ? Array.from(new Set([...(relayPoolRef.current?.getConnectedUrls('write') || []), ...targetPeer.relayHints]))
              : undefined;
            const res = await publishNostrEventWithOutbox(wrap, targetUrls);
            ackCount = Math.max(ackCount, res.publishedRelays.length);
          }
        } else if (payload.attachment) {
          const groupMemberPks =
            conv.type === 'group'
              ? Array.from(
                  new Set([currentUser.nostrPubkeyHex, ...nostrPeers.map((p) => p.nostrPubkeyHex)]),
                )
              : undefined;
          for (const peer of nostrPeers) {
            const wrap = buildNip59SignalWrap(skHex, peer.nostrPubkeyHex, {
              signalKind: 'attachment',
              msgId,
              kind: payload.kind as 'image' | 'video' | 'document' | 'voice' | 'location' | 'contact',
              text: payload.text,
              attachment: payload.attachment as unknown as Record<string, unknown>,
              groupTitle: conv.type === 'group' ? conv.title : undefined,
              memberPubkeys: groupMemberPks,
            });
            const targetUrls = peer.relayHints?.length
              ? Array.from(new Set([...(relayPoolRef.current?.getConnectedUrls('write') || []), ...peer.relayHints]))
              : undefined;
            const res = await publishNostrEventWithOutbox(wrap, targetUrls);
            ackCount = Math.max(ackCount, res.publishedRelays.length);
          }
        }

        const updatedWithAck: ChatMessage = {
          ...msg,
          nostrRumorId: sentRumorId || msg.nostrRumorId,
          deliveryMode: 'nip17',
          relayAckCount: ackCount,
          status: ackCount > 0 ? 'sent' : 'queued',
        };
        await localDb.saveMessage(currentUser.userId, dataMasterKeyB64, updatedWithAck);
        setMessages((prev) => prev.map((m) => (m.msgId === msgId ? updatedWithAck : m)));
      }
    };

    if (payload.scheduledAt && payload.scheduledAt > now) {
      setTimeout(() => {
        deliverNow();
      }, payload.scheduledAt - now);
    } else {
      await deliverNow();
    }
  }

  async function handleEditMessage(msgId: string, newText: string) {
    if (!currentUser || !dataMasterKeyB64) return;
    const target = messages.find((m) => m.msgId === msgId);
    if (!target) return;
    const updated = { ...target, text: newText, editedAt: Date.now() };
    await localDb.saveMessage(currentUser.userId, dataMasterKeyB64, updated);
    setMessages((prev) => prev.map((m) => (m.msgId === msgId ? updated : m)));

    const conv = conversations.find((c) => c.convId === target.convId);
    if (conv) {
      for (const uid of conv.memberIds.filter((id) => id !== currentUser.userId)) {
        const peer = directoryUsers.find((u) => u.userId === uid);
        if (peer) {
          await sendEncryptedToPeer(peer, conv.convId, `edit_${msgId}`, 'edit', { msgId, text: newText });
          await sendNostrSignalToPeer(peer, {
            signalKind: 'edit',
            targetMsgId: target.nostrRumorId || msgId,
            newText,
          });
        }
      }
    }
  }

  async function handleDeleteMessage(msgId: string, forEveryone: boolean) {
    if (!currentUser || !dataMasterKeyB64) return;
    const target = messages.find((m) => m.msgId === msgId);
    if (!target) return;
    const updated: ChatMessage = forEveryone
      ? { ...target, deletedForEveryone: true, text: '' }
      : { ...target, deletedLocally: true };
    await localDb.saveMessage(currentUser.userId, dataMasterKeyB64, updated);
    setMessages((prev) => prev.map((m) => (m.msgId === msgId ? updated : m)));

    if (forEveryone) {
      const conv = conversations.find((c) => c.convId === target.convId);
      if (conv) {
        for (const uid of conv.memberIds.filter((id) => id !== currentUser.userId)) {
          const peer = directoryUsers.find((u) => u.userId === uid);
          if (peer) {
            await sendEncryptedToPeer(peer, conv.convId, `del_${msgId}`, 'delete_request', { msgId });
            await sendNostrSignalToPeer(peer, {
              signalKind: 'delete',
              targetMsgId: target.nostrRumorId || msgId,
            });
          }
        }
      }
    }
  }

  async function handleReactMessage(msgId: string, emoji: string) {
    if (!currentUser || !dataMasterKeyB64) return;
    const target = messages.find((m) => m.msgId === msgId);
    if (!target) return;
    const currentList = target.reactions[emoji] || [];
    const nextList = currentList.includes(currentUser.userId)
      ? currentList.filter((id) => id !== currentUser.userId)
      : [...currentList, currentUser.userId];
    const updated = { ...target, reactions: { ...target.reactions, [emoji]: nextList } };
    await localDb.saveMessage(currentUser.userId, dataMasterKeyB64, updated);
    setMessages((prev) => prev.map((m) => (m.msgId === msgId ? updated : m)));

    const conv = conversations.find((c) => c.convId === target.convId);
    if (conv) {
      for (const uid of conv.memberIds.filter((id) => id !== currentUser.userId)) {
        const peer = directoryUsers.find((u) => u.userId === uid);
        if (peer) {
          await sendEncryptedToPeer(peer, conv.convId, `rx_${msgId}_${Date.now()}`, 'reaction', { msgId, emoji });
          await sendNostrSignalToPeer(peer, {
            signalKind: 'reaction',
            targetMsgId: target.nostrRumorId || msgId,
            emoji,
          });
        }
      }
    }
  }

  async function handleStartCall(peer: PublicUser, kind: 'audio' | 'video') {
    if (!currentUser) return;
    const callId = `call_${crypto.randomUUID()}`;
    setActiveTab('calls');
    setActiveCall({
      callId,
      peer,
      kind,
      direction: 'outgoing',
      state: 'connecting',
      startedAt: Date.now(),
      micMuted: false,
      cameraEnabled: kind === 'video',
      speakerEnabled: true,
    });

    const pc = new RTCPeerConnection(getRtcConfiguration());
    callPcRef.current = pc;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
      setLocalStream(stream);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    } catch {
      // Proceed signaling even if mic/camera denied
    }

    pc.ontrack = (ev) => {
      setRemoteStream(ev.streams[0]);
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const cand = ev.candidate.toJSON();
        dispatchRtcSignal(
          peer,
          {
            fromUserId: currentUser.userId,
            toUserId: peer.userId,
            signalType: 'call_ice',
            candidate: cand,
          },
          { signalKind: 'rtc_ice', callId, candidate: cand },
        );
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await dispatchRtcSignal(
      peer,
      {
        fromUserId: currentUser.userId,
        toUserId: peer.userId,
        signalType: 'call_offer',
        callId,
        callKind: kind,
        sdp: offer,
      },
      { signalKind: 'rtc_offer', callId, callKind: kind, sdp: offer },
    );
  }

  async function handleAcceptIncomingCall() {
    const pending = pendingOfferRef.current;
    if (!pending || !activeCall || !currentUser) return;
    const peer = activeCall.peer;
    const pc = new RTCPeerConnection(getRtcConfiguration());
    callPcRef.current = pc;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: pending.kind === 'video' });
      setLocalStream(stream);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    } catch {
      // Continue
    }

    pc.ontrack = (ev) => setRemoteStream(ev.streams[0]);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const cand = ev.candidate.toJSON();
        dispatchRtcSignal(
          peer,
          {
            fromUserId: currentUser.userId,
            toUserId: peer.userId,
            signalType: 'call_ice',
            candidate: cand,
          },
          { signalKind: 'rtc_ice', callId: pending.callId, candidate: cand },
        );
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(pending.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await dispatchRtcSignal(
      peer,
      {
        fromUserId: currentUser.userId,
        toUserId: peer.userId,
        signalType: 'call_answer',
        sdp: answer,
      },
      { signalKind: 'rtc_answer', callId: pending.callId, sdp: answer },
    );
    setActiveCall((prev) => (prev ? { ...prev, state: 'connected' } : null));
  }

  async function handleEndCall() {
    if (activeCall && currentUser && dataMasterKeyB64) {
      await dispatchRtcSignal(
        activeCall.peer,
        {
          fromUserId: currentUser.userId,
          toUserId: activeCall.peer.userId,
          signalType: 'call_hangup',
        },
        { signalKind: 'rtc_hangup', callId: activeCall.callId },
      );
      const log: CallLogEntry = {
        callId: activeCall.callId,
        peerUserId: activeCall.peer.userId,
        peerName: activeCall.peer.displayName,
        kind: activeCall.kind,
        direction: activeCall.direction,
        status: activeCall.state === 'connected' ? 'ended' : 'missed',
        startedAt: activeCall.startedAt,
        durationSec: Math.max(0, Math.round((Date.now() - activeCall.startedAt) / 1000)),
      };
      await localDb.saveCall(currentUser.userId, dataMasterKeyB64, log);
      setCallLogs((prev) => [log, ...prev]);
    }
    callPcRef.current?.close();
    callPcRef.current = null;
    localStream?.getTracks().forEach((tr) => tr.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setActiveCall(null);
  }

  async function handleStartDirectTransfer(peer: PublicUser, file: File) {
    if (!currentUser) return;
    const transferId = `tx_${crypto.randomUUID()}`;
    const pc = new RTCPeerConnection(getRtcConfiguration());
    transferPcRef.current = pc;

    const dc = pc.createDataChannel('charisma-direct-transfer');
    dc.binaryType = 'arraybuffer';

    const buffer = await file.arrayBuffer();
    const digest = await sha256Hex(buffer);

    setTransferState({
      transferId,
      peerName: peer.displayName,
      fileName: file.name,
      sizeBytes: file.size,
      transferredBytes: 0,
      direction: 'send',
      status: 'negotiating',
    });

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const cand = ev.candidate.toJSON();
        dispatchRtcSignal(
          peer,
          {
            fromUserId: currentUser.userId,
            toUserId: peer.userId,
            signalType: 'transfer_ice',
            candidate: cand,
          },
          { signalKind: 'transfer_ice', transferId, candidate: cand },
        );
      }
    };

    dc.onopen = () => {
      const CHUNK_SIZE = 16384;
      let offset = 0;
      setTransferState((prev) => (prev ? { ...prev, status: 'transferring' } : null));

      while (offset < buffer.byteLength) {
        const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
        dc.send(chunk);
        offset += chunk.byteLength;
        setTransferState((prev) => (prev ? { ...prev, transferredBytes: offset } : null));
      }
      dc.send(JSON.stringify({ done: true, expectedSha256: digest }));
      setTransferState((prev) => (prev ? { ...prev, status: 'verified', sha256Hex: digest } : null));
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await dispatchRtcSignal(
      peer,
      {
        fromUserId: currentUser.userId,
        toUserId: peer.userId,
        signalType: 'transfer_offer',
        transferId,
        fileName: file.name,
        sizeBytes: file.size,
        sdp: offer,
      },
      {
        signalKind: 'transfer_offer',
        transferId,
        fileName: file.name,
        sizeBytes: file.size,
        sdp: offer,
      },
    );
  }

  async function handleUnlockApp(e: React.FormEvent) {
    e.preventDefault();
    const hashed = await hashPin(appPinInput);
    if (hashed === privacy.appLockPinHash) {
      setAppLocked(false);
      setAppPinInput('');
      setAppLockError(null);
    } else {
      setAppLockError(language === 'ar' ? 'رمز PIN غير صحيح' : 'Incorrect PIN');
    }
  }

  async function handleBiometricUnlock() {
    if (!privacy.biometricCredentialId) return;
    setAppLockError(null);
    try {
      const ok = await verifyBiometricLock(privacy.biometricCredentialId);
      if (ok) {
        setAppLocked(false);
        setAppPinInput('');
      } else {
        setAppLockError(language === 'ar' ? 'تعذر التحقق الحيوي' : 'Biometric verification failed');
      }
    } catch (err) {
      setAppLockError(err instanceof Error ? err.message : 'Biometric verification cancelled');
    }
  }

  if (booting) {
    return (
      <div className="min-h-screen bg-[#05070D] text-[#F2F6FF] flex items-center justify-center p-6 text-sm">
        {t.loading}
      </div>
    );
  }

  if (appLocked) {
    return (
      <div className="min-h-screen bg-[#05070D] text-[#F2F6FF] flex items-center justify-center p-6">
        <OfflineIndicator language={language} />
        <form
          onSubmit={handleUnlockApp}
          className="max-w-sm w-full bg-[#0C1222] border border-white/10 rounded-3xl p-8 space-y-5 text-center"
        >
          <Lock className="w-10 h-10 text-[#00E5FF] mx-auto" />
          <h1 className="font-display text-xl font-bold">{t.appName}</h1>
          <input
            type="password"
            value={appPinInput}
            onChange={(e) => setAppPinInput(e.target.value)}
            placeholder="PIN"
            className="w-full min-h-[46px] px-4 rounded-xl bg-[#05070D] border border-white/15 text-center font-mono-tabular"
          />
          {appLockError && <p className="text-xs text-red-400">{appLockError}</p>}
          <button
            type="submit"
            className="w-full min-h-[46px] rounded-xl bg-[#00E5FF] text-[#041018] font-semibold text-sm"
          >
            {language === 'ar' ? 'فتح CHARISMA' : 'Unlock CHARISMA'}
          </button>
          {privacy.biometricCredentialId && (
            <button
              type="button"
              onClick={handleBiometricUnlock}
              className="w-full min-h-[46px] rounded-xl border border-cyan-500/40 text-[#00E5FF] font-semibold text-sm flex items-center justify-center gap-2 hover:bg-cyan-500/10"
            >
              <Fingerprint className="w-4 h-4" />
              <span>{language === 'ar' ? 'فتح بالبصمة / المصادقة الحيوية' : 'Unlock with Biometric'}</span>
            </button>
          )}
        </form>
      </div>
    );
  }

  if (!currentUser || !keyBundle || !dataMasterKeyB64) {
    return (
      <>
        <OfflineIndicator language={language} />
        <AuthScreen
          language={language}
          themeMode={customization.themeMode}
          onToggleLanguage={() => handleChangeLanguage(language === 'en' ? 'ar' : 'en')}
          onToggleTheme={() =>
            handleUpdateCustomization({
              themeMode: customization.themeMode === 'dark' ? 'light' : 'dark',
            })
          }
          onAuthenticated={handleAuthenticated}
        />
      </>
    );
  }

  const homeShellStyle = getPageShellStyle(effectiveCustomization, 'home');
  const homeCardStyle = getPageCardStyle(effectiveCustomization, 'home');
  const notifCardStyle = getPageCardStyle(effectiveCustomization, 'notifications');
  const notifOverride = effectiveCustomization.pageThemes.notifications;
  const connectedRelayCount = relays.filter((r) => r.status === 'connected').length;
  const nip50RelayCount = relays.filter(
    (r) => r.status === 'connected' && (r.isSearch || r.supportedNips?.includes(50)),
  ).length;

  return (
    <div
      className="h-screen w-screen overflow-hidden flex flex-col md:flex-row bg-[#F4F7FC] dark:bg-[#05070D] text-slate-900 dark:text-[#F2F6FF] relative"
      style={homeShellStyle}
    >
      <OfflineIndicator language={language} />
      {/* In-App Notifications Overlay (Styled via Theme Studio Notifications Page Override) */}
      {notifications.length > 0 && (
        <div className="fixed top-4 end-4 z-[60] flex flex-col gap-2 max-w-xs w-full pointer-events-none">
          {notifications.map((n) => (
            <div
              key={n.id}
              className="pointer-events-auto p-3.5 rounded-2xl border border-slate-200 dark:border-white/15 bg-white dark:bg-[#0C1222] shadow-xl flex items-start gap-2.5"
              style={{
                ...notifCardStyle,
                backgroundColor: notifOverride?.enabled && notifOverride.backgroundColor ? notifOverride.backgroundColor : notifCardStyle.backgroundColor,
                color: notifOverride?.enabled && notifOverride.textColor ? notifOverride.textColor : undefined,
                borderRadius: notifOverride?.enabled && notifOverride.borderRadiusPx ? `${notifOverride.borderRadiusPx}px` : undefined,
              }}
            >
              <Bell
                className="w-4 h-4 mt-0.5 shrink-0"
                style={{
                  color: notifOverride?.enabled && notifOverride.accentColor
                    ? notifOverride.accentColor
                    : effectiveCustomization.primaryAccent,
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold truncate">{n.title}</div>
                <p className="text-[11px] opacity-80 line-clamp-2">{n.body}</p>
              </div>
              <button
                type="button"
                onClick={() => setNotifications((prev) => prev.filter((item) => item.id !== n.id))}
                className="p-0.5 opacity-60 hover:opacity-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Desktop Navigation Rail */}
      <aside
        className={`hidden md:flex ${
          effectiveCustomization.navStyle === 'minimal' ? 'w-[64px]' : 'w-[76px]'
        } ${
          effectiveCustomization.navStyle === 'floating' ? 'm-3 rounded-3xl border shadow-xl' : 'border-e'
        } flex-col items-center justify-between py-4 border-slate-200 dark:border-white/10 bg-white dark:bg-[#080C18] shrink-0 z-10`}
        style={homeCardStyle}
      >
        <div className="flex flex-col items-center gap-4">
          <img
            src="/src/assets/images/charisma_app_icon_1795329659625.jpg"
            alt="CHARISMA"
            className="w-10 h-10 rounded-xl object-cover border border-slate-200 dark:border-cyan-400/30"
          />
          <nav className="flex flex-col items-center gap-2 pt-2">
            {[
              { id: 'chats', icon: MessageSquare, label: t.navChats },
              { id: 'contacts', icon: Users, label: t.navContacts },
              { id: 'stories', icon: Radio, label: t.navStories },
              { id: 'calls', icon: Phone, label: t.navCalls },
              { id: 'hub', icon: Shield, label: t.navHub },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              const badgeCount = item.id === 'contacts' ? friendRequests.incoming.length : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id as MainTab)}
                  title={item.label}
                  aria-label={item.label}
                  className={`relative w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
                    active
                      ? 'text-[#041018]'
                      : 'text-slate-500 dark:text-[#9AA8C7] hover:bg-slate-100 dark:hover:bg-white/5'
                  }`}
                  style={
                    active
                      ? { backgroundColor: effectiveCustomization.primaryAccent }
                      : undefined
                  }
                >
                  <Icon className="w-5 h-5" />
                  {badgeCount > 0 && (
                    <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-mono-tabular font-bold flex items-center justify-center">
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRelaysModal(true)}
            title={`${t.navRelays} (${connectedRelayCount}/${relays.length})`}
            aria-label={t.navRelays}
            className="relative w-11 h-11 rounded-xl border border-slate-200 dark:border-white/10 flex items-center justify-center hover:border-cyan-500"
          >
            <Server className="w-4 h-4" />
            <span
              className={`absolute top-1.5 end-1.5 w-2 h-2 rounded-full ${
                connectedRelayCount > 0 ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
          </button>
          <button
            type="button"
            onClick={() => setShowThemeStudio(true)}
            title={t.navThemeStudio}
            aria-label={t.navThemeStudio}
            className="w-11 h-11 rounded-xl border border-slate-200 dark:border-white/10 flex items-center justify-center hover:border-cyan-500"
            style={{ color: effectiveCustomization.primaryAccent }}
          >
            <Palette className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => handleChangeLanguage(language === 'en' ? 'ar' : 'en')}
            title={t.languageLabel}
            className="w-11 h-11 rounded-xl border border-slate-200 dark:border-white/10 flex items-center justify-center text-xs font-semibold"
          >
            <Globe className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            title={t.settingsTitle}
            aria-label={t.settingsTitle}
            className="w-11 h-11 rounded-xl border border-slate-200 dark:border-white/10 flex items-center justify-center hover:border-cyan-500"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {activeTab === 'chats' && (
          <ChatsView
            language={language}
            currentUser={currentUser}
            nostrPrivateKeyHex={nostrPrivateKeyHex || undefined}
            keyBundle={keyBundle}
            directoryUsers={directoryUsers}
            conversations={conversations}
            messages={messages}
            activeConvId={activeConvId}
            customization={effectiveCustomization}
            savedThemes={savedThemes}
            privacy={privacy}
            onUpdatePrivacy={handleUpdatePrivacy}
            onStartDirectTransfer={handleStartDirectTransfer}
            onSelectConv={setActiveConvId}
            onStartDirectChat={handleStartDirectChat}
            onCreateGroup={handleCreateGroup}
            onSendMessage={handleSendMessage}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onReactMessage={handleReactMessage}
            onToggleStarMessage={(msgId) => {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.msgId === msgId) {
                    const next = { ...m, isStarred: !m.isStarred };
                    localDb.saveMessage(currentUser.userId, dataMasterKeyB64, next);
                    return next;
                  }
                  return m;
                }),
              );
            }}
            onTogglePinMessage={(msgId) => {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.msgId === msgId) {
                    const next = { ...m, isPinned: !m.isPinned };
                    localDb.saveMessage(currentUser.userId, dataMasterKeyB64, next);
                    return next;
                  }
                  return m;
                }),
              );
            }}
            onUpdateConversation={(convId, patch) => {
              setConversations((prev) =>
                prev.map((c) => {
                  if (c.convId === convId) {
                    const next = { ...c, ...patch };
                    localDb.saveConversation(currentUser.userId, dataMasterKeyB64, next);
                    return next;
                  }
                  return c;
                }),
              );
            }}
            onClearLocalChat={async (convId) => {
              await localDb.clearConversationMessages(currentUser.userId, convId);
              setMessages((prev) => prev.filter((m) => m.convId !== convId));
            }}
            onSendTypingState={async (convId, kind, active) => {
              const conv = conversations.find((c) => c.convId === convId);
              if (!conv) return;
              for (const uid of conv.memberIds.filter((id) => id !== currentUser.userId)) {
                const peer = directoryUsers.find((u) => u.userId === uid);
                if (peer) {
                  await sendEncryptedToPeer(peer, convId, `${kind}_${Date.now()}`, kind, { convId, active });
                  await sendNostrSignalToPeer(peer, { signalKind: kind, active }, false);
                }
              }
            }}
            onStartCall={handleStartCall}
            onRefreshDirectory={refreshDirectory}
            onBlockUser={handleBlockOrUnblockUser}
            blockedUserIds={blockedUserIds}
          />
        )}

        {activeTab === 'contacts' && (
          <ContactsView
            language={language}
            currentUser={currentUser}
            allUsers={allAccountsPublic}
            blockedUserIds={blockedUserIds}
            friendRequests={friendRequests}
            customization={effectiveCustomization}
            connectedRelayCount={connectedRelayCount}
            nip50RelayCount={nip50RelayCount}
            onSendFriendRequest={handleSendFriendRequest}
            onAcceptFriendRequest={handleAcceptFriendRequest}
            onDeclineFriendRequest={handleDeclineFriendRequest}
            onCancelFriendRequest={handleCancelFriendRequest}
            onRemoveFriend={handleRemoveFriend}
            onToggleFavorite={handleToggleFavorite}
            onLookupNostrPubkey={handleLookupNostrPubkey}
            onSearchNip50Users={handleSearchNip50Users}
            onStartDirectChat={handleStartDirectChat}
            onStartCall={handleStartCall}
            onBlockUser={handleBlockOrUnblockUser}
            pendingInspectPeer={pendingInspectPeer}
            onClearPendingInspectPeer={() => setPendingInspectPeer(null)}
          />
        )}

        {activeTab === 'stories' && (
          <StoriesChannelsView
            language={language}
            customization={effectiveCustomization}
            currentUser={currentUser}
            stories={stories}
            onAddStory={async (slide) => {
              await localDb.saveStory(currentUser.userId, dataMasterKeyB64, slide);
              setStories((prev) => [slide, ...prev]);
            }}
            onReactStory={async (storyId, emoji) => {
              setStories((prev) =>
                prev.map((s) => {
                  if (s.storyId !== storyId) return s;
                  const next = { ...s, reactions: [...s.reactions, { userId: currentUser.userId, emoji }] };
                  localDb.saveStory(currentUser.userId, dataMasterKeyB64, next);
                  return next;
                }),
              );
            }}
            onMuteStory={async (storyId) => {
              setStories((prev) =>
                prev.map((s) => {
                  if (s.storyId !== storyId) return s;
                  const next = { ...s, muted: true };
                  localDb.saveStory(currentUser.userId, dataMasterKeyB64, next);
                  return next;
                }),
              );
            }}
            onReplyStoryToChat={async (authorId, storyText) => {
              const peer =
                authorId === currentUser.userId
                  ? currentUser
                  : directoryUsers.find((u) => u.userId === authorId);
              if (peer) {
                await handleStartDirectChat(peer);
                const convId =
                  peer.userId === currentUser.userId
                    ? `self_${currentUser.userId}`
                    : `dm_${[currentUser.userId, peer.userId].sort().join('_')}`;
                await handleSendMessage(convId, { kind: 'text', text: `[Story Reply] ${storyText}` });
              }
            }}
          />
        )}

        {activeTab === 'calls' && (
          <CallsView
            language={language}
            customization={effectiveCustomization}
            privacy={privacy}
            connectedRelayCount={connectedRelayCount}
            directoryUsers={directoryUsers}
            callLogs={callLogs}
            activeCall={activeCall}
            localStream={localStream}
            remoteStream={remoteStream}
            onStartCall={handleStartCall}
            onAcceptIncomingCall={handleAcceptIncomingCall}
            onEndCall={handleEndCall}
            onToggleMic={() => {
              if (!activeCall) return;
              const nextMuted = !activeCall.micMuted;
              localStream?.getAudioTracks().forEach((tr) => (tr.enabled = !nextMuted));
              setActiveCall({ ...activeCall, micMuted: nextMuted });
            }}
            onToggleCamera={() => {
              if (!activeCall) return;
              const nextCam = !activeCall.cameraEnabled;
              localStream?.getVideoTracks().forEach((tr) => (tr.enabled = nextCam));
              setActiveCall({ ...activeCall, cameraEnabled: nextCam });
            }}
            onToggleSpeaker={() => {
              if (!activeCall) return;
              setActiveCall({ ...activeCall, speakerEnabled: !activeCall.speakerEnabled });
            }}
          />
        )}

        {activeTab === 'hub' && (
          <HubView
            language={language}
            currentUser={currentUser}
            directoryUsers={directoryUsers}
            conversations={conversations}
            messages={messages}
            callLogs={callLogs}
            vaultItems={vaultItems}
            privacy={privacy}
            transferState={transferState}
            onAddVaultItem={async (item) => {
              await localDb.saveVaultItem(item);
              setVaultItems((prev) => [item, ...prev]);
            }}
            onDeleteVaultItem={async (vaultId) => {
              await localDb.deleteVaultItem(vaultId);
              setVaultItems((prev) => prev.filter((v) => v.vaultId !== vaultId));
            }}
            onStartDirectTransfer={handleStartDirectTransfer}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        className="md:hidden grid grid-cols-7 h-16 border-t border-slate-200 dark:border-white/10 bg-white dark:bg-[#080C18] shrink-0"
        style={homeCardStyle}
      >
        {[
          { id: 'chats', icon: MessageSquare, label: t.navChats },
          { id: 'contacts', icon: Users, label: t.navContacts },
          { id: 'stories', icon: Radio, label: t.navStories },
          { id: 'calls', icon: Phone, label: t.navCalls },
          { id: 'hub', icon: Shield, label: t.navHub },
        ].map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          const badgeCount = item.id === 'contacts' ? friendRequests.incoming.length : 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id as MainTab)}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                active ? '' : 'text-slate-500 dark:text-[#9AA8C7]'
              }`}
              style={active ? { color: effectiveCustomization.primaryAccent } : undefined}
            >
              <Icon className="w-5 h-5" />
              {badgeCount > 0 && (
                <span className="absolute top-1.5 end-2 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-mono-tabular font-bold flex items-center justify-center">
                  {badgeCount}
                </span>
              )}
              <span className="truncate max-w-[48px]">{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setShowRelaysModal(true)}
          className="relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-slate-500 dark:text-[#9AA8C7]"
        >
          <Server className="w-5 h-5" />
          <span
            className={`absolute top-1.5 end-2.5 w-2 h-2 rounded-full ${
              connectedRelayCount > 0 ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
          <span className="truncate max-w-[48px]">{t.navRelays}</span>
        </button>
        <button
          type="button"
          onClick={() => setShowThemeStudio(true)}
          className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium"
          style={{ color: effectiveCustomization.primaryAccent }}
        >
          <Palette className="w-5 h-5" />
          <span className="truncate max-w-[48px]">{t.navThemeStudio}</span>
        </button>
      </nav>

      {showRelaysModal && (
        <RelaysModal
          language={language}
          relays={relays}
          customization={effectiveCustomization}
          outboxCount={outboxCount}
          onUpdateRelays={async (nextRelays) => {
            setRelays(nextRelays);
            await localDb.setRelays(currentUser.userId, nextRelays);
            relayPoolRef.current?.setRelays(nextRelays);
          }}
          onReconnectAll={() => {
            for (const r of relays) {
              relayPoolRef.current?.connectRelay(r.url);
            }
          }}
          onClose={() => setShowRelaysModal(false)}
        />
      )}

      {showThemeStudio && (
        <ThemeStudioModal
          language={language}
          userId={currentUser.userId}
          activeCustomization={customization}
          conversations={conversations}
          savedThemes={savedThemes}
          onRefreshThemes={async () => {
            setSavedThemes(await localDb.listSavedThemes(currentUser.userId));
          }}
          onLivePreviewChange={setLivePreviewCustomization}
          onApplyCustomization={handleApplyStudioTheme}
          onAssignChatTheme={(convId, themeId) => {
            setConversations((prev) =>
              prev.map((c) => {
                if (c.convId === convId) {
                  const next = { ...c, customThemeId: themeId };
                  localDb.saveConversation(currentUser.userId, dataMasterKeyB64, next);
                  return next;
                }
                return c;
              }),
            );
          }}
          onTriggerTestNotification={(overrideCfg) => {
            if (overrideCfg) setLivePreviewCustomization(overrideCfg);
            pushInAppNotification(t.testNotificationTitle, t.testNotificationBody, 'theme');
          }}
          onCloseRestoreOriginal={() => {
            setLivePreviewCustomization(null);
            setShowThemeStudio(false);
          }}
        />
      )}

      {showSettings && (
        <SettingsStudioModal
          language={language}
          currentUser={currentUser}
          nostrPrivateKeyHex={nostrPrivateKeyHex || undefined}
          nsec={nsec || undefined}
          relays={relays}
          connectedRelayCount={connectedRelayCount}
          totalRelayCount={relays.length}
          customization={effectiveCustomization}
          privacy={privacy}
          blockedUserIds={blockedUserIds}
          onClose={() => setShowSettings(false)}
          onOpenThemeStudio={() => setShowThemeStudio(true)}
          onOpenRelaysModal={() => setShowRelaysModal(true)}
          onPingRelay={(relayUrl) =>
            relayPoolRef.current ? relayPoolRef.current.pingRelay(relayUrl) : pingRelayUrl(relayUrl)
          }
          onPublishProfileAndRelays={handlePublishProfileAndRelays}
          onVerifyAccountPassword={(pwd) => localDb.verifyLocalPassword(currentUser.userId, pwd)}
          onChangeLanguage={handleChangeLanguage}
          onUpdateCustomization={handleUpdateCustomization}
          onUpdatePrivacy={handleUpdatePrivacy}
          onUpdateProfile={async (patch) => {
            const updated = await localDb.updateLocalProfile(currentUser.userId, patch);
            setCurrentUser(updated);
            await refreshDirectory('');
            broadcastMesh('directory:refresh', { userId: currentUser.userId });
          }}
          onChangePassword={async (currPwd, nextPwd) => {
            await localDb.changeLocalPassword(currentUser.userId, currPwd, nextPwd);
          }}
          onUnblockUser={async (targetUserId) => {
            await handleBlockOrUnblockUser(targetUserId, false);
          }}
          onDeleteAccount={async () => {
            await localDb.deleteLocalAccount(currentUser.userId);
            handleSignOut();
          }}
          onWipeAllDeviceData={async () => {
            await localDb.wipeAllLocalData();
            handleSignOut();
          }}
          onSignOut={handleSignOut}
        />
      )}
    </div>
  );
}
