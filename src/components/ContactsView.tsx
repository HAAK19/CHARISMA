import React, { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Link2,
  MessageSquare,
  Phone,
  QrCode,
  ScanLine,
  Search,
  Send,
  ShieldAlert,
  Star,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Video,
  Wifi,
  X,
} from 'lucide-react';
import {
  AppLanguage,
  CustomizationConfig,
  FriendRequestRecord,
  PublicUser,
} from '../types/charisma';
import { TRANSLATIONS, formatLocalizedDate } from '../i18n/translations';
import { localDb } from '../storage/localDb';
import { parseNostrPublicIdentifier } from '../nostr/nostrIdentity';
import { getPageCardStyle, getPageShellStyle } from '../utils/themeEngine';
import {
  buildProfileShareLink,
  buildUserQrPayload,
  buildWebInviteUrl,
  ScannedQrIdentity,
} from '../utils/qrIdentity';
import { QrCodeDisplay } from './QrCodeDisplay';
import { QrScannerModal } from './QrScannerModal';
import { UserAvatar } from './UserAvatar';

interface ContactsViewProps {
  language: AppLanguage;
  currentUser: PublicUser;
  allUsers: PublicUser[];
  blockedUserIds: string[];
  friendRequests: {
    incoming: FriendRequestRecord[];
    outgoing: FriendRequestRecord[];
  };
  customization: CustomizationConfig;
  connectedRelayCount: number;
  nip50RelayCount: number;
  onSendFriendRequest: (toUserId: string, toNostrPubkeyHex?: string) => Promise<void>;
  onAcceptFriendRequest: (requestId: string) => Promise<void>;
  onDeclineFriendRequest: (requestId: string) => Promise<void>;
  onCancelFriendRequest: (requestId: string) => Promise<void>;
  onRemoveFriend: (friendUserId: string) => Promise<void>;
  onToggleFavorite: (targetUserId: string) => Promise<void>;
  onLookupNostrPubkey: (identifier: string, fallbackMeta?: Partial<PublicUser>) => Promise<PublicUser | null>;
  onSearchNip50Users: (query: string) => Promise<PublicUser[]>;
  onStartDirectChat: (peer: PublicUser) => void;
  onStartCall: (peer: PublicUser, kind: 'audio' | 'video') => void;
  onBlockUser: (userId: string, block: boolean) => Promise<void>;
  pendingInspectPeer?: PublicUser | null;
  onClearPendingInspectPeer?: () => void;
}

type ContactsTab = 'friends' | 'favorites' | 'search' | 'requests' | 'blocked';

export const ContactsView: React.FC<ContactsViewProps> = ({
  language,
  currentUser,
  allUsers,
  blockedUserIds,
  friendRequests,
  customization,
  connectedRelayCount,
  nip50RelayCount,
  onSendFriendRequest,
  onAcceptFriendRequest,
  onDeclineFriendRequest,
  onCancelFriendRequest,
  onRemoveFriend,
  onToggleFavorite,
  onLookupNostrPubkey,
  onSearchNip50Users,
  onStartDirectChat,
  onStartCall,
  onBlockUser,
  pendingInspectPeer,
  onClearPendingInspectPeer,
}) => {
  const t = TRANSLATIONS[language];
  const [activeSubTab, setActiveSubTab] = useState<ContactsTab>('friends');
  const [friendFilter, setFriendFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);

  const [showMyQr, setShowMyQr] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Profile preview modal (for local real users OR external scanned QR cards)
  const [inspectedUser, setInspectedUser] = useState<PublicUser | null>(null);
  const [externalQrProfile, setExternalQrProfile] = useState<ScannedQrIdentity | null>(null);

  const shellStyle = getPageShellStyle(customization, 'contacts');
  const cardStyle = getPageCardStyle(customization, 'contacts');
  const pageAccent =
    customization.pageThemes.contacts?.enabled && customization.pageThemes.contacts.accentColor
      ? customization.pageThemes.contacts.accentColor
      : customization.primaryAccent;

  const userById = useMemo(() => {
    const map = new Map<string, PublicUser>();
    for (const u of allUsers) map.set(u.userId, u);
    return map;
  }, [allUsers]);

  const favoriteIds = currentUser.favoriteIds || [];

  const friendsList = useMemo(() => {
    const q = friendFilter.trim().toLowerCase().replace(/^@/, '');
    return currentUser.friendIds
      .map((fid) => userById.get(fid))
      .filter((u): u is PublicUser => Boolean(u))
      .filter((u) => !blockedUserIds.includes(u.userId))
      .filter((u) => {
        if (!q) return true;
        return (
          u.username.toLowerCase().includes(q) ||
          u.userId.toLowerCase().includes(q) ||
          (u.npub || '').toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q)
        );
      });
  }, [currentUser.friendIds, userById, blockedUserIds, friendFilter]);

  const favoritesList = useMemo(() => {
    return favoriteIds
      .map((fid) => userById.get(fid))
      .filter((u): u is PublicUser => Boolean(u))
      .filter((u) => !blockedUserIds.includes(u.userId));
  }, [favoriteIds, userById, blockedUserIds]);

  const blockedUsersList = useMemo(
    () =>
      blockedUserIds
        .map((bid) => userById.get(bid))
        .filter((u): u is PublicUser => Boolean(u)),
    [blockedUserIds, userById],
  );

  // Real discovery: Nostr Public Key (npub/nprofile/hex) OR Local + NIP-50 Search Relays (zero fake users)
  useEffect(() => {
    let active = true;
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const parsedPub = parseNostrPublicIdentifier(trimmed);
        if (parsedPub) {
          if (parsedPub.pubkeyHex === currentUser.nostrPubkeyHex) {
            if (active) {
              setSearchResults([]);
              setSearching(false);
            }
            return;
          }
          const remoteOrCached = await onLookupNostrPubkey(trimmed);
          if (active) {
            setSearchResults(remoteOrCached ? [remoteOrCached] : []);
            setSearching(false);
          }
          return;
        }

        const [localMatches, nip50Matches] = await Promise.all([
          localDb.searchLocalUsers(currentUser.userId, trimmed),
          nip50RelayCount > 0 ? onSearchNip50Users(trimmed) : Promise.resolve([]),
        ]);
        if (!active) return;

        const merged = new Map<string, PublicUser>();
        for (const u of [...localMatches, ...nip50Matches]) {
          if (u.userId === currentUser.userId || u.nostrPubkeyHex === currentUser.nostrPubkeyHex) continue;
          merged.set(u.nostrPubkeyHex || u.userId, u);
        }
        setSearchResults(Array.from(merged.values()));
      } finally {
        if (active) setSearching(false);
      }
    }, 240);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchQuery, currentUser.userId, currentUser.nostrPubkeyHex, allUsers, nip50RelayCount, onLookupNostrPubkey, onSearchNip50Users]);

  // Keep inspectedUser synced with latest allUsers updates
  useEffect(() => {
    if (!inspectedUser) return;
    const updated = userById.get(inspectedUser.userId);
    if (updated) setInspectedUser(updated);
  }, [allUsers, inspectedUser, userById]);

  useEffect(() => {
    if (!pendingInspectPeer) return;
    setExternalQrProfile(null);
    setInspectedUser(pendingInspectPeer);
    onClearPendingInspectPeer?.();
  }, [pendingInspectPeer, onClearPendingInspectPeer]);

  function copyText(value: string, labelKey: string) {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedKey(labelKey);
    window.setTimeout(() => setCopiedKey(null), 1800);
  }

  async function handleQrDetected(identity: ScannedQrIdentity) {
    setShowScanner(false);
    setActionFeedback(null);

    if (
      identity.userId === currentUser.userId ||
      (identity.nostrPubkeyHex && identity.nostrPubkeyHex === currentUser.nostrPubkeyHex)
    ) {
      setShowMyQr(true);
      return;
    }

    if (identity.nostrPubkeyHex || identity.npub) {
      const resolved = await onLookupNostrPubkey(
        identity.nostrPubkeyHex || identity.npub || '',
        {
          username: identity.username,
          displayName: identity.displayName,
          bio: identity.bio,
          avatarColor: identity.avatarColor,
          avatarEmoji: identity.avatarEmoji,
          relayHints: identity.relayHints,
        },
      );
      if (resolved) {
        setExternalQrProfile(null);
        setInspectedUser(resolved);
        return;
      }
    }

    const foundById = identity.userId
      ? await localDb.findLocalUserByIdOrUsername(identity.userId)
      : null;
    const foundByName =
      !foundById && identity.username
        ? await localDb.findLocalUserByIdOrUsername(identity.username)
        : null;

    const matched = foundById || foundByName;
    if (matched) {
      setExternalQrProfile(null);
      setInspectedUser(matched);
    } else {
      setInspectedUser(null);
      setExternalQrProfile(identity);
    }
  }

  async function runAction(fn: () => Promise<void>, successMessage?: string) {
    try {
      await fn();
      if (successMessage) {
        setActionFeedback(successMessage);
        window.setTimeout(() => setActionFeedback(null), 2600);
      }
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : 'Action failed');
    }
  }

  const myQrPayload = buildUserQrPayload(currentUser);
  const incomingCount = friendRequests.incoming.length;

  function renderProfileRelationshipActions(peer: PublicUser) {
    const isFriend = currentUser.friendIds.includes(peer.userId);
    const isBlocked = blockedUserIds.includes(peer.userId);
    const incomingReq = friendRequests.incoming.find((r) => r.fromUserId === peer.userId);
    const outgoingReq = friendRequests.outgoing.find((r) => r.toUserId === peer.userId);

    return (
      <div className="space-y-2.5 pt-2">
        {isBlocked ? (
          <button
            type="button"
            onClick={() =>
              runAction(
                () => onBlockUser(peer.userId, false),
                language === 'ar' ? 'تم إلغاء الحظر' : 'User unblocked',
              )
            }
            className="w-full min-h-[44px] px-4 rounded-xl bg-emerald-600 text-white text-xs font-semibold flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{t.unblockUserBtn}</span>
          </button>
        ) : (
          <>
            {isFriend ? (
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setInspectedUser(null);
                    onStartDirectChat(peer);
                  }}
                  className="min-h-[44px] px-3 rounded-xl text-[#041018] text-xs font-semibold flex items-center justify-center gap-1.5"
                  style={{ backgroundColor: pageAccent }}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>{t.navChats}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInspectedUser(null);
                    onStartCall(peer, 'audio');
                  }}
                  className="min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-white/10 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Phone className="w-4 h-4" />
                  <span>{language === 'ar' ? 'صوت' : 'Audio'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInspectedUser(null);
                    onStartCall(peer, 'video');
                  }}
                  className="min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-white/10 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Video className="w-4 h-4" />
                  <span>{language === 'ar' ? 'فيديو' : 'Video'}</span>
                </button>
              </div>
            ) : incomingReq ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    runAction(
                      () => onAcceptFriendRequest(incomingReq.requestId),
                      language === 'ar' ? 'تم قبول طلب الصداقة' : 'Friend request accepted',
                    )
                  }
                  className="min-h-[44px] px-4 rounded-xl bg-emerald-600 text-white text-xs font-semibold flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  <span>{t.acceptRequestBtn}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    runAction(
                      () => onDeclineFriendRequest(incomingReq.requestId),
                      language === 'ar' ? 'تم رفض الطلب' : 'Request declined',
                    )
                  }
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold flex items-center justify-center gap-2"
                >
                  <X className="w-4 h-4" />
                  <span>{t.declineRequestBtn}</span>
                </button>
              </div>
            ) : outgoingReq ? (
              <button
                type="button"
                onClick={() =>
                  runAction(
                    () => onCancelFriendRequest(outgoingReq.requestId),
                    language === 'ar' ? 'تم إلغاء طلب الصداقة' : 'Friend request cancelled',
                  )
                }
                className="w-full min-h-[44px] px-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-500 text-xs font-semibold flex items-center justify-center gap-2"
              >
                <Clock className="w-4 h-4" />
                <span>{t.cancelRequestBtn}</span>
              </button>
            ) : (
                <button
                  type="button"
                  onClick={() =>
                    runAction(
                      () => onSendFriendRequest(peer.userId, peer.nostrPubkeyHex),
                      language === 'ar' ? 'تم إرسال طلب الصداقة عبر Nostr' : 'Friend request sent',
                    )
                  }
                  className="w-full min-h-[44px] px-4 rounded-xl text-[#041018] text-xs font-semibold flex items-center justify-center gap-2"
                  style={{ backgroundColor: pageAccent }}
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{t.sendFriendRequestBtn}</span>
                </button>
              )}
              {!isFriend && (
                <button
                  type="button"
                  onClick={() => {
                    setInspectedUser(null);
                    onStartDirectChat(peer);
                  }}
                  className="w-full min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold flex items-center justify-center gap-2"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>{language === 'ar' ? 'فتح محادثة NIP-17 مباشرة' : 'Open NIP-17 Direct Chat'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  runAction(
                    () => onToggleFavorite(peer.userId),
                    favoriteIds.includes(peer.userId)
                      ? language === 'ar' ? 'تمت الإزالة من المفضلة' : 'Removed from Favorites'
                      : language === 'ar' ? 'تمت الإضافة إلى المفضلة' : 'Added to Favorites',
                  )
                }
                className="w-full min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold flex items-center justify-center gap-2"
              >
                <Star className={`w-4 h-4 ${favoriteIds.includes(peer.userId) ? 'fill-amber-400 text-amber-400' : ''}`} />
                <span>
                  {favoriteIds.includes(peer.userId)
                    ? language === 'ar' ? 'إزالة من المفضلة' : 'Remove from Favorites'
                    : language === 'ar' ? 'إضافة إلى المفضلة' : 'Add to Favorites'}
                </span>
              </button>

            <div className="flex items-center gap-2">
              {isFriend && (
                <button
                  type="button"
                  onClick={() =>
                    runAction(
                      () => onRemoveFriend(peer.userId),
                      language === 'ar' ? 'تمت إزالة الصديق' : 'Friend removed',
                    )
                  }
                  className="flex-1 min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <UserMinus className="w-4 h-4" />
                  <span>{t.removeFriendBtn}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  runAction(
                    () => onBlockUser(peer.userId, true),
                    language === 'ar' ? 'تم حظر المستخدم' : 'User blocked',
                  )
                }
                className="flex-1 min-h-[40px] px-3 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Ban className="w-4 h-4" />
                <span>{t.blockUserBtn}</span>
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-y-auto p-6 bg-[#F4F7FC] dark:bg-[#05070D]"
      style={shellStyle}
    >
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold">{t.contactsTitle}</h2>
            <p className="text-sm text-slate-500 dark:text-[#9AA8C7]">{t.contactsSubtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowScanner(true)}
              className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-white/15 bg-white dark:bg-[#0C1222] text-xs font-semibold flex items-center gap-2"
              style={cardStyle}
            >
              <ScanLine className="w-4 h-4" style={{ color: pageAccent }} />
              <span>{t.scanQrBtn}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowMyQr(true)}
              className="min-h-[42px] px-4 rounded-xl border border-slate-200 dark:border-white/15 bg-white dark:bg-[#0C1222] text-xs font-semibold flex items-center gap-2"
              style={cardStyle}
            >
              <QrCode className="w-4 h-4" style={{ color: pageAccent }} />
              <span>{t.qrIdentityBtn}</span>
            </button>
            <button
              type="button"
              onClick={() => onStartDirectChat(currentUser)}
              className="min-h-[42px] px-4 rounded-xl text-xs font-semibold text-[#041018] flex items-center gap-2"
              style={{ backgroundColor: pageAccent }}
            >
              <UserCheck className="w-4 h-4" />
              <span>{language === 'ar' ? 'مفكرتي الشخصية' : 'Note to Self'}</span>
            </button>
          </div>
        </header>

        {actionFeedback && (
          <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/25 text-xs font-medium text-cyan-600 dark:text-[#00E5FF]">
            {actionFeedback}
          </div>
        )}

        {/* Sub-navigation Tabs */}
        <div
          className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 p-1.5 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10"
          style={cardStyle}
        >
          {[
            { id: 'friends' as const, label: `${t.friendsTab} (${friendsList.length})`, icon: Users },
            { id: 'favorites' as const, label: `${t.favoritesTab} (${favoritesList.length})`, icon: Star },
            { id: 'search' as const, label: t.searchUsersTab, icon: Search },
            {
              id: 'requests' as const,
              label: incomingCount > 0 ? `${t.requestsTab} (${incomingCount})` : t.requestsTab,
              icon: UserPlus,
            },
            { id: 'blocked' as const, label: `${t.blockedTab} (${blockedUsersList.length})`, icon: Ban },
          ].map((item) => {
            const Icon = item.icon;
            const active = activeSubTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSubTab(item.id)}
                className={`min-h-[42px] px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
                  active ? 'text-[#041018]' : 'text-slate-600 dark:text-[#9AA8C7] hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
                style={active ? { backgroundColor: pageAccent } : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: Friends List */}
        {activeSubTab === 'friends' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={friendFilter}
                onChange={(e) => setFriendFilter(e.target.value)}
                placeholder={
                  language === 'ar'
                    ? 'تصفية قائمة أصدقائك...'
                    : 'Filter your friends list...'
                }
                className="w-full min-h-[44px] ps-10 pe-4 rounded-xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 text-sm focus:outline-none"
                style={cardStyle}
              />
            </div>

            {friendsList.length === 0 ? (
              <div
                className="p-8 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 text-center space-y-3"
                style={cardStyle}
              >
                <p className="font-semibold text-sm">
                  {language === 'ar'
                    ? 'لا يوجد أصدقاء مضافون بعد'
                    : 'No friends added yet'}
                </p>
                <p className="text-xs text-slate-500 dark:text-[#9AA8C7] max-w-md mx-auto">
                  {language === 'ar'
                    ? 'ابحث عن مستخدمين عبر اسم المستخدم أو User ID أو الاسم المعروض، أو امسح رمز QR لإرسال طلب صداقة.'
                    : 'Search real accounts by @username, User ID, or allowed Display Name, or scan a friend QR code to connect.'}
                </p>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('search')}
                  className="min-h-[40px] px-4 rounded-xl text-xs font-semibold text-[#041018] inline-flex items-center gap-2"
                  style={{ backgroundColor: pageAccent }}
                >
                  <Search className="w-4 h-4" />
                  <span>{t.searchUsersTab}</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {friendsList.map((peer) => (
                  <div
                    key={peer.userId}
                    className="p-4 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-3"
                    style={cardStyle}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setExternalQrProfile(null);
                        setInspectedUser(peer);
                      }}
                      className="flex items-center gap-3 min-w-0 flex-1 text-start"
                    >
                      <UserAvatar
                        avatarColor={peer.avatarColor}
                        avatarEmoji={peer.avatarEmoji}
                        avatarDataUrl={peer.avatarDataUrl}
                        alt={peer.displayName}
                        sizeClass="w-12 h-12"
                        textClass="text-lg"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{peer.displayName}</div>
                        <div className="text-xs text-slate-500 dark:text-[#9AA8C7] font-mono-tabular truncate">
                          @{peer.username}
                          {peer.lastSeenAt && !peer.hideLastSeen
                            ? ` · ${formatLocalizedDate(peer.lastSeenAt, language)}`
                            : ''}
                        </div>
                        {peer.bio && (
                          <p className="text-xs text-slate-500 dark:text-[#9AA8C7] truncate mt-0.5">
                            {peer.bio}
                          </p>
                        )}
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onStartDirectChat(peer)}
                        title={t.navChats}
                        className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-[#041018]"
                        style={{ backgroundColor: pageAccent }}
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onStartCall(peer, 'audio')}
                        title={t.startAudioCall}
                        className="min-h-[40px] min-w-[40px] rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center"
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 1B: Favorites List */}
        {activeSubTab === 'favorites' && (
          <div className="space-y-4">
            {favoritesList.length === 0 ? (
              <div
                className="p-8 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 text-center space-y-2"
                style={cardStyle}
              >
                <Star className="w-8 h-8 text-amber-400 mx-auto" />
                <p className="font-semibold text-sm">
                  {language === 'ar' ? 'لا يوجد أصدقاء في المفضلة بعد' : 'No favorite contacts yet'}
                </p>
                <p className="text-xs text-slate-500 dark:text-[#9AA8C7]">
                  {language === 'ar'
                    ? 'افتح ملف أي جهة اتصال واضغط على "إضافة إلى المفضلة" للوصول السريع.'
                    : 'Open any profile card and click Add to Favorites for quick access.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {favoritesList.map((peer) => (
                  <div
                    key={peer.userId}
                    className="p-4 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-3"
                    style={cardStyle}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setExternalQrProfile(null);
                        setInspectedUser(peer);
                      }}
                      className="flex items-center gap-3 min-w-0 flex-1 text-start"
                    >
                      <UserAvatar
                        avatarColor={peer.avatarColor}
                        avatarEmoji={peer.avatarEmoji}
                        avatarDataUrl={peer.avatarDataUrl}
                        alt={peer.displayName}
                        sizeClass="w-12 h-12"
                        textClass="text-lg"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                          <span>{peer.displayName}</span>
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 shrink-0" />
                        </div>
                        <div className="text-xs text-slate-500 font-mono-tabular truncate">@{peer.username}</div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onStartDirectChat(peer)}
                        className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-[#041018]"
                        style={{ backgroundColor: pageAccent }}
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleFavorite(peer.userId)}
                        className="min-h-[40px] min-w-[40px] rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center"
                        title={language === 'ar' ? 'إزالة من المفضلة' : 'Remove from Favorites'}
                      >
                        <Star className="w-4 h-4 fill-amber-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Real Phone-Free Nostr & Local Search */}
        {activeSubTab === 'search' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute start-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  language === 'ar'
                    ? 'أدخل npub1... أو nprofile1... أو @اسم_المستخدم (عبر NIP-50) أو User ID...'
                    : 'Paste npub1... / nprofile1... / hex key, or search @username (NIP-50 relays)...'
                }
                className="w-full min-h-[46px] ps-10 pe-4 rounded-xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 text-sm focus:outline-none"
                style={cardStyle}
              />
            </div>

            {/* Honest NIP-50 Relay Search Capability Banner */}
            <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Wifi className={`w-4 h-4 shrink-0 ${connectedRelayCount > 0 ? 'text-emerald-500' : 'text-amber-500'}`} />
                <span>
                  {language === 'ar'
                    ? `متصل بـ ${connectedRelayCount} Relay · خوادم البحث NIP-50 المتصلة: ${nip50RelayCount}`
                    : `Connected Relays: ${connectedRelayCount} · Active NIP-50 Search Relays: ${nip50RelayCount}`}
                </span>
              </div>
              {nip50RelayCount === 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {language === 'ar'
                    ? 'لا يوجد Relay يدعم البحث بالاسم (NIP-50) متصل حالياً — الإضافة عبر npub / nprofile / QR تعمل مباشرة.'
                    : 'No NIP-50 username search relay connected right now — add directly via npub / nprofile / QR scan.'}
                </span>
              )}
            </div>

            {!searchQuery.trim() ? (
              <div
                className="p-6 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 space-y-2 text-xs text-slate-500 dark:text-[#9AA8C7]"
                style={cardStyle}
              >
                <p className="font-semibold text-sm text-slate-800 dark:text-white">
                  {language === 'ar'
                    ? 'بحث حقيقي عبر شبكة Nostr والملفات المحلية (دون أرقام هواتف أو حسابات وهمية)'
                    : 'Real Nostr & Local Account Discovery · Zero Mock Users · Zero Phone Numbers'}
                </p>
                <p>
                  {language === 'ar'
                    ? 'الصق المفتاح العام npub1... أو رابط nprofile1... لجلب ملف المستخدم مباشرة من الـ Relays، أو ابحث بالاسم عبر الـ Relays الداعمة لـ NIP-50 أو عبر مسح رمز QR.'
                    : 'Paste a peer npub1... / nprofile1... / hex key to resolve their kind:0 profile directly from Nostr Relays, search usernames via NIP-50 relays, or scan a QR code.'}
                </p>
              </div>
            ) : searching ? (
              <p className="text-xs text-slate-500 px-2">
                {language === 'ar' ? 'جارٍ الاستعلام من الخوادم الموزعة (Relays) والبحث المحلي...' : 'Querying connected Nostr Relays & local directory...'}
              </p>
            ) : searchResults.length === 0 ? (
              <div
                className="p-8 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 text-center space-y-2"
                style={cardStyle}
              >
                <p className="font-semibold text-sm">
                  {language === 'ar' ? 'لا توجد حسابات حقيقية مطابقة' : 'No matching real accounts found'}
                </p>
                <p className="text-xs text-slate-500 dark:text-[#9AA8C7] max-w-lg mx-auto">
                  {language === 'ar'
                    ? 'لا يتم إنشاء أي نتائج وهمية. أضف المستخدم عبر مفتاحه العام npub1... أو امسح رمز QR الخاص به.'
                    : 'Zero fake profiles are generated. Paste the user npub1... / nprofile1... key directly or scan their QR code.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {searchResults.map((peer) => {
                  const isFriend = currentUser.friendIds.includes(peer.userId);
                  const isOutgoing = friendRequests.outgoing.some((r) => r.toUserId === peer.userId);
                  const isIncoming = friendRequests.incoming.some((r) => r.fromUserId === peer.userId);

                  return (
                    <button
                      key={peer.userId}
                      type="button"
                      onClick={() => {
                        setExternalQrProfile(null);
                        setInspectedUser(peer);
                      }}
                      className="p-4 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-3 text-start hover:border-cyan-500/60 transition-colors"
                      style={cardStyle}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar
                          avatarColor={peer.avatarColor}
                          avatarEmoji={peer.avatarEmoji}
                          avatarDataUrl={peer.avatarDataUrl}
                          alt={peer.displayName}
                          sizeClass="w-12 h-12"
                          textClass="text-lg"
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate">{peer.displayName}</div>
                          <div className="text-xs text-slate-500 dark:text-[#9AA8C7] font-mono-tabular truncate">
                            @{peer.username}
                          </div>
                          <div className="text-[11px] font-mono-tabular text-slate-400 truncate">
                            {peer.userId}
                          </div>
                        </div>
                      </div>
                      <span
                        className="text-xs font-semibold shrink-0 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/15"
                        style={
                          isFriend
                            ? { color: pageAccent, borderColor: pageAccent }
                            : undefined
                        }
                      >
                        {isFriend
                          ? language === 'ar' ? 'صديق' : 'Friend'
                          : isOutgoing
                          ? language === 'ar' ? 'مُرسل' : 'Pending'
                          : isIncoming
                          ? language === 'ar' ? 'طلب وارد' : 'Incoming'
                          : language === 'ar' ? 'عرض الملف' : 'View Profile'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Incoming & Outgoing Friend Requests */}
        {activeSubTab === 'requests' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Incoming */}
            <section className="space-y-3">
              <h3 className="text-sm font-bold flex items-center justify-between">
                <span>{t.incomingRequestsTitle}</span>
                <span className="text-xs font-mono-tabular opacity-70">{friendRequests.incoming.length}</span>
              </h3>
              {friendRequests.incoming.length === 0 ? (
                <div
                  className="p-6 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 text-xs text-slate-500"
                  style={cardStyle}
                >
                  {language === 'ar' ? 'لا توجد طلبات صداقة واردة حالياً.' : 'No incoming friend requests.'}
                </div>
              ) : (
                friendRequests.incoming.map((req) => {
                  const sender = userById.get(req.fromUserId);
                  if (!sender) return null;
                  return (
                    <div
                      key={req.requestId}
                      className="p-4 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-3"
                      style={cardStyle}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setExternalQrProfile(null);
                          setInspectedUser(sender);
                        }}
                        className="flex items-center gap-3 min-w-0 text-start flex-1"
                      >
                        <UserAvatar
                          avatarColor={sender.avatarColor}
                          avatarEmoji={sender.avatarEmoji}
                          avatarDataUrl={sender.avatarDataUrl}
                          alt={sender.displayName}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{sender.displayName}</div>
                          <div className="text-xs font-mono-tabular text-slate-500 truncate">@{sender.username}</div>
                        </div>
                      </button>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            runAction(
                              () => onAcceptFriendRequest(req.requestId),
                              language === 'ar' ? 'تمت إضافة الصديق' : 'Friend added',
                            )
                          }
                          className="min-h-[38px] px-3 rounded-xl bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{t.acceptRequestBtn}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            runAction(
                              () => onDeclineFriendRequest(req.requestId),
                              language === 'ar' ? 'تم رفض الطلب' : 'Request declined',
                            )
                          }
                          className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold"
                        >
                          {t.declineRequestBtn}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </section>

            {/* Outgoing */}
            <section className="space-y-3">
              <h3 className="text-sm font-bold flex items-center justify-between">
                <span>{t.outgoingRequestsTitle}</span>
                <span className="text-xs font-mono-tabular opacity-70">{friendRequests.outgoing.length}</span>
              </h3>
              {friendRequests.outgoing.length === 0 ? (
                <div
                  className="p-6 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 text-xs text-slate-500"
                  style={cardStyle}
                >
                  {language === 'ar' ? 'لا توجد طلبات صداقة صادرة معلّقة.' : 'No pending outgoing requests.'}
                </div>
              ) : (
                friendRequests.outgoing.map((req) => {
                  const target = userById.get(req.toUserId);
                  if (!target) return null;
                  return (
                    <div
                      key={req.requestId}
                      className="p-4 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-3"
                      style={cardStyle}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setExternalQrProfile(null);
                          setInspectedUser(target);
                        }}
                        className="flex items-center gap-3 min-w-0 text-start flex-1"
                      >
                        <UserAvatar
                          avatarColor={target.avatarColor}
                          avatarEmoji={target.avatarEmoji}
                          avatarDataUrl={target.avatarDataUrl}
                          alt={target.displayName}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{target.displayName}</div>
                          <div className="text-xs font-mono-tabular text-slate-500 truncate">@{target.username}</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runAction(
                            () => onCancelFriendRequest(req.requestId),
                            language === 'ar' ? 'تم إلغاء الطلب' : 'Request cancelled',
                          )
                        }
                        className="min-h-[38px] px-3 rounded-xl border border-amber-500/35 text-amber-500 text-xs font-semibold shrink-0"
                      >
                        {t.cancelRequestBtn}
                      </button>
                    </div>
                  );
                })
              )}
            </section>
          </div>
        )}

        {/* TAB 4: Blocked Users */}
        {activeSubTab === 'blocked' && (
          <div className="space-y-3">
            {blockedUsersList.length === 0 ? (
              <div
                className="p-8 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 text-center text-xs text-slate-500"
                style={cardStyle}
              >
                {language === 'ar' ? 'لا يوجد مستخدمون محظورون.' : 'No blocked users.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {blockedUsersList.map((peer) => (
                  <div
                    key={peer.userId}
                    className="p-4 rounded-2xl bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/10 flex items-center justify-between gap-3"
                    style={cardStyle}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setExternalQrProfile(null);
                        setInspectedUser(peer);
                      }}
                      className="flex items-center gap-3 min-w-0 text-start"
                    >
                      <UserAvatar
                        avatarColor={peer.avatarColor}
                        avatarEmoji={peer.avatarEmoji}
                        avatarDataUrl={peer.avatarDataUrl}
                        alt={peer.displayName}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{peer.displayName}</div>
                        <div className="text-xs font-mono-tabular text-slate-500 truncate">@{peer.username}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runAction(
                          () => onBlockUser(peer.userId, false),
                          language === 'ar' ? 'تم إلغاء الحظر' : 'User unblocked',
                        )
                      }
                      className="min-h-[38px] px-3.5 rounded-xl bg-emerald-500/15 text-emerald-500 text-xs font-semibold shrink-0"
                    >
                      {t.unblockUserBtn}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal: User Profile Preview (Before Sending Friend Request / Managing Relationship) */}
      {inspectedUser && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className="max-w-md w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-3xl p-6 space-y-5"
            style={cardStyle}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold">
                {language === 'ar' ? 'الملف الشخصي للمستخدم' : 'User Profile'}
              </h3>
              <button
                type="button"
                onClick={() => setInspectedUser(null)}
                className="min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col items-center text-center space-y-2.5">
              <UserAvatar
                avatarColor={inspectedUser.avatarColor}
                avatarEmoji={inspectedUser.avatarEmoji}
                avatarDataUrl={inspectedUser.avatarDataUrl}
                alt={inspectedUser.displayName}
                sizeClass="w-20 h-20"
                textClass="text-3xl"
                roundedClass="rounded-3xl"
              />
              <div>
                <h4 className="font-display text-lg font-bold">{inspectedUser.displayName}</h4>
                <p className="text-xs font-mono-tabular text-slate-500 dark:text-[#9AA8C7]">
                  @{inspectedUser.username}
                </p>
              </div>
              {inspectedUser.bio && (
                <p className="text-xs text-slate-600 dark:text-[#9AA8C7] max-w-sm leading-relaxed">
                  {inspectedUser.bio}
                </p>
              )}
              <div className="w-full space-y-2">
                {inspectedUser.npub && (
                  <div className="w-full p-2.5 rounded-xl bg-slate-100 dark:bg-[#05070D] flex items-center justify-between gap-2 text-start">
                    <div className="min-w-0">
                      <div className="text-[10px] opacity-60">{t.nostrPubkeyLabel}</div>
                      <div className="text-[11px] font-mono-tabular truncate" dir="ltr">
                        {inspectedUser.npub}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyText(inspectedUser.npub, 'peer_npub')}
                      className="min-h-[32px] px-2.5 rounded-lg border border-slate-200 dark:border-white/15 text-[11px] font-semibold flex items-center gap-1 shrink-0"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{copiedKey === 'peer_npub' ? (language === 'ar' ? 'نُسخ' : 'Copied') : (language === 'ar' ? 'نسخ' : 'Copy')}</span>
                    </button>
                  </div>
                )}
                <div className="w-full p-2.5 rounded-xl bg-slate-100 dark:bg-[#05070D] flex items-center justify-between gap-2 text-start">
                  <div className="min-w-0">
                    <div className="text-[10px] opacity-60">{t.userIdLabel}</div>
                    <div className="text-[11px] font-mono-tabular truncate" dir="ltr">
                      {inspectedUser.userId}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText(inspectedUser.userId, 'peer_uid')}
                    className="min-h-[32px] px-2.5 rounded-lg border border-slate-200 dark:border-white/15 text-[11px] font-semibold flex items-center gap-1 shrink-0"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedKey === 'peer_uid' ? (language === 'ar' ? 'نُسخ' : 'Copied') : (language === 'ar' ? 'نسخ' : 'Copy')}</span>
                  </button>
                </div>
                {inspectedUser.nostrPubkeyHex && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => copyText(buildProfileShareLink(inspectedUser), 'peer_share_link')}
                      className="w-full min-h-[34px] px-3 rounded-xl border border-slate-200 dark:border-white/15 text-[11px] font-semibold flex items-center justify-center gap-1.5"
                    >
                      <Link2 className="w-3.5 h-3.5 text-cyan-500" />
                      <span>
                        {copiedKey === 'peer_share_link'
                          ? language === 'ar' ? 'تم النسخ!' : 'Copied!'
                          : t.copyProfileLinkBtn}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => copyText(buildWebInviteUrl(inspectedUser), 'peer_web_invite')}
                      className="w-full min-h-[34px] px-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-[#00E5FF] text-[11px] font-semibold flex items-center justify-center gap-1.5"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      <span>
                        {copiedKey === 'peer_web_invite'
                          ? language === 'ar' ? 'تم نسخ رابط الدعوة!' : 'Invite URL Copied!'
                          : language === 'ar' ? 'نسخ رابط الدعوة المباشر' : 'Copy Direct Invite URL'}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {renderProfileRelationshipActions(inspectedUser)}
          </div>
        </div>
      )}

      {/* Modal: Scanned External QR Card (from another device when no server is connected) */}
      {externalQrProfile && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-3xl p-6 space-y-4 text-center">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold">
                {language === 'ar' ? 'بطاقة QR ممسوحة' : 'Scanned QR Profile'}
              </h3>
              <button type="button" onClick={() => setExternalQrProfile(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <UserAvatar
              avatarColor={externalQrProfile.avatarColor || pageAccent}
              avatarEmoji={externalQrProfile.avatarEmoji || '◈'}
              alt={externalQrProfile.displayName || externalQrProfile.username || 'User'}
              sizeClass="w-16 h-16 mx-auto"
              textClass="text-2xl"
              roundedClass="rounded-2xl"
            />
            <div>
              <h4 className="font-display text-base font-bold">
                {externalQrProfile.displayName || `@${externalQrProfile.username || 'unknown'}`}
              </h4>
              {externalQrProfile.username && (
                <p className="text-xs font-mono-tabular text-slate-500">@{externalQrProfile.username}</p>
              )}
              {externalQrProfile.userId && (
                <p className="text-[11px] font-mono-tabular text-slate-400 mt-1 break-all">
                  {externalQrProfile.userId}
                </p>
              )}
            </div>
            {externalQrProfile.bio && (
              <p className="text-xs text-slate-500 dark:text-[#9AA8C7]">{externalQrProfile.bio}</p>
            )}
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-start text-xs space-y-1">
              <div className="font-semibold flex items-center gap-1.5 text-amber-500">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>
                  {language === 'ar' ? 'البطاقة لا تحتوي على مفتاح Nostr عام' : 'No Nostr Public Key Included'}
                </span>
              </div>
              <p className="opacity-85 leading-relaxed">
                {language === 'ar'
                  ? 'هذا الرمز من حساب محلي قديم أو غير مكتمل. للمراسلة عبر أجهزة مختلفة، اطلب من صديقك مشاركة رمز QR الجديد أو مفتاحه العام npub1...'
                  : 'This QR payload does not include a Nostr npub/hex key. Ask your contact for their updated CHARISMA QR card or npub1... key to message across devices.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal: My QR Identity Card */}
      {showMyQr && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-sm w-full bg-white dark:bg-[#0C1222] border border-slate-200 dark:border-white/15 rounded-3xl p-6 space-y-4 text-center">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{t.qrIdentityBtn}</h3>
              <button type="button" onClick={() => setShowMyQr(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-center">
              <QrCodeDisplay value={myQrPayload} size={190} />
            </div>
            <div className="space-y-1">
              <div className="font-semibold text-sm">{currentUser.displayName}</div>
              <p className="text-xs font-mono-tabular text-slate-500">@{currentUser.username}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-[#05070D] text-start space-y-1">
              <div className="text-[10px] opacity-60">{t.nostrPubkeyLabel}</div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono-tabular truncate" dir="ltr">
                  {currentUser.npub || currentUser.userId}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(currentUser.npub || currentUser.userId, 'my_uid')}
                  className="text-[11px] font-semibold text-cyan-500 shrink-0"
                >
                  {copiedKey === 'my_uid' ? (language === 'ar' ? 'نُسخ!' : 'Copied!') : (language === 'ar' ? 'نسخ' : 'Copy')}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => copyText(buildWebInviteUrl(currentUser), 'my_web_invite')}
              className="w-full min-h-[40px] px-4 rounded-xl text-[#041018] text-xs font-semibold flex items-center justify-center gap-2"
              style={{ backgroundColor: pageAccent }}
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>
                {copiedKey === 'my_web_invite'
                  ? language === 'ar' ? 'تم نسخ رابط الدعوة المباشر!' : 'Direct Invite URL Copied!'
                  : language === 'ar' ? 'نسخ رابط دعوة مباشر لهاتف آخر' : 'Copy Direct Invite Link (Phone-to-Phone)'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => copyText(buildProfileShareLink(currentUser), 'my_profile_link')}
              className="w-full min-h-[40px] px-4 rounded-xl border border-cyan-500/35 bg-cyan-500/10 text-cyan-600 dark:text-[#00E5FF] text-xs font-semibold flex items-center justify-center gap-2"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>
                {copiedKey === 'my_profile_link'
                  ? language === 'ar' ? 'تم نسخ رابط Nostr!' : 'Profile Link Copied!'
                  : t.copyProfileLinkBtn}
              </span>
            </button>
            <button
              type="button"
              onClick={() => copyText(myQrPayload, 'my_qr_payload')}
              className="w-full min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-white/15 text-xs font-semibold flex items-center justify-center gap-2"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {copiedKey === 'my_qr_payload'
                  ? language === 'ar' ? 'تم نسخ كود الهوية!' : 'Identity Code Copied!'
                  : language === 'ar' ? 'نسخ كود QR للمشاركة' : 'Copy QR Identity Code'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Modal: Camera & File QR Scanner */}
      {showScanner && (
        <QrScannerModal
          language={language}
          primaryAccent={pageAccent}
          onDetected={handleQrDetected}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
};
