export type AppLanguage = 'en' | 'ar';
export type ThemeMode = 'dark' | 'light';
export type BubbleStyle = 'futuristic' | 'balanced' | 'classic';
export type InterfaceDensity = 'compact' | 'comfortable' | 'spacious';
export type NavStyle = 'rail' | 'minimal';
export type MediaQuality = 'original' | 'balanced' | 'compressed';

export interface RelayConfig {
  url: string;
  read: boolean;
  write: boolean;
  isSearch?: boolean;
  status?: 'connected' | 'connecting' | 'disconnected' | 'error';
  latencyMs?: number;
  name?: string;
  supportedNips?: number[];
  paymentRequired?: boolean;
  lastError?: string;
}

export interface PublicUser {
  userId: string;
  nostrPubkeyHex: string;
  npub: string;
  username: string;
  displayName: string;
  bio: string;
  hideOnline: boolean;
  hideLastSeen: boolean;
  allowSearchByDisplayName: boolean;
  avatarColor: string;
  avatarEmoji: string;
  avatarDataUrl?: string;
  ecdhPublicKeyJwk: JsonWebKey;
  ecdsaPublicKeyJwk: JsonWebKey;
  isOnline: boolean;
  lastSeenAt: number | null;
  blockedUserIds: string[];
  friendIds: string[];
  favoriteIds?: string[];
  relayHints?: string[];
}

export interface WrappedAccountSecrets {
  ivB64: string;
  saltB64: string;
  encryptedDataB64: string;
}

export interface LocalAccountRecord {
  userId: string;
  nostrPubkeyHex?: string;
  npub?: string;
  username: string;
  displayName: string;
  bio: string;
  avatarColor: string;
  avatarEmoji: string;
  avatarDataUrl?: string;
  hideOnline: boolean;
  hideLastSeen: boolean;
  allowSearchByDisplayName: boolean;
  ecdhPublicKeyJwk: JsonWebKey;
  ecdsaPublicKeyJwk: JsonWebKey;
  blockedUserIds: string[];
  friendIds: string[];
  favoriteIds?: string[];
  preferredRelays?: RelayConfig[];
  passwordSaltB64: string;
  passwordVerifierB64: string;
  wrappedSecrets: WrappedAccountSecrets;
  createdAt: number;
  lastLoginAt: number;
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface FriendRequestRecord {
  requestId: string;
  fromUserId: string;
  toUserId: string;
  fromNostrPubkeyHex?: string;
  toNostrPubkeyHex?: string;
  status: FriendRequestStatus;
  createdAt: number;
  updatedAt: number;
}

export interface DecryptedAccountSecrets {
  keyBundle: LocalKeyBundle;
  dataMasterKeyB64: string;
  nostrPrivateKeyHex?: string;
  nsec?: string;
}

export interface EncryptedLocalRecord {
  id: string;
  ownerUserId: string;
  convId?: string;
  ivB64: string;
  ciphertextB64: string;
}

export interface LocalEnvelopeRecord {
  envelopeId: string;
  fromUserId: string;
  toUserId: string;
  payload: EncryptedEnvelopePayload;
  queuedAt: number;
}

export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'document'
  | 'voice'
  | 'location'
  | 'contact';

export type MessageDeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read';

export interface MessageAttachment {
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  durationSec?: number;
  waveform?: number[];
  latitude?: number;
  longitude?: number;
  locationLabel?: string;
  contactName?: string;
  contactUsername?: string;
  encryptedUrl?: string;
  fileKeyB64?: string;
  fileIvB64?: string;
  ciphertextSha256?: string;
}

export interface ChatMessage {
  msgId: string;
  convId: string;
  senderId: string;
  senderName: string;
  kind: MessageKind;
  text: string;
  attachment?: MessageAttachment;
  replyTo?: { msgId: string; senderName: string; previewText: string };
  forwardedFrom?: string;
  reactions: Record<string, string[]>; // emoji -> userIds
  status: MessageDeliveryStatus;
  isStarred: boolean;
  isPinned: boolean;
  editedAt?: number;
  deletedLocally?: boolean;
  deletedForEveryone?: boolean;
  expiresAt?: number;
  scheduledAt?: number;
  createdAt: number;
  nostrRumorId?: string;
  relayAckCount?: number;
  deliveryMode?: 'nip17' | 'local';
}

export interface Conversation {
  convId: string;
  type: 'direct' | 'group';
  peerUserId?: string;
  title: string;
  description?: string;
  avatarColor: string;
  avatarEmoji: string;
  memberIds: string[];
  adminIds: string[];
  adminsOnly?: boolean;
  inviteCode?: string;
  lastMessagePreview: string;
  lastMessageAt: number;
  unreadCount: number;
  isPinned: boolean;
  isArchived: boolean;
  isMuted: boolean;
  isLocked: boolean;
  lockPinHash?: string;
  disappearTtlSec: number; // 0 = off
  draftText: string;
  customThemeId?: string;
  customThemeColor?: string;
  customWallpaper?: string;
  typingUserIds: string[];
  recordingUserIds: string[];
}

export interface OutboxItem {
  queueId: string;
  ownerUserId: string;
  toUserId: string;
  convId: string;
  envelopeId: string;
  encryptedPayload: EncryptedEnvelopePayload;
  createdAt: number;
}

export interface EncryptedEnvelopePayload {
  alg: 'ECDH-P256-HKDF-AES256GCM';
  ivB64: string;
  ciphertextB64: string;
  senderEcdhPubJwk: JsonWebKey;
  signatureB64: string;
  envelopeType:
    | 'message'
    | 'ack'
    | 'read'
    | 'typing'
    | 'recording'
    | 'edit'
    | 'delete_request'
    | 'reaction'
    | 'group_sync';
}

export interface ChannelPost {
  postId: string;
  authorUserId: string;
  authorUsername: string;
  authorDisplayName: string;
  text: string;
  mediaDataUrl?: string;
  mediaType?: 'image' | 'video';
  reactions: Record<string, string[]>;
  createdAt: number;
}

export interface ChannelItem {
  channelId: string;
  name: string;
  description: string;
  isPublic: boolean;
  kind: 'channel' | 'community';
  adminUserIds: string[];
  subscriberUserIds: string[];
  memberGroupNames: string[];
  posts: ChannelPost[];
  createdAt: number;
}

export interface StorySlide {
  storyId: string;
  authorId: string;
  authorName: string;
  authorEmoji: string;
  authorColor: string;
  kind: 'text' | 'image' | 'voice';
  text?: string;
  overlayText?: string;
  sticker?: string;
  bgColor?: string;
  mediaDataUrl?: string;
  filterCss?: string;
  allowDownload: boolean;
  privacyMode: 'all' | 'custom';
  allowedViewerIds: string[];
  muted: boolean;
  reactions: Array<{ userId: string; emoji: string }>;
  createdAt: number;
  expiresAt: number;
}

export interface CallLogEntry {
  callId: string;
  peerUserId: string;
  peerName: string;
  kind: 'audio' | 'video';
  direction: 'incoming' | 'outgoing';
  status: 'connected' | 'missed' | 'ended';
  startedAt: number;
  durationSec: number;
}

export interface VaultItem {
  vaultId: string;
  ownerUserId: string;
  folder: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  ivB64: string;
  saltB64: string;
  encryptedDataB64: string;
  sha256Hex: string;
  createdAt: number;
}

export type ExtendedBubbleStyle = 'futuristic' | 'balanced' | 'classic' | 'capsule' | 'sharp';
export type ExtendedNavStyle = 'rail' | 'minimal' | 'floating';
export type StudioFontFamily = 'system' | 'editorial' | 'geometric' | 'monospace' | 'arabic_naskh';
export type IconStyle = 'outlined' | 'duotone' | 'bold';
export type ButtonShapeStyle = 'rounded' | 'pill' | 'sharp' | 'glass';
export type MenuStyle = 'glass' | 'solid' | 'bordered';
export type ShadowLevel = 'none' | 'soft' | 'glow' | 'deep';

export type StudioPageKey =
  | 'home'
  | 'chatsList'
  | 'chatScreen'
  | 'calls'
  | 'stories'
  | 'contacts'
  | 'settings'
  | 'notifications';

export interface PageThemeOverride {
  enabled: boolean;
  backgroundColor?: string;
  surfaceColor?: string;
  accentColor?: string;
  textColor?: string;
  useGradient?: boolean;
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngle?: number;
  wallpaperDataUrl?: string;
  surfaceOpacity?: number;
  shadowLevel?: ShadowLevel;
  borderRadiusPx?: number;
}

export interface CustomizationConfig {
  themeMode: ThemeMode;
  primaryAccent: string;
  secondaryAccent: string;
  gradientEnabled: boolean;
  gradientAngle: number;
  outgoingBubbleColor: string;
  incomingBubbleColor: string;
  wallpaper: 'default' | 'silk_dark' | 'midnight_grid' | 'clean_light' | 'custom_image' | 'gradient';
  customWallpaperDataUrl?: string;
  wallpaperBlur: number;
  wallpaperOverlayOpacity: number;
  bubbleStyle: ExtendedBubbleStyle;
  bubbleRadiusPx: number;
  bubbleOpacity: number;
  bubbleShadow: ShadowLevel;
  surfaceOpacity: number;
  surfaceShadow: ShadowLevel;
  fontFamily: StudioFontFamily;
  fontScale: number;
  density: InterfaceDensity;
  navStyle: ExtendedNavStyle;
  iconStyle: IconStyle;
  buttonStyle: ButtonShapeStyle;
  menuStyle: MenuStyle;
  enableAnimations: boolean;
  notificationSound: 'pulse' | 'chime' | 'silent';
  favoriteColors: string[];
  pageThemes: Record<StudioPageKey, PageThemeOverride>;
}

export interface SavedThemePreset {
  themeId: string;
  ownerUserId: string;
  name: string;
  description?: string;
  config: CustomizationConfig;
  createdAt: number;
  updatedAt: number;
}

export interface DeletedThemeBackup {
  backupId: string;
  ownerUserId: string;
  preset: SavedThemePreset;
  deletedAt: number;
}

export interface InAppNotificationItem {
  id: string;
  title: string;
  body: string;
  kind: 'message' | 'call' | 'theme' | 'security' | 'friend';
  createdAt: number;
}

export interface PrivacyPlusConfig {
  hideOnlineStatus: boolean;
  hideLastSeen: boolean;
  sendReadReceipts: boolean;
  sendTypingIndicators: boolean;
  sendRecordingIndicators: boolean;
  hideNotificationPreviews: boolean;
  appLockEnabled: boolean;
  appLockPinHash?: string;
  biometricCredentialId?: string;
  autoReplyEnabled: boolean;
  autoReplyText: string;
  mediaQuality: MediaQuality;
  autoDownloadImages: boolean;
  autoDownloadDocs: boolean;
  stunServerUrl?: string;
  customTurnUrl?: string;
  customTurnUsername?: string;
  customTurnCredential?: string;
  freeMediaServerUrl?: string;
  mediaServerConsentGranted?: boolean;
}

export interface LocalKeyBundle {
  deviceId: string;
  ecdhPublicJwk: JsonWebKey;
  ecdhPrivateJwk: JsonWebKey;
  ecdsaPublicJwk: JsonWebKey;
  ecdsaPrivateJwk: JsonWebKey;
}
