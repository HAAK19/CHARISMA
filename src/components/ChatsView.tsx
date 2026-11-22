import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  BellOff,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Download,
  Edit3,
  FileText,
  Forward,
  Lock,
  MapPin,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Pin,
  Play,
  Pause,
  Plus,
  QrCode,
  Reply,
  Search,
  Send,
  Shield,
  Sparkles,
  Square,
  Star,
  Timer,
  Trash2,
  UploadCloud,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import {
  AppLanguage,
  ChatMessage,
  Conversation,
  CustomizationConfig,
  LocalKeyBundle,
  MessageAttachment,
  MessageKind,
  PrivacyPlusConfig,
  PublicUser,
  SavedThemePreset,
} from '../types/charisma';
import { TRANSLATIONS, formatBytes, formatLocalizedTime } from '../i18n/translations';
import { computeSafetyNumber, encryptWithPassphrase, hashPin } from '../crypto/charismaCrypto';
import {
  decryptBytesAesGcm,
  encryptBytesAesGcm,
  uploadEncryptedBlobToBlossom,
} from '../utils/encryptedMedia';
import { LocalAssistAction, runLocalTextAssistant } from '../utils/localTextAssistant';
import {
  BUILTIN_THEME_PRESETS,
  getBubbleCornerStyle,
  getFontStack,
  getPageCardStyle,
  getPageShellStyle,
  getShadowCss,
  hexToRgba,
} from '../utils/themeEngine';
import { buildUserQrPayload } from '../utils/qrIdentity';
import { QrCodeDisplay } from './QrCodeDisplay';
import { UserAvatar } from './UserAvatar';

interface ChatsViewProps {
  language: AppLanguage;
  currentUser: PublicUser;
  nostrPrivateKeyHex?: string;
  keyBundle: LocalKeyBundle;
  directoryUsers: PublicUser[];
  conversations: Conversation[];
  messages: ChatMessage[];
  activeConvId: string | null;
  customization: CustomizationConfig;
  savedThemes: SavedThemePreset[];
  privacy: PrivacyPlusConfig;
  onUpdatePrivacy?: (patch: Partial<PrivacyPlusConfig>) => void;
  onStartDirectTransfer?: (peer: PublicUser, file: File) => Promise<void>;
  onSelectConv: (convId: string | null) => void;
  onStartDirectChat: (peer: PublicUser) => void;
  onCreateGroup: (title: string, description: string, members: PublicUser[], adminsOnly: boolean) => void;
  onSendMessage: (
    convId: string,
    payload: {
      kind: MessageKind;
      text: string;
      attachment?: MessageAttachment;
      replyTo?: { msgId: string; senderName: string; previewText: string };
      forwardedFrom?: string;
      scheduledAt?: number;
    },
  ) => void;
  onEditMessage: (msgId: string, newText: string) => void;
  onDeleteMessage: (msgId: string, forEveryone: boolean) => void;
  onReactMessage: (msgId: string, emoji: string) => void;
  onToggleStarMessage: (msgId: string) => void;
  onTogglePinMessage: (msgId: string) => void;
  onUpdateConversation: (convId: string, patch: Partial<Conversation>) => void;
  onClearLocalChat: (convId: string) => void;
  onSendTypingState: (convId: string, kind: 'typing' | 'recording', active: boolean) => void;
  onStartCall: (peer: PublicUser, kind: 'audio' | 'video') => void;
  onRefreshDirectory: (query: string) => void;
  onBlockUser: (userId: string, block: boolean) => void;
  blockedUserIds: string[];
}

const REACTION_CHOICES = ['👍', '❤️', '🔥', '⚡', '🛡️', '😂'];

export const ChatsView: React.FC<ChatsViewProps> = ({
  language,
  currentUser,
  nostrPrivateKeyHex,
  keyBundle,
  directoryUsers,
  conversations,
  messages,
  activeConvId,
  customization,
  savedThemes,
  privacy,
  onUpdatePrivacy,
  onStartDirectTransfer,
  onSelectConv,
  onStartDirectChat,
  onCreateGroup,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onReactMessage,
  onToggleStarMessage,
  onTogglePinMessage,
  onUpdateConversation,
  onClearLocalChat,
  onSendTypingState,
  onStartCall,
  onRefreshDirectory,
  onBlockUser,
  blockedUserIds,
}) => {
  const t = TRANSLATIONS[language];
  const [filter, setFilter] = useState<'all' | 'unread' | 'pinned' | 'archived'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);

  // Modals
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [showMyQrModal, setShowMyQrModal] = useState(false);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showConvMenu, setShowConvMenu] = useState(false);
  const [showAiSheet, setShowAiSheet] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);

  // Directory search & group creation
  const [dirQuery, setDirQuery] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupAdminsOnly, setGroupAdminsOnly] = useState(false);
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>([]);

  // Composer state
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<ChatMessage | null>(null);
  const [scheduleMinutes, setScheduleMinutes] = useState(1);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // Voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Voice playback state
  const [playingMsgId, setPlayingMsgId] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 1.5 | 2>(1);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Safety number & unlock
  const [safetyNumber, setSafetyNumber] = useState<string>('');
  const [unlockedConvIds, setUnlockedConvIds] = useState<Record<string, boolean>>({});
  const [unlockPinInput, setUnlockPinInput] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Offline Local Assistant & Prompt Modal State
  const [aiResult, setAiResult] = useState<string>('');
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [promptModal, setPromptModal] = useState<'export' | 'lock' | null>(null);
  const [promptValue, setPromptValue] = useState('');

  // Encrypted Media Consent & Decryption State
  const [pendingMediaFile, setPendingMediaFile] = useState<File | null>(null);
  const [blossomInputUrl, setBlossomInputUrl] = useState(
    privacy.freeMediaServerUrl || 'https://blossom.primal.net',
  );
  const [mediaActionBusy, setMediaActionBusy] = useState(false);
  const [mediaActionError, setMediaActionError] = useState<string | null>(null);
  const [decryptedMediaUrls, setDecryptedMediaUrls] = useState<Record<string, string>>({});
  const [decryptingMsgIds, setDecryptingMsgIds] = useState<Record<string, boolean>>({});

  const activeConv = useMemo(
    () => conversations.find((c) => c.convId === activeConvId) || null,
    [conversations, activeConvId],
  );

  const activePeer = useMemo(() => {
    if (!activeConv?.peerUserId) return null;
    return directoryUsers.find((u) => u.userId === activeConv.peerUserId) || null;
  }, [activeConv, directoryUsers]);

  const activeMessages = useMemo(() => {
    if (!activeConv) return [];
    return messages
      .filter((m) => m.convId === activeConv.convId && !m.deletedLocally)
      .filter((m) => !chatSearchQuery.trim() || m.text.toLowerCase().includes(chatSearchQuery.toLowerCase()))
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [messages, activeConv, chatSearchQuery]);

  const pinnedMessages = useMemo(
    () => activeMessages.filter((m) => m.isPinned && !m.deletedForEveryone),
    [activeMessages],
  );

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return conversations
      .filter((c) => {
        if (filter === 'archived') return c.isArchived;
        if (c.isArchived) return false;
        if (filter === 'unread') return c.unreadCount > 0;
        if (filter === 'pinned') return c.isPinned;
        return true;
      })
      .filter((c) => {
        if (!q) return true;
        if (c.title.toLowerCase().includes(q) || c.lastMessagePreview.toLowerCase().includes(q)) return true;
        return messages.some((m) => m.convId === c.convId && m.text.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return b.lastMessageAt - a.lastMessageAt;
      });
  }, [conversations, filter, searchQuery, messages]);

  useEffect(() => {
    if (showSafetyModal && activePeer) {
      computeSafetyNumber(keyBundle.ecdsaPublicJwk, activePeer.ecdsaPublicKeyJwk).then(setSafetyNumber);
    }
  }, [showSafetyModal, activePeer, keyBundle.ecdsaPublicJwk]);

  useEffect(() => {
    if (activeConv && activeConv.unreadCount > 0) {
      onUpdateConversation(activeConv.convId, { unreadCount: 0 });
    }
  }, [activeConv?.convId]);

  const draftValue = activeConv?.draftText || '';

  function setDraftValue(text: string) {
    if (!activeConv) return;
    onUpdateConversation(activeConv.convId, { draftText: text });
    if (privacy.sendTypingIndicators) {
      onSendTypingState(activeConv.convId, 'typing', text.trim().length > 0);
    }
  }

  function handleSubmitText(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConv) return;
    const trimmed = draftValue.trim();
    if (!trimmed) return;

    if (editingMsg) {
      onEditMessage(editingMsg.msgId, trimmed);
      setEditingMsg(null);
      onUpdateConversation(activeConv.convId, { draftText: '' });
      return;
    }

    onSendMessage(activeConv.convId, {
      kind: 'text',
      text: trimmed,
      replyTo: replyingTo
        ? {
            msgId: replyingTo.msgId,
            senderName: replyingTo.senderName,
            previewText: replyingTo.text || replyingTo.attachment?.name || replyingTo.kind,
          }
        : undefined,
    });
    setReplyingTo(null);
    onUpdateConversation(activeConv.convId, { draftText: '' });
    if (privacy.sendTypingIndicators) onSendTypingState(activeConv.convId, 'typing', false);
  }

  function handleScheduleSend() {
    if (!activeConv || !draftValue.trim()) return;
    const scheduledAt = Date.now() + scheduleMinutes * 60_000;
    onSendMessage(activeConv.convId, {
      kind: 'text',
      text: draftValue.trim(),
      scheduledAt,
    });
    onUpdateConversation(activeConv.convId, { draftText: '' });
    setShowSchedulePicker(false);
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setShowAttachMenu(false);
    if (!file || !activeConv) return;

    // Self-note or tiny files <= 45 KB can be embedded directly inside encrypted local/NIP-59 payload
    if (activeConv.convId.startsWith('self_') || file.size <= 45_000) {
      const dataUrl = await readFileAsDataUrl(file);
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      const kind: MessageKind = isImage ? 'image' : isVideo ? 'video' : 'document';
      onSendMessage(activeConv.convId, {
        kind,
        text: file.name,
        attachment: {
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          dataUrl,
        },
      });
      return;
    }

    // Larger file for remote peer -> explicitly ask user consent for transport method (P2P WebRTC vs AES-256-GCM Blossom)
    setMediaActionError(null);
    setBlossomInputUrl(privacy.freeMediaServerUrl || 'https://blossom.primal.net');
    setPendingMediaFile(file);
  }

  async function handleSendConsentedBlossomMedia() {
    if (!pendingMediaFile || !activeConv || !nostrPrivateKeyHex) return;
    setMediaActionError(null);
    setMediaActionBusy(true);
    try {
      const cleanHost = blossomInputUrl.trim().replace(/\/+$/, '');
      onUpdatePrivacy?.({ freeMediaServerUrl: cleanHost, mediaServerConsentGranted: true });
      const plainBuf = await pendingMediaFile.arrayBuffer();
      const enc = await encryptBytesAesGcm(plainBuf);
      const encryptedUrl = await uploadEncryptedBlobToBlossom(
        cleanHost,
        enc.encryptedBytes,
        enc.ciphertextSha256,
        nostrPrivateKeyHex,
      );

      const isImage = pendingMediaFile.type.startsWith('image/');
      const isVideo = pendingMediaFile.type.startsWith('video/');
      const kind: MessageKind = isImage ? 'image' : isVideo ? 'video' : 'document';
      const localPreviewUrl = pendingMediaFile.size <= 4_000_000 ? await readFileAsDataUrl(pendingMediaFile) : '';

      onSendMessage(activeConv.convId, {
        kind,
        text: pendingMediaFile.name,
        attachment: {
          name: pendingMediaFile.name,
          mimeType: pendingMediaFile.type || 'application/octet-stream',
          sizeBytes: pendingMediaFile.size,
          dataUrl: localPreviewUrl,
          encryptedUrl,
          fileKeyB64: enc.keyB64,
          fileIvB64: enc.ivB64,
          ciphertextSha256: enc.ciphertextSha256,
        },
      });
      setPendingMediaFile(null);
    } catch (err) {
      setMediaActionError(
        err instanceof Error ? err.message : 'Encrypted upload failed on remote Blossom server',
      );
    } finally {
      setMediaActionBusy(false);
    }
  }

  async function handleDecryptRemoteMedia(msg: ChatMessage) {
    const att = msg.attachment;
    if (!att?.encryptedUrl || !att.fileKeyB64 || !att.fileIvB64) return;
    setDecryptingMsgIds((p) => ({ ...p, [msg.msgId]: true }));
    try {
      const res = await fetch(att.encryptedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const plainBuf = await decryptBytesAesGcm(buf, att.fileKeyB64, att.fileIvB64, att.ciphertextSha256);
      const blob = new Blob([plainBuf], { type: att.mimeType || 'application/octet-stream' });
      const objectUrl = URL.createObjectURL(blob);
      setDecryptedMediaUrls((p) => ({ ...p, [msg.msgId]: objectUrl }));
    } catch {
      // Handled visually via fallback
    } finally {
      setDecryptingMsgIds((p) => ({ ...p, [msg.msgId]: false }));
    }
  }

  function handleShareLocation() {
    if (!activeConv) return;
    setShowAttachMenu(false);
    if (!navigator.geolocation) {
      onSendMessage(activeConv.convId, {
        kind: 'location',
        text: 'Shared Location (25.2048° N, 55.2708° E)',
        attachment: {
          name: 'Location',
          mimeType: 'application/geo',
          sizeBytes: 0,
          dataUrl: '',
          latitude: 25.2048,
          longitude: 55.2708,
          locationLabel: 'Dubai, UAE (Browser Geolocation Unavailable)',
        },
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(5));
        const lng = Number(pos.coords.longitude.toFixed(5));
        onSendMessage(activeConv.convId, {
          kind: 'location',
          text: `Location: ${lat}, ${lng}`,
          attachment: {
            name: 'Shared Location',
            mimeType: 'application/geo',
            sizeBytes: 0,
            dataUrl: '',
            latitude: lat,
            longitude: lng,
            locationLabel: `${lat}, ${lng}`,
          },
        });
      },
      () => {
        onSendMessage(activeConv.convId, {
          kind: 'location',
          text: 'Shared approximate pin',
          attachment: {
            name: 'Shared Location',
            mimeType: 'application/geo',
            sizeBytes: 0,
            dataUrl: '',
            latitude: 25.2048,
            longitude: 55.2708,
            locationLabel: 'Permission declined — manual coordinates',
          },
        });
      },
    );
  }

  function handleShareContactCard(user: PublicUser) {
    if (!activeConv) return;
    setShowAttachMenu(false);
    onSendMessage(activeConv.convId, {
      kind: 'contact',
      text: `${user.displayName} (@${user.username})`,
      attachment: {
        name: `${user.username}.vcf`,
        mimeType: 'text/vcard',
        sizeBytes: 128,
        dataUrl: '',
        contactName: user.displayName,
        contactUsername: user.username,
      },
    });
  }

  async function toggleVoiceRecording() {
    if (!activeConv) return;
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      setIsRecording(false);
      if (privacy.sendRecordingIndicators) onSendTypingState(activeConv.convId, 'recording', false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];
      setRecordSeconds(0);
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(recordChunksRef.current, { type: 'audio/webm' });
        const voiceName = `voice_${Date.now()}.webm`;
        if (!activeConv.convId.startsWith('self_') && blob.size > 45_000) {
          setMediaActionError(null);
          setBlossomInputUrl(privacy.freeMediaServerUrl || 'https://blossom.primal.net');
          setPendingMediaFile(new File([blob], voiceName, { type: 'audio/webm' }));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const waveform = Array.from({ length: 24 }, () => Math.floor(20 + Math.random() * 80));
          onSendMessage(activeConv.convId, {
            kind: 'voice',
            text: `Voice note (${recordSeconds || 1}s)`,
            attachment: {
              name: voiceName,
              mimeType: 'audio/webm',
              sizeBytes: blob.size,
              dataUrl: reader.result as string,
              durationSec: recordSeconds || 1,
              waveform,
            },
          });
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      if (privacy.sendRecordingIndicators) onSendTypingState(activeConv.convId, 'recording', true);
      recordTimerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      // Microphone unavailable
    }
  }

  function togglePlayVoice(msg: ChatMessage) {
    if (!msg.attachment?.dataUrl) return;
    if (playingMsgId === msg.msgId && audioElRef.current) {
      audioElRef.current.pause();
      setPlayingMsgId(null);
      return;
    }
    if (audioElRef.current) audioElRef.current.pause();
    const audio = new Audio(msg.attachment.dataUrl);
    audio.playbackRate = playbackSpeed;
    audio.onended = () => setPlayingMsgId(null);
    audio.play().catch(() => {});
    audioElRef.current = audio;
    setPlayingMsgId(msg.msgId);
  }

  function handleEncryptedExport() {
    if (!activeConv) return;
    setPromptValue('');
    setPromptModal('export');
  }

  async function handleToggleChatLock() {
    if (!activeConv) return;
    if (activeConv.isLocked) {
      onUpdateConversation(activeConv.convId, { isLocked: false, lockPinHash: undefined });
      return;
    }
    setPromptValue('');
    setPromptModal('lock');
  }

  async function handleSubmitPromptModal(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConv || !promptValue.trim()) return;
    const val = promptValue.trim();

    if (promptModal === 'export') {
      const payload = JSON.stringify({ conversation: activeConv, messages: activeMessages, exportedAt: Date.now() });
      const encrypted = await encryptWithPassphrase(val, new TextEncoder().encode(payload).buffer as ArrayBuffer);
      const blob = new Blob([JSON.stringify(encrypted, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeConv.title.replace(/\s+/g, '_')}.charisma-enc.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (promptModal === 'lock') {
      const hashed = await hashPin(val);
      onUpdateConversation(activeConv.convId, { isLocked: true, lockPinHash: hashed });
      setUnlockedConvIds((prev) => ({ ...prev, [activeConv.convId]: false }));
    }

    setPromptValue('');
    setPromptModal(null);
  }

  async function handleUnlockConv(e: React.FormEvent) {
    e.preventDefault();
    if (!activeConv) return;
    const hashed = await hashPin(unlockPinInput);
    if (hashed === activeConv.lockPinHash) {
      setUnlockedConvIds((prev) => ({ ...prev, [activeConv.convId]: true }));
      setUnlockPinInput('');
      setUnlockError(null);
    } else {
      setUnlockError(language === 'ar' ? 'رمز PIN غير صحيح' : 'Incorrect PIN');
    }
  }

  function runLocalAssist(action: LocalAssistAction, targetMsg?: ChatMessage) {
    setAiResult('');
    setAiSuggestions([]);
    const textInput =
      action === 'summarize'
        ? activeMessages.slice(-25).map((m) => `${m.senderName}: ${m.text}`).join('\n')
        : targetMsg?.text || draftValue;
    const res = runLocalTextAssistant(action, textInput, language);
    if (res.suggestions) setAiSuggestions(res.suggestions);
    else setAiResult(res.result || '');
    setShowAiSheet(true);
  }

  const activeChatTheme = useMemo(() => {
    if (activeConv?.customThemeId) {
      const customMatch =
        savedThemes.find((s) => s.themeId === activeConv.customThemeId) ||
        BUILTIN_THEME_PRESETS.find((b) => b.themeId === activeConv.customThemeId);
      if (customMatch) return customMatch.config;
    }
    return customization;
  }, [activeConv?.customThemeId, savedThemes, customization]);

  const isConvCurrentlyLocked = Boolean(activeConv?.isLocked && !unlockedConvIds[activeConv.convId]);

  const chatsListShellStyle = getPageShellStyle(customization, 'chatsList');
  const chatsListCardStyle = getPageCardStyle(customization, 'chatsList');
  const chatScreenPageStyle = getPageShellStyle(activeChatTheme, 'chatScreen');
  const chatScreenHeaderStyle = getPageCardStyle(activeChatTheme, 'chatScreen');

  const wallpaperStyle: React.CSSProperties = useMemo(() => {
    const dim = activeChatTheme.themeMode === 'dark' ? '#05070D' : '#F4F7FC';
    if (activeChatTheme.pageThemes?.chatScreen?.enabled) {
      return {
        ...chatScreenPageStyle,
        fontFamily: getFontStack(activeChatTheme.fontFamily),
      };
    }
    if (activeChatTheme.wallpaper === 'custom_image' && activeChatTheme.customWallpaperDataUrl) {
      return {
        backgroundImage: `linear-gradient(${hexToRgba(dim, activeChatTheme.wallpaperOverlayOpacity)}, ${hexToRgba(dim, activeChatTheme.wallpaperOverlayOpacity)}), url(${activeChatTheme.customWallpaperDataUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        fontFamily: getFontStack(activeChatTheme.fontFamily),
      };
    }
    if (activeChatTheme.wallpaper === 'gradient') {
      return {
        backgroundImage: `radial-gradient(circle at top right, ${hexToRgba(activeChatTheme.primaryAccent, 0.16)}, transparent 52%), linear-gradient(${activeChatTheme.gradientAngle}deg, ${dim}, ${hexToRgba(activeChatTheme.secondaryAccent, 0.12)})`,
        fontFamily: getFontStack(activeChatTheme.fontFamily),
      };
    }
    if (activeChatTheme.wallpaper === 'silk_dark' && activeChatTheme.themeMode === 'dark') {
      return {
        backgroundImage: `linear-gradient(${hexToRgba('#05070D', Math.max(0.4, activeChatTheme.wallpaperOverlayOpacity + 0.35))}, ${hexToRgba('#05070D', Math.max(0.5, activeChatTheme.wallpaperOverlayOpacity + 0.4))}), url('/src/assets/images/charisma_dark_wallpaper_1795329659155.jpg')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        fontFamily: getFontStack(activeChatTheme.fontFamily),
      };
    }
    return {
      ...chatScreenPageStyle,
      fontFamily: getFontStack(activeChatTheme.fontFamily),
    };
  }, [activeChatTheme, chatScreenPageStyle]);

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Conversation Sidebar */}
      <aside
        className={`${
          activeConv ? 'hidden md:flex' : 'flex'
        } w-full md:w-80 lg:w-96 flex-col border-e border-slate-200 dark:border-white/10 bg-white dark:bg-[#080C18] shrink-0`}
        style={chatsListShellStyle}
      >
        <div className="p-4 border-b border-slate-200 dark:border-white/10 space-y-3" style={chatsListCardStyle}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold">{t.navChats}</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowMyQrModal(true)}
                title={t.qrIdentityBtn}
                className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 dark:border-white/10 flex items-center justify-center hover:border-cyan-500 transition-colors"
              >
                <QrCode className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowNewGroupModal(true)}
                title={t.newGroupBtn}
                className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 dark:border-white/10 flex items-center justify-center hover:border-cyan-500 transition-colors"
              >
                <Users className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  onRefreshDirectory('');
                  setShowNewChatModal(true);
                }}
                className="min-h-[38px] px-3 rounded-lg bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>{t.newChatBtn}</span>
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.searchChatsPlaceholder}
              className="w-full min-h-[40px] ps-9 pe-3 rounded-xl bg-slate-100 dark:bg-[#0C1222] border border-transparent focus:border-cyan-500 text-xs focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#0C1222]">
            {(['all', 'unread', 'pinned', 'archived'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  filter === f
                    ? 'bg-white dark:bg-[#16203A] text-slate-900 dark:text-[#00E5FF] shadow-xs'
                    : 'text-slate-500 dark:text-[#9AA8C7]'
                }`}
              >
                {f === 'all' ? t.filterAll : f === 'unread' ? t.filterUnread : f === 'pinned' ? t.filterPinned : t.filterArchived}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-white/5">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="font-medium text-sm">{t.noChatsTitle}</p>
              <p className="text-xs text-slate-500 dark:text-[#9AA8C7] leading-relaxed">{t.noChatsBody}</p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const peer = conv.peerUserId ? directoryUsers.find((u) => u.userId === conv.peerUserId) : null;
              const isSelected = conv.convId === activeConvId;
              const padY =
                customization.density === 'compact'
                  ? 'py-2.5'
                  : customization.density === 'spacious'
                  ? 'py-4'
                  : 'py-3';

              return (
                <button
                  key={conv.convId}
                  type="button"
                  onClick={() => onSelectConv(conv.convId)}
                  className={`w-full px-4 ${padY} flex items-center gap-3 text-start transition-colors ${
                    isSelected
                      ? 'bg-cyan-500/10 dark:bg-[#00E5FF]/10'
                      : 'hover:bg-slate-50 dark:hover:bg-white/5'
                  }`}
                >
                  <div className="relative shrink-0">
                    <UserAvatar
                      avatarColor={conv.avatarColor}
                      avatarEmoji={conv.avatarEmoji}
                      avatarDataUrl={peer?.avatarDataUrl ?? (conv.peerUserId === currentUser.userId ? currentUser.avatarDataUrl : undefined)}
                      alt={conv.title}
                      sizeClass="w-11 h-11"
                      textClass="text-base"
                    />
                    {peer?.isOnline && !peer.hideOnline && (
                      <span className="w-3 h-3 rounded-full bg-emerald-400 border-2 border-white dark:border-[#080C18] absolute -bottom-0.5 -end-0.5" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate flex items-center gap-1.5">
                        {conv.title}
                        {conv.isLocked && <Lock className="w-3.5 h-3.5 text-cyan-500 shrink-0" />}
                        {conv.isMuted && <BellOff className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                      </span>
                      <span className="text-[11px] font-mono-tabular text-slate-400 shrink-0">
                        {formatLocalizedTime(conv.lastMessageAt, language)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-xs text-slate-500 dark:text-[#9AA8C7] truncate">
                        {conv.typingUserIds.length > 0
                          ? t.typing
                          : conv.recordingUserIds.length > 0
                          ? t.recording
                          : conv.draftText
                          ? `${language === 'ar' ? 'مسودة: ' : 'Draft: '}${conv.draftText}`
                          : conv.lastMessagePreview}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {conv.isPinned && <Pin className="w-3 h-3 text-violet-400" />}
                        {conv.unreadCount > 0 && (
                          <span className="text-[11px] font-mono-tabular font-bold text-cyan-600 dark:text-[#00E5FF]">
                            {conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Conversation Pane */}
      <section className={`${activeConv ? 'flex' : 'hidden md:flex'} flex-1 flex-col h-full relative`} style={wallpaperStyle}>
        {!activeConv ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <img
              src="/src/assets/images/charisma_app_icon_1795329659625.jpg"
              alt="CHARISMA"
              className="w-20 h-20 rounded-3xl object-cover border border-slate-200 dark:border-cyan-400/25"
            />
            <h3 className="font-display text-2xl font-bold">{t.appName}</h3>
            <p className="text-sm text-slate-500 dark:text-[#9AA8C7] max-w-md">{t.e2eeBadge}</p>
            <button
              type="button"
              onClick={() => {
                onRefreshDirectory('');
                setShowNewChatModal(true);
              }}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-sm font-semibold"
            >
              {t.newChatBtn}
            </button>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <header
              className="px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-white/90 dark:bg-[#0C1222]/90 backdrop-blur-md flex items-center justify-between gap-3 relative z-10"
              style={chatScreenHeaderStyle}
            >
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => onSelectConv(null)}
                  className="md:hidden min-h-[40px] min-w-[40px] rounded-lg border border-slate-200 dark:border-white/10 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
                <UserAvatar
                  avatarColor={activeConv.customThemeColor || activeConv.avatarColor}
                  avatarEmoji={activeConv.avatarEmoji}
                  avatarDataUrl={activePeer?.avatarDataUrl ?? (activeConv.peerUserId === currentUser.userId ? currentUser.avatarDataUrl : undefined)}
                  alt={activeConv.title}
                  sizeClass="w-10 h-10"
                  textClass="text-base"
                />
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm truncate">{activeConv.title}</h3>
                  <p className="text-xs text-slate-500 dark:text-[#9AA8C7] truncate">
                    {activeConv.typingUserIds.length > 0
                      ? t.typing
                      : activeConv.recordingUserIds.length > 0
                      ? t.recording
                      : activeConv.type === 'group'
                      ? `${activeConv.memberIds.length} ${language === 'ar' ? 'أعضاء' : 'members'}`
                      : activePeer?.isOnline && !activePeer.hideOnline
                      ? t.online
                      : t.offline}
                    {activeConv.disappearTtlSec > 0 && ` · ⏱ ${activeConv.disappearTtlSec}s`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0 relative">
                {activePeer && (
                  <>
                    <button
                      type="button"
                      onClick={() => onStartCall(activePeer, 'audio')}
                      aria-label={t.startAudioCall}
                      className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 flex items-center justify-center"
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartCall(activePeer, 'video')}
                      aria-label={t.startVideoCall}
                      className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 flex items-center justify-center"
                    >
                      <Video className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSafetyModal(true)}
                      title={t.verifySafetyNumber}
                      className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 flex items-center justify-center text-cyan-600 dark:text-[#00E5FF]"
                    >
                      <Shield className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setShowChatSearch((s) => !s)}
                  title={t.searchChatsPlaceholder}
                  className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 flex items-center justify-center"
                >
                  <Search className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => runLocalAssist('summarize')}
                  title={t.aiAssistBtn}
                  className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 flex items-center justify-center text-violet-500"
                >
                  <Sparkles className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowConvMenu((m) => !m)}
                  aria-label="Conversation options"
                  className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 flex items-center justify-center"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {showConvMenu && (
                  <div className="absolute top-12 end-0 w-60 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 shadow-xl p-2 z-30 space-y-1 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateConversation(activeConv.convId, { isPinned: !activeConv.isPinned });
                        setShowConvMenu(false);
                      }}
                      className="w-full px-3 py-2 rounded-lg text-start hover:bg-slate-100 dark:hover:bg-white/10 flex items-center gap-2"
                    >
                      <Pin className="w-3.5 h-3.5" />
                      <span>{activeConv.isPinned ? (language === 'ar' ? 'إلغاء التثبيت' : 'Unpin chat') : (language === 'ar' ? 'تثبيت المحادثة' : 'Pin chat')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateConversation(activeConv.convId, { isMuted: !activeConv.isMuted });
                        setShowConvMenu(false);
                      }}
                      className="w-full px-3 py-2 rounded-lg text-start hover:bg-slate-100 dark:hover:bg-white/10 flex items-center gap-2"
                    >
                      <BellOff className="w-3.5 h-3.5" />
                      <span>{activeConv.isMuted ? (language === 'ar' ? 'إلغاء الكتم' : 'Unmute') : (language === 'ar' ? 'كتم الإشعارات' : 'Mute notifications')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateConversation(activeConv.convId, { isArchived: !activeConv.isArchived });
                        setShowConvMenu(false);
                      }}
                      className="w-full px-3 py-2 rounded-lg text-start hover:bg-slate-100 dark:hover:bg-white/10 flex items-center gap-2"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>{activeConv.isArchived ? (language === 'ar' ? 'إلغاء الأرشفة' : 'Unarchive') : (language === 'ar' ? 'أرشفة المحادثة' : 'Archive chat')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateConversation(activeConv.convId, { unreadCount: Math.max(1, activeConv.unreadCount) });
                        onSelectConv(null);
                        setShowConvMenu(false);
                      }}
                      className="w-full px-3 py-2 rounded-lg text-start hover:bg-slate-100 dark:hover:bg-white/10 flex items-center gap-2"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{language === 'ar' ? 'تحديد كغير مقروءة' : 'Mark as unread'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextTtl = activeConv.disappearTtlSec === 0 ? 15 : activeConv.disappearTtlSec === 15 ? 60 : activeConv.disappearTtlSec === 60 ? 86400 : 0;
                        onUpdateConversation(activeConv.convId, { disappearTtlSec: nextTtl });
                        setShowConvMenu(false);
                      }}
                      className="w-full px-3 py-2 rounded-lg text-start hover:bg-slate-100 dark:hover:bg-white/10 flex items-center gap-2"
                    >
                      <Timer className="w-3.5 h-3.5" />
                      <span>{t.disappearingTimer}: {activeConv.disappearTtlSec === 0 ? 'Off' : `${activeConv.disappearTtlSec}s`}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleToggleChatLock();
                        setShowConvMenu(false);
                      }}
                      className="w-full px-3 py-2 rounded-lg text-start hover:bg-slate-100 dark:hover:bg-white/10 flex items-center gap-2"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>{activeConv.isLocked ? (language === 'ar' ? 'إزالة قفل المحادثة' : 'Remove chat lock') : t.chatLock}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleEncryptedExport();
                        setShowConvMenu(false);
                      }}
                      className="w-full px-3 py-2 rounded-lg text-start hover:bg-slate-100 dark:hover:bg-white/10 flex items-center gap-2"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{t.exportChatBtn}</span>
                    </button>
                    <div className="px-3 py-2 space-y-1 border-t border-slate-200 dark:border-white/10">
                      <label className="block text-[11px] text-slate-500">
                        {language === 'ar' ? 'ثيم هذه المحادثة' : 'Conversation Theme'}
                      </label>
                      <select
                        value={activeConv.customThemeId || ''}
                        onChange={(e) => {
                          onUpdateConversation(activeConv.convId, { customThemeId: e.target.value || undefined });
                          setShowConvMenu(false);
                        }}
                        className="w-full min-h-[32px] px-2 rounded-lg bg-slate-100 dark:bg-[#05070D] text-xs"
                      >
                        <option value="">{language === 'ar' ? 'الثيم العام للتطبيق' : 'Global App Theme'}</option>
                        {savedThemes.map((s) => (
                          <option key={s.themeId} value={s.themeId}>{s.name}</option>
                        ))}
                        {BUILTIN_THEME_PRESETS.map((b) => (
                          <option key={b.themeId} value={b.themeId}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onClearLocalChat(activeConv.convId);
                        setShowConvMenu(false);
                      }}
                      className="w-full px-3 py-2 rounded-lg text-start hover:bg-red-500/10 text-red-500 flex items-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t.clearChatBtn}</span>
                    </button>
                    {activePeer && activePeer.userId !== currentUser.userId && (
                      <button
                        type="button"
                        onClick={() => {
                          const isBlocked = blockedUserIds.includes(activePeer.userId);
                          onBlockUser(activePeer.userId, !isBlocked);
                          setShowConvMenu(false);
                        }}
                        className="w-full px-3 py-2 rounded-lg text-start hover:bg-red-500/10 text-red-500"
                      >
                        {blockedUserIds.includes(activePeer.userId)
                          ? (language === 'ar' ? 'إلغاء حظر المستخدم' : 'Unblock user')
                          : (language === 'ar' ? 'حظر المستخدم' : 'Block user')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </header>

            {showChatSearch && (
              <div className="px-4 py-2 border-b border-slate-200 dark:border-white/10 bg-white/80 dark:bg-[#080C18]/80 flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  placeholder={language === 'ar' ? 'بحث داخل المحادثة...' : 'Search in conversation...'}
                  className="flex-1 bg-transparent text-xs focus:outline-none"
                />
                <button type="button" onClick={() => { setChatSearchQuery(''); setShowChatSearch(false); }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {pinnedMessages.length > 0 && !isConvCurrentlyLocked && (
              <div className="px-4 py-2 border-b border-slate-200 dark:border-white/10 bg-cyan-500/10 text-xs flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 truncate">
                  <Pin className="w-3.5 h-3.5 text-cyan-600 dark:text-[#00E5FF] shrink-0" />
                  <span className="truncate">{pinnedMessages[pinnedMessages.length - 1].text}</span>
                </div>
              </div>
            )}

            {/* Lock Gate or Messages */}
            {isConvCurrentlyLocked ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <form
                  onSubmit={handleUnlockConv}
                  className="max-w-sm w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 rounded-2xl p-6 space-y-4 text-center"
                >
                  <Lock className="w-10 h-10 text-cyan-500 mx-auto" />
                  <h4 className="font-semibold">{t.chatLockedNotice}</h4>
                  <input
                    type="password"
                    value={unlockPinInput}
                    onChange={(e) => setUnlockPinInput(e.target.value)}
                    placeholder="PIN"
                    className="w-full min-h-[44px] px-4 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/15 text-center font-mono-tabular"
                  />
                  {unlockError && <p className="text-xs text-red-500">{unlockError}</p>}
                  <button
                    type="submit"
                    className="w-full min-h-[44px] rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-sm font-semibold"
                  >
                    {t.unlockChatBtn}
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3 relative z-10">
                {activeMessages.map((msg) => {
                  const isMine = msg.senderId === currentUser.userId;
                  const bubbleBaseColor = isMine
                    ? activeConv.customThemeColor || activeChatTheme.outgoingBubbleColor
                    : activeChatTheme.incomingBubbleColor;
                  const useGradientBubble = isMine && activeChatTheme.gradientEnabled;

                  return (
                    <div
                      key={msg.msgId}
                      className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} group`}
                    >
                      <div
                        className={`max-w-[82%] sm:max-w-[68%] px-4 py-2.5 border ${
                          activeChatTheme.themeMode === 'light' && !isMine
                            ? 'border-slate-200 text-slate-900'
                            : activeChatTheme.themeMode === 'light' && isMine
                            ? 'border-cyan-200 text-slate-900'
                            : 'border-white/10 text-[#F2F6FF]'
                        }`}
                        style={{
                          ...getBubbleCornerStyle(activeChatTheme, isMine, language === 'ar'),
                          boxShadow: getShadowCss(
                            activeChatTheme.bubbleShadow,
                            isMine ? activeChatTheme.primaryAccent : activeChatTheme.secondaryAccent,
                          ),
                          background: useGradientBubble
                            ? `linear-gradient(${activeChatTheme.gradientAngle}deg, ${hexToRgba(bubbleBaseColor, activeChatTheme.bubbleOpacity)}, ${hexToRgba(activeChatTheme.secondaryAccent, activeChatTheme.bubbleOpacity)})`
                            : activeChatTheme.themeMode === 'dark' || activeConv.customThemeId
                            ? hexToRgba(bubbleBaseColor, activeChatTheme.bubbleOpacity)
                            : isMine
                            ? hexToRgba('#E0F2FE', activeChatTheme.bubbleOpacity)
                            : hexToRgba('#FFFFFF', activeChatTheme.bubbleOpacity),
                        }}
                      >
                        {activeConv.type === 'group' && !isMine && (
                          <div className="text-[11px] font-semibold text-cyan-500 mb-1">
                            {msg.senderName}
                          </div>
                        )}

                        {msg.forwardedFrom && (
                          <div className="text-[11px] text-slate-400 italic mb-1">
                            {language === 'ar' ? `محولة من ${msg.forwardedFrom}` : `Forwarded from ${msg.forwardedFrom}`}
                          </div>
                        )}

                        {msg.replyTo && (
                          <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-black/15 dark:bg-black/30 text-xs border border-white/10">
                            <div className="font-semibold text-cyan-400">{msg.replyTo.senderName}</div>
                            <div className="truncate opacity-80">{msg.replyTo.previewText}</div>
                          </div>
                        )}

                        {msg.deletedForEveryone ? (
                          <p className="text-xs italic opacity-60">
                            {language === 'ar' ? 'تم طلب حذف هذه الرسالة' : 'Message deleted'}
                          </p>
                        ) : (
                          <>
                            {msg.kind === 'image' && (msg.attachment?.dataUrl || decryptedMediaUrls[msg.msgId]) && (
                              <img
                                src={decryptedMediaUrls[msg.msgId] || msg.attachment?.dataUrl}
                                alt={msg.attachment?.name || 'image'}
                                className="rounded-xl max-h-64 object-cover mb-2"
                              />
                            )}
                            {msg.kind === 'video' && (msg.attachment?.dataUrl || decryptedMediaUrls[msg.msgId]) && (
                              <video
                                src={decryptedMediaUrls[msg.msgId] || msg.attachment?.dataUrl}
                                controls
                                className="rounded-xl max-h-64 mb-2"
                              />
                            )}
                            {msg.attachment?.encryptedUrl && !msg.attachment.dataUrl && !decryptedMediaUrls[msg.msgId] && (
                              <button
                                type="button"
                                disabled={decryptingMsgIds[msg.msgId]}
                                onClick={() => handleDecryptRemoteMedia(msg)}
                                className="w-full mb-2 px-3 py-2 rounded-xl bg-black/20 hover:bg-black/30 text-xs font-semibold flex items-center justify-center gap-2"
                              >
                                <Lock className="w-3.5 h-3.5 text-cyan-400" />
                                <span>
                                  {decryptingMsgIds[msg.msgId]
                                    ? language === 'ar' ? 'جارٍ التنزيل وفك التشفير AES-256-GCM...' : 'Decrypting AES-256-GCM...'
                                    : language === 'ar'
                                    ? `تنزيل وفك تشفير (${msg.attachment.name})`
                                    : `Download & Decrypt (${msg.attachment.name})`}
                                </span>
                              </button>
                            )}
                            {msg.kind === 'document' && msg.attachment && (msg.attachment.dataUrl || decryptedMediaUrls[msg.msgId]) && (
                              <a
                                href={decryptedMediaUrls[msg.msgId] || msg.attachment.dataUrl}
                                download={msg.attachment.name}
                                className="flex items-center gap-2.5 p-2.5 rounded-xl bg-black/15 mb-1.5 hover:bg-black/25"
                              >
                                <FileText className="w-5 h-5 text-cyan-400 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-medium truncate">{msg.attachment.name}</div>
                                  <div className="text-[11px] opacity-70">{formatBytes(msg.attachment.sizeBytes, language)}</div>
                                </div>
                                <Download className="w-4 h-4 shrink-0" />
                              </a>
                            )}
                            {msg.kind === 'voice' && msg.attachment && (
                              <div className="flex items-center gap-2.5 min-w-[210px]">
                                <button
                                  type="button"
                                  onClick={() => togglePlayVoice(msg)}
                                  className="w-9 h-9 rounded-full bg-cyan-500 text-[#041018] flex items-center justify-center shrink-0"
                                >
                                  {playingMsgId === msg.msgId ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                </button>
                                <div className="flex-1 flex items-center gap-0.5 h-7">
                                  {(msg.attachment.waveform || [35, 65, 45, 80, 50, 70, 40, 60, 85, 55]).map((h, i) => (
                                    <span
                                      key={i}
                                      className="flex-1 rounded-full bg-cyan-400/75"
                                      style={{ height: `${Math.max(20, h)}%` }}
                                    />
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setPlaybackSpeed((s) => (s === 1 ? 1.5 : s === 1.5 ? 2 : 1))}
                                  className="text-[11px] font-mono-tabular px-1.5 py-0.5 rounded bg-black/20"
                                >
                                  {playbackSpeed}x
                                </button>
                              </div>
                            )}
                            {msg.kind === 'location' && msg.attachment && (
                              <div className="flex items-center gap-2 text-xs">
                                <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
                                <span>{msg.attachment.locationLabel}</span>
                              </div>
                            )}
                            {msg.kind === 'contact' && msg.attachment && (
                              <div className="flex items-center gap-2 text-xs">
                                <UserPlus className="w-4 h-4 text-violet-400 shrink-0" />
                                <span>{msg.attachment.contactName} (@{msg.attachment.contactUsername})</span>
                              </div>
                            )}
                            {(msg.kind === 'text' || (msg.text && msg.kind !== 'voice' && msg.kind !== 'location' && msg.kind !== 'contact')) && (
                              <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ fontSize: `${14 * customization.fontScale}px` }}>
                                {msg.text}
                              </p>
                            )}
                          </>
                        )}

                        {/* Metadata footer */}
                        <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[10px] opacity-70 font-mono-tabular">
                          {msg.deliveryMode === 'nip17' && (
                            <span title="NIP-17 + NIP-44 + NIP-59 Gift Wrap">
                              NIP-17{typeof msg.relayAckCount === 'number' && msg.relayAckCount > 0 ? `(${msg.relayAckCount}R)` : ''}
                            </span>
                          )}
                          {msg.scheduledAt && msg.scheduledAt > Date.now() && <Clock className="w-3 h-3" />}
                          {msg.isStarred && <Star className="w-3 h-3 fill-amber-400 text-amber-400" />}
                          {msg.isPinned && <Pin className="w-3 h-3 text-violet-400" />}
                          {msg.editedAt && <span>{language === 'ar' ? 'معدلة' : 'edited'}</span>}
                          <span>{formatLocalizedTime(msg.createdAt, language)}</span>
                          {isMine && (
                            msg.status === 'read' ? (
                              <CheckCheck className="w-3.5 h-3.5 text-cyan-400" />
                            ) : msg.status === 'delivered' ? (
                              <CheckCheck className="w-3.5 h-3.5" />
                            ) : msg.status === 'sent' ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              <Clock className="w-3 h-3" />
                            )
                          )}
                        </div>
                      </div>

                      {/* Reactions row */}
                      {Object.keys(msg.reactions).length > 0 && (
                        <div className="flex items-center gap-1 mt-1 px-1">
                          {Object.entries(msg.reactions).map(([emoji, uids]) =>
                            uids.length > 0 ? (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => onReactMessage(msg.msgId, emoji)}
                                className="px-2 py-0.5 rounded-full text-xs bg-white dark:bg-[#11192E] border border-slate-200 dark:border-white/10"
                              >
                                {emoji} {uids.length}
                              </button>
                            ) : null,
                          )}
                        </div>
                      )}

                      {/* Hover action bar */}
                      {!msg.deletedForEveryone && (
                        <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-1 mt-1 px-1 text-slate-500 dark:text-[#9AA8C7]">
                          {REACTION_CHOICES.slice(0, 4).map((em) => (
                            <button
                              key={em}
                              type="button"
                              onClick={() => onReactMessage(msg.msgId, em)}
                              className="text-xs hover:scale-125 transition-transform px-0.5"
                            >
                              {em}
                            </button>
                          ))}
                          <button type="button" onClick={() => setReplyingTo(msg)} title="Reply" className="p-1 hover:text-cyan-500">
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => setForwardingMsg(msg)} title="Forward" className="p-1 hover:text-cyan-500">
                            <Forward className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => navigator.clipboard.writeText(msg.text || '')} title="Copy" className="p-1 hover:text-cyan-500">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => onToggleStarMessage(msg.msgId)} title="Star" className="p-1 hover:text-amber-400">
                            <Star className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => onTogglePinMessage(msg.msgId)} title="Pin" className="p-1 hover:text-violet-400">
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => runLocalAssist('suggest_replies', msg)} title="Local quick replies" className="p-1 hover:text-violet-400">
                            <Sparkles className="w-3.5 h-3.5" />
                          </button>
                          {isMine && msg.kind === 'text' && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMsg(msg);
                                onUpdateConversation(activeConv.convId, { draftText: msg.text });
                              }}
                              title="Edit"
                              className="p-1 hover:text-cyan-500"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteMessage(msg.msgId, isMine)}
                            title={isMine ? 'Delete for everyone' : 'Delete locally'}
                            className="p-1 hover:text-red-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Composer */}
            {!isConvCurrentlyLocked && (
              <div className="p-3 border-t border-slate-200 dark:border-white/10 bg-white/95 dark:bg-[#0C1222]/95 backdrop-blur-md space-y-2 relative">
                {(replyingTo || editingMsg) && (
                  <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-[#11192E] text-xs">
                    <div className="truncate">
                      <span className="font-semibold text-cyan-600 dark:text-[#00E5FF]">
                        {editingMsg ? t.editingMessage : `${t.replyingTo} ${replyingTo?.senderName}`}:{' '}
                      </span>
                      <span className="opacity-80">{editingMsg ? editingMsg.text : replyingTo?.text}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setReplyingTo(null);
                        setEditingMsg(null);
                      }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {showAttachMenu && (
                  <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-slate-100 dark:bg-[#11192E] text-xs">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-2 rounded-lg bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center gap-1.5"
                    >
                      <Paperclip className="w-3.5 h-3.5 text-cyan-500" />
                      <span>{t.attachFile} (Image / Video / PDF)</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleShareLocation}
                      className="px-3 py-2 rounded-lg bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center gap-1.5"
                    >
                      <MapPin className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{t.shareLocation}</span>
                    </button>
                    {directoryUsers[0] && (
                      <button
                        type="button"
                        onClick={() => handleShareContactCard(directoryUsers[0])}
                        className="px-3 py-2 rounded-lg bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center gap-1.5"
                      >
                        <UserPlus className="w-3.5 h-3.5 text-violet-500" />
                        <span>{t.shareContact} (@{directoryUsers[0].username})</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => runLocalAssist('suggest_replies')}
                      className="px-3 py-2 rounded-lg bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                      <span>{language === 'ar' ? 'ردود سريعة محلية' : 'Local Quick Replies'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runLocalAssist('clean_format')}
                      className="px-3 py-2 rounded-lg bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      <span>{language === 'ar' ? 'تنسيق المسودة محلياً' : 'Format Draft Locally'}</span>
                    </button>
                  </div>
                )}

                {showSchedulePicker && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#11192E] text-xs">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-cyan-500" />
                      <span>{language === 'ar' ? 'جدولة الإرسال بعد (دقائق):' : 'Schedule delivery in (min):'}</span>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={scheduleMinutes}
                        onChange={(e) => setScheduleMinutes(Number(e.target.value) || 1)}
                        className="w-16 px-2 py-1 rounded bg-white dark:bg-[#05070D] border border-slate-200 dark:border-white/15 font-mono-tabular"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleScheduleSend}
                      className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white font-medium"
                    >
                      {t.scheduleSend}
                    </button>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,.pdf,.doc,.docx,.txt"
                  onChange={handleFileSelected}
                  className="hidden"
                />

                <form onSubmit={handleSubmitText} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAttachMenu((s) => !s)}
                    aria-label={t.attachFile}
                    className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-white/10 flex items-center justify-center hover:border-cyan-500"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  <input
                    type="text"
                    value={draftValue}
                    onChange={(e) => setDraftValue(e.target.value)}
                    placeholder={isRecording ? `${t.recording} (${recordSeconds}s)` : t.messagePlaceholder}
                    disabled={isRecording}
                    className="flex-1 min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-[#05070D] border border-transparent focus:border-cyan-500 text-sm focus:outline-none"
                  />

                  <button
                    type="button"
                    onClick={() => setShowSchedulePicker((s) => !s)}
                    aria-label={t.scheduleSend}
                    className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 dark:border-white/10 flex items-center justify-center hover:border-cyan-500"
                  >
                    <Clock className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={toggleVoiceRecording}
                    aria-label={t.voiceNote}
                    className={`min-h-[44px] min-w-[44px] rounded-xl border flex items-center justify-center ${
                      isRecording
                        ? 'bg-red-500 border-red-500 text-white'
                        : 'border-slate-200 dark:border-white/10 hover:border-cyan-500'
                    }`}
                  >
                    {isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>

                  <button
                    type="submit"
                    disabled={!draftValue.trim()}
                    aria-label="Send"
                    className="min-h-[44px] min-w-[44px] rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] flex items-center justify-center disabled:opacity-40"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            )}
          </>
        )}
      </section>

      {/* Modal: New Direct Chat */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">{t.newChatBtn}</h3>
              <button type="button" onClick={() => setShowNewChatModal(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={dirQuery}
                onChange={(e) => {
                  setDirQuery(e.target.value);
                  onRefreshDirectory(e.target.value);
                }}
                placeholder={language === 'ar' ? 'ابحث باسم المستخدم @username...' : 'Search local @username...'}
                className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm focus:outline-none"
              />
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-white/10">
              <button
                type="button"
                onClick={() => {
                  onStartDirectChat(currentUser);
                  setShowNewChatModal(false);
                }}
                className="w-full py-3 flex items-center gap-3 text-start hover:bg-slate-50 dark:hover:bg-white/5 px-2 rounded-xl"
              >
                <UserAvatar
                  avatarColor={currentUser.avatarColor}
                  avatarEmoji={currentUser.avatarEmoji}
                  avatarDataUrl={currentUser.avatarDataUrl}
                  alt={currentUser.displayName}
                  sizeClass="w-10 h-10"
                  textClass="text-sm"
                  roundedClass="rounded-xl"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {language === 'ar' ? 'مفكرتي الشخصية المشفرة (أنت)' : 'Note to Self (Encrypted Personal Space)'}
                  </div>
                  <div className="text-xs text-slate-500 font-mono-tabular">@{currentUser.username}</div>
                </div>
              </button>
              {directoryUsers.length === 0 ? (
                <p className="py-5 text-center text-xs text-slate-500">
                  {language === 'ar'
                    ? 'لا توجد حسابات محلية أخرى على هذا الجهاز بعد. يمكنك إنشاء حساب محلي ثانٍ لتجربة المراسلة المشفرة دون إنترنت.'
                    : 'No other local accounts on this device yet. Create a second local account to message locally offline.'}
                </p>
              ) : (
                directoryUsers.map((u) => (
                  <button
                    key={u.userId}
                    type="button"
                    onClick={() => {
                      onStartDirectChat(u);
                      setShowNewChatModal(false);
                    }}
                    className="w-full py-3 flex items-center gap-3 text-start hover:bg-slate-50 dark:hover:bg-white/5 px-2 rounded-xl"
                  >
                    <UserAvatar
                      avatarColor={u.avatarColor}
                      avatarEmoji={u.avatarEmoji}
                      avatarDataUrl={u.avatarDataUrl}
                      alt={u.displayName}
                      sizeClass="w-10 h-10"
                      textClass="text-sm"
                      roundedClass="rounded-xl"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.displayName}</div>
                      <div className="text-xs text-slate-500 font-mono-tabular">
                        @{u.username} {u.bio ? `· ${u.bio}` : ''}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: New Group */}
      {showNewGroupModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">{t.newGroupBtn}</h3>
              <button type="button" onClick={() => setShowNewGroupModal(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder={language === 'ar' ? 'اسم المجموعة' : 'Group name'}
              className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm"
            />
            <input
              type="text"
              value={groupDesc}
              onChange={(e) => setGroupDesc(e.target.value)}
              placeholder={language === 'ar' ? 'وصف المجموعة' : 'Group description'}
              className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm"
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={groupAdminsOnly}
                onChange={(e) => setGroupAdminsOnly(e.target.checked)}
              />
              <span>{language === 'ar' ? 'تقييد الإرسال للمشرفين فقط' : 'Restrict messaging to admins only'}</span>
            </label>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {directoryUsers.map((u) => {
                const checked = selectedGroupMemberIds.includes(u.userId);
                return (
                  <label key={u.userId} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-white/5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedGroupMemberIds((prev) =>
                          checked ? prev.filter((id) => id !== u.userId) : [...prev, u.userId],
                        )
                      }
                    />
                    <span>{u.displayName} (@{u.username})</span>
                  </label>
                );
              })}
            </div>
            <button
              type="button"
              disabled={!groupTitle.trim()}
              onClick={() => {
                const members = directoryUsers.filter((u) => selectedGroupMemberIds.includes(u.userId));
                onCreateGroup(groupTitle.trim(), groupDesc.trim(), members, groupAdminsOnly);
                setGroupTitle('');
                setGroupDesc('');
                setSelectedGroupMemberIds([]);
                setShowNewGroupModal(false);
              }}
              className="w-full min-h-[44px] rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] text-sm font-semibold disabled:opacity-50"
            >
              {t.newGroupBtn}
            </button>
          </div>
        </div>
      )}

      {/* Modal: My QR Identity */}
      {showMyQrModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-sm w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-2xl p-6 text-center space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">{t.qrIdentityBtn}</h3>
              <button type="button" onClick={() => setShowMyQrModal(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <QrCodeDisplay
              value={buildUserQrPayload(currentUser)}
              label={`@${currentUser.username}`}
            />
            <p className="text-xs text-slate-500 dark:text-[#9AA8C7]">
              {language === 'ar'
                ? 'امسح هذا الرمز للتحقق من الهوية وإضافة جهة الاتصال فوراً.'
                : 'Scan this QR identity to verify cryptographic fingerprint and add contact.'}
            </p>
          </div>
        </div>
      )}

      {/* Modal: Safety Number */}
      {showSafetyModal && activePeer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-2xl p-6 text-center space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">{t.verifySafetyNumber}</h3>
              <button type="button" onClick={() => setShowSafetyModal(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <QrCodeDisplay value={`charisma-safety:${safetyNumber}`} size={150} />
            <div className="p-3 rounded-xl bg-slate-100 dark:bg-[#05070D] font-mono-tabular text-sm tracking-wider leading-relaxed">
              {safetyNumber}
            </div>
            <p className="text-xs text-slate-500 dark:text-[#9AA8C7]">{t.safetyNumberDesc}</p>
          </div>
        </div>
      )}

      {/* Modal: Forward Message */}
      {forwardingMsg && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-sm w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-2xl p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{language === 'ar' ? 'تحويل الرسالة إلى' : 'Forward message to'}</h3>
              <button type="button" onClick={() => setForwardingMsg(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1">
              {conversations.map((c) => (
                <button
                  key={c.convId}
                  type="button"
                  onClick={() => {
                    onSendMessage(c.convId, {
                      kind: forwardingMsg.kind,
                      text: forwardingMsg.text,
                      attachment: forwardingMsg.attachment,
                      forwardedFrom: forwardingMsg.senderName,
                    });
                    setForwardingMsg(null);
                  }}
                  className="w-full px-3 py-2 rounded-xl text-start text-sm hover:bg-slate-100 dark:hover:bg-white/10"
                >
                  {c.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Offline Smart Tools Sheet */}
      {showAiSheet && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-violet-400" />
                <h3 className="font-display text-lg font-semibold">{t.aiAssistBtn}</h3>
              </div>
              <button type="button" onClick={() => setShowAiSheet(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            {aiResult && (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/10 text-sm whitespace-pre-wrap">
                {aiResult}
                {activeConv && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateConversation(activeConv.convId, { draftText: aiResult });
                        setShowAiSheet(false);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-xs font-medium"
                    >
                      {language === 'ar' ? 'إدراج في المسودة' : 'Insert into draft'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {aiSuggestions.length > 0 && (
              <div className="space-y-2">
                {aiSuggestions.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      if (activeConv) onUpdateConversation(activeConv.convId, { draftText: s });
                      setShowAiSheet(false);
                    }}
                    className="w-full p-3 rounded-xl bg-slate-50 dark:bg-[#05070D] border border-slate-200 dark:border-white/10 text-start text-sm hover:border-cyan-500"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Passphrase / PIN Prompt (replaces window.prompt) */}
      {promptModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitPromptModal}
            className="max-w-sm w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">
                {promptModal === 'export'
                  ? (language === 'ar' ? 'تشفير ملف التصدير' : 'Encrypt Conversation Export')
                  : (language === 'ar' ? 'قفل المحادثة برمز PIN' : 'Set Local Chat Lock PIN')}
              </h3>
              <button type="button" onClick={() => setPromptModal(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="password"
              required
              autoFocus
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              placeholder={
                promptModal === 'export'
                  ? (language === 'ar' ? 'أدخل كلمة مرور للتصدير...' : 'Enter export passphrase...')
                  : (language === 'ar' ? 'أدخل رمز PIN...' : 'Enter PIN...')
              }
              className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-sm focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPromptModal(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-xs">
                {t.cancel}
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-cyan-600 text-white text-xs font-semibold">
                {t.confirm}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Explicit User-Consented Encrypted File Transport (P2P WebRTC vs AES-256-GCM Blossom) */}
      {pendingMediaFile && activeConv && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold flex items-center gap-2">
                <Lock className="w-4 h-4 text-cyan-500" />
                <span>{language === 'ar' ? 'موافقة إرسال ملف مشفر' : 'Encrypted File Delivery Consent'}</span>
              </h3>
              <button type="button" onClick={() => setPendingMediaFile(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-100 dark:bg-[#05070D] text-xs space-y-0.5">
              <div className="font-semibold truncate">{pendingMediaFile.name}</div>
              <div className="text-slate-500 font-mono-tabular">
                {formatBytes(pendingMediaFile.size, language)} · {pendingMediaFile.type || 'application/octet-stream'}
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-[#9AA8C7] leading-relaxed">
              {language === 'ar'
                ? 'شبكة Nostr تنقل الأحداث النصية المشفرة ولا تخزن الملفات الكبيرة مباشرة. اختر وسيلة النقل:'
                : 'Nostr relays transport signed events rather than large binary blobs. Choose your encrypted delivery path:'}
            </p>

            {activePeer && onStartDirectTransfer && (
              <button
                type="button"
                disabled={mediaActionBusy}
                onClick={async () => {
                  const file = pendingMediaFile;
                  setPendingMediaFile(null);
                  await onStartDirectTransfer(activePeer, file);
                }}
                className="w-full min-h-[42px] px-4 rounded-xl bg-emerald-600 text-white text-xs font-semibold flex items-center justify-center gap-2"
              >
                <Shield className="w-4 h-4" />
                <span>
                  {language === 'ar'
                    ? 'الأولوية 1: إرسال P2P مباشر (WebRTC دون خادم ملفات)'
                    : 'Option A: Direct P2P WebRTC (Zero File Host)'}
                </span>
              </button>
            )}

            <div className="p-3.5 rounded-2xl border border-cyan-500/30 bg-cyan-500/5 space-y-2.5 text-xs">
              <div className="font-semibold flex items-center gap-1.5 text-cyan-600 dark:text-[#00E5FF]">
                <UploadCloud className="w-4 h-4 shrink-0" />
                <span>
                  {language === 'ar'
                    ? 'الأولوية 2: تشفير AES-256-GCM محلياً + رفع إلى Blossom'
                    : 'Option B: AES-256-GCM Client Encrypt + Blossom Host'}
                </span>
              </div>
              <input
                type="text"
                dir="ltr"
                value={blossomInputUrl}
                onChange={(e) => setBlossomInputUrl(e.target.value)}
                placeholder="https://blossom.primal.net"
                className="w-full min-h-[38px] px-3 rounded-lg bg-white dark:bg-[#05070D] border border-slate-200 dark:border-white/15 font-mono-tabular text-xs"
              />
              <p className="text-[11px] opacity-80">
                {language === 'ar'
                  ? 'يتم تشفير الملف بالكامل على جهازك قبل الرفع، ولا يُرسل مفتاح فك التشفير إلا للطرف الآخر داخل NIP-59 Gift Wrap.'
                  : 'File is encrypted locally before upload; decryption key/IV is sent exclusively to your recipient inside a NIP-59 Gift Wrap.'}
              </p>
              {mediaActionError && (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-[11px]">
                  {mediaActionError}
                </div>
              )}
              <button
                type="button"
                disabled={mediaActionBusy || !blossomInputUrl.trim().startsWith('https://')}
                onClick={handleSendConsentedBlossomMedia}
                className="w-full min-h-[40px] px-4 rounded-xl bg-cyan-600 dark:bg-[#00E5FF] text-white dark:text-[#041018] font-semibold disabled:opacity-50"
              >
                {mediaActionBusy
                  ? language === 'ar' ? 'جارٍ التشفير والرفع...' : 'Encrypting & Uploading...'
                  : language === 'ar' ? 'أوافق: تشفير AES-256-GCM ورفع الآن' : 'Consent: Encrypt & Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
