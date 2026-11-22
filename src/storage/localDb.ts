import { NostrEvent } from 'nostr-tools/pure';
import {
  decryptAccountSecrets,
  decryptJsonWithKeyB64,
  encryptAccountSecrets,
  encryptJsonWithKeyB64,
  generateDeviceKeyBundle,
  generateMasterKeyB64,
  hashAccountPassword,
  verifyAccountPassword,
} from '../crypto/charismaCrypto';
import {
  generateNostrKeys,
  importNostrPrivateKey,
} from '../nostr/nostrIdentity';
import { DEFAULT_NOSTR_RELAYS } from '../nostr/nostrRelayPool';
import {
  AppLanguage,
  CallLogEntry,
  ChannelItem,
  ChannelPost,
  ChatMessage,
  Conversation,
  CustomizationConfig,
  DecryptedAccountSecrets,
  DeletedThemeBackup,
  EncryptedLocalRecord,
  FriendRequestRecord,
  LocalAccountRecord,
  LocalEnvelopeRecord,
  OutboxItem,
  PrivacyPlusConfig,
  PublicUser,
  RelayConfig,
  SavedThemePreset,
  StorySlide,
  VaultItem,
} from '../types/charisma';
import { DEFAULT_CUSTOMIZATION_CONFIG, normalizeCustomization } from '../utils/themeEngine';

const DB_NAME = 'charisma_local_encrypted_v2';
const DB_VERSION = 4;

const STORES = {
  META: 'meta',
  ACCOUNTS: 'accounts',
  CONVERSATIONS: 'conversations',
  MESSAGES: 'messages',
  OUTBOX: 'outbox',
  ENVELOPES: 'envelopes',
  STORIES: 'stories',
  CALLS: 'calls',
  VAULT: 'vault',
  CHANNELS: 'channels',
  THEMES: 'themes',
  THEME_TRASH: 'theme_trash',
  FRIEND_REQUESTS: 'friend_requests',
  NOSTR_PEERS: 'nostr_peers',
  NOSTR_OUTBOX: 'nostr_outbox',
} as const;

export const DEFAULT_CUSTOMIZATION: CustomizationConfig = DEFAULT_CUSTOMIZATION_CONFIG;

export const DEFAULT_PRIVACY: PrivacyPlusConfig = {
  hideOnlineStatus: false,
  hideLastSeen: false,
  sendReadReceipts: true,
  sendTypingIndicators: true,
  sendRecordingIndicators: true,
  hideNotificationPreviews: false,
  appLockEnabled: false,
  autoReplyEnabled: false,
  autoReplyText: 'I am currently unavailable on CHARISMA. I will reply soon.',
  mediaQuality: 'original',
  autoDownloadImages: true,
  autoDownloadDocs: false,
  stunServerUrl: 'stun:stun.cloudflare.com:3478',
  freeMediaServerUrl: '',
  mediaServerConsentGranted: false,
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.META)) {
        db.createObjectStore(STORES.META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.ACCOUNTS)) {
        const s = db.createObjectStore(STORES.ACCOUNTS, { keyPath: 'userId' });
        s.createIndex('by_username', 'username', { unique: true });
      }
      if (!db.objectStoreNames.contains(STORES.CONVERSATIONS)) {
        const s = db.createObjectStore(STORES.CONVERSATIONS, { keyPath: 'id' });
        s.createIndex('by_owner', 'ownerUserId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
        const s = db.createObjectStore(STORES.MESSAGES, { keyPath: 'id' });
        s.createIndex('by_owner', 'ownerUserId', { unique: false });
        s.createIndex('by_conv', 'convId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.OUTBOX)) {
        const s = db.createObjectStore(STORES.OUTBOX, { keyPath: 'queueId' });
        s.createIndex('by_owner', 'ownerUserId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.ENVELOPES)) {
        const s = db.createObjectStore(STORES.ENVELOPES, { keyPath: 'envelopeId' });
        s.createIndex('by_recipient', 'toUserId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.STORIES)) {
        const s = db.createObjectStore(STORES.STORIES, { keyPath: 'id' });
        s.createIndex('by_owner', 'ownerUserId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.CALLS)) {
        const s = db.createObjectStore(STORES.CALLS, { keyPath: 'id' });
        s.createIndex('by_owner', 'ownerUserId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.VAULT)) {
        const s = db.createObjectStore(STORES.VAULT, { keyPath: 'vaultId' });
        s.createIndex('by_owner', 'ownerUserId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.CHANNELS)) {
        db.createObjectStore(STORES.CHANNELS, { keyPath: 'channelId' });
      }
      if (!db.objectStoreNames.contains(STORES.THEMES)) {
        const s = db.createObjectStore(STORES.THEMES, { keyPath: 'themeId' });
        s.createIndex('by_owner', 'ownerUserId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.THEME_TRASH)) {
        const s = db.createObjectStore(STORES.THEME_TRASH, { keyPath: 'backupId' });
        s.createIndex('by_owner', 'ownerUserId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.FRIEND_REQUESTS)) {
        const s = db.createObjectStore(STORES.FRIEND_REQUESTS, { keyPath: 'requestId' });
        s.createIndex('by_from', 'fromUserId', { unique: false });
        s.createIndex('by_to', 'toUserId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.NOSTR_PEERS)) {
        db.createObjectStore(STORES.NOSTR_PEERS, { keyPath: 'nostrPubkeyHex' });
      }
      if (!db.objectStoreNames.contains(STORES.NOSTR_OUTBOX)) {
        const s = db.createObjectStore(STORES.NOSTR_OUTBOX, { keyPath: 'eventId' });
        s.createIndex('by_owner', 'ownerUserId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.META, 'readonly');
    const req = tx.objectStore(STORES.META).get(key);
    req.onsuccess = () => resolve(req.result?.value as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function setMeta<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.META, 'readwrite');
    tx.objectStore(STORES.META).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve((req.result || []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function getByIndex<T>(storeName: string, indexName: string, key: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).index(indexName).getAll(key);
    req.onsuccess = () => resolve((req.result || []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function getByKey<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function putInStore<T>(storeName: string, item: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteFromStore(storeName: string, id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function toPublicUser(acc: LocalAccountRecord, isOnline = false): PublicUser {
  return {
    userId: acc.userId,
    nostrPubkeyHex: acc.nostrPubkeyHex || '',
    npub: acc.npub || '',
    username: acc.username,
    displayName: acc.displayName,
    bio: acc.bio,
    hideOnline: acc.hideOnline,
    hideLastSeen: acc.hideLastSeen,
    allowSearchByDisplayName: acc.allowSearchByDisplayName ?? true,
    avatarColor: acc.avatarColor,
    avatarEmoji: acc.avatarEmoji,
    avatarDataUrl: acc.avatarDataUrl,
    ecdhPublicKeyJwk: acc.ecdhPublicKeyJwk,
    ecdsaPublicKeyJwk: acc.ecdsaPublicKeyJwk,
    isOnline: acc.hideOnline ? false : isOnline,
    lastSeenAt: acc.hideLastSeen ? null : acc.lastLoginAt,
    blockedUserIds: acc.blockedUserIds || [],
    friendIds: acc.friendIds || [],
    favoriteIds: acc.favoriteIds || [],
    relayHints: (acc.preferredRelays || DEFAULT_NOSTR_RELAYS).filter((r) => r.read).map((r) => r.url),
  };
}

function makeScopedId(ownerUserId: string, itemId: string): string {
  return `${ownerUserId}::${itemId}`;
}

export const localDb = {
  getLanguage: () => getMeta<AppLanguage>('language'),
  setLanguage: (lang: AppLanguage) => setMeta('language', lang),

  async getCustomization(userId?: string): Promise<CustomizationConfig | undefined> {
    const raw = await getMeta<Partial<CustomizationConfig>>(userId ? `customization_${userId}` : 'customization');
    return raw ? normalizeCustomization(raw) : undefined;
  },
  setCustomization: (cfg: CustomizationConfig, userId?: string) =>
    setMeta(userId ? `customization_${userId}` : 'customization', normalizeCustomization(cfg)),

  async getThemeDraft(userId: string): Promise<{ config: CustomizationConfig; savedAt: number } | undefined> {
    const raw = await getMeta<{ config: Partial<CustomizationConfig>; savedAt: number }>(`theme_draft_${userId}`);
    if (!raw?.config) return undefined;
    return { config: normalizeCustomization(raw.config), savedAt: raw.savedAt };
  },
  async setThemeDraft(userId: string, config: CustomizationConfig | null): Promise<void> {
    if (!config) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.META, 'readwrite');
        tx.objectStore(STORES.META).delete(`theme_draft_${userId}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return;
    }
    await setMeta(`theme_draft_${userId}`, {
      config: normalizeCustomization(config),
      savedAt: Date.now(),
    });
  },

  async listSavedThemes(ownerUserId: string): Promise<SavedThemePreset[]> {
    const items = await getByIndex<SavedThemePreset>(STORES.THEMES, 'by_owner', ownerUserId);
    return items
      .map((item) => ({ ...item, config: normalizeCustomization(item.config) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async saveThemePreset(preset: SavedThemePreset): Promise<void> {
    await putInStore(STORES.THEMES, {
      ...preset,
      config: normalizeCustomization(preset.config),
    });
  },

  async deleteThemePresetWithBackup(themeId: string): Promise<DeletedThemeBackup | null> {
    const existing = await getByKey<SavedThemePreset>(STORES.THEMES, themeId);
    if (!existing) return null;
    const backup: DeletedThemeBackup = {
      backupId: `bak_${crypto.randomUUID()}`,
      ownerUserId: existing.ownerUserId,
      preset: existing,
      deletedAt: Date.now(),
    };
    await putInStore(STORES.THEME_TRASH, backup);
    await deleteFromStore(STORES.THEMES, themeId);
    return backup;
  },

  async listDeletedThemeBackups(ownerUserId: string): Promise<DeletedThemeBackup[]> {
    const list = await getByIndex<DeletedThemeBackup>(STORES.THEME_TRASH, 'by_owner', ownerUserId);
    return list.sort((a, b) => b.deletedAt - a.deletedAt);
  },

  async restoreDeletedTheme(backupId: string): Promise<SavedThemePreset | null> {
    const backup = await getByKey<DeletedThemeBackup>(STORES.THEME_TRASH, backupId);
    if (!backup) return null;
    const restored: SavedThemePreset = {
      ...backup.preset,
      updatedAt: Date.now(),
      config: normalizeCustomization(backup.preset.config),
    };
    await putInStore(STORES.THEMES, restored);
    await deleteFromStore(STORES.THEME_TRASH, backupId);
    return restored;
  },

  async purgeDeletedThemeBackup(backupId: string): Promise<void> {
    await deleteFromStore(STORES.THEME_TRASH, backupId);
  },

  getPrivacyPlus: (userId: string) => getMeta<PrivacyPlusConfig>(`privacy_plus_${userId}`),
  setPrivacyPlus: (userId: string, cfg: PrivacyPlusConfig) => setMeta(`privacy_plus_${userId}`, cfg),

  async getRelays(userId: string): Promise<RelayConfig[]> {
    const saved = await getMeta<RelayConfig[]>(`nostr_relays_${userId}`);
    if (saved && saved.length > 0) return saved;
    return DEFAULT_NOSTR_RELAYS.map((r) => ({ ...r }));
  },
  setRelays: (userId: string, relays: RelayConfig[]) => setMeta(`nostr_relays_${userId}`, relays),

  // Local Account Management (100% offline capable, Nostr secp256k1 + PBKDF2-310k + AES-256-GCM wrapped keys)
  async listLocalAccounts(): Promise<LocalAccountRecord[]> {
    const all = await getAllFromStore<LocalAccountRecord>(STORES.ACCOUNTS);
    return all.sort((a, b) => b.lastLoginAt - a.lastLoginAt);
  },

  async isUsernameAvailable(rawUsername: string, excludeUserId?: string): Promise<{ available: boolean; normalized: string; reason: string | null }> {
    const normalized = rawUsername.trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9_]{3,24}$/.test(normalized)) {
      return {
        available: false,
        normalized,
        reason: 'Username must be 3–24 characters (a-z, 0-9, _)',
      };
    }
    const existing = await getByIndex<LocalAccountRecord>(STORES.ACCOUNTS, 'by_username', normalized);
    const conflict = existing.some((a) => a.userId !== excludeUserId);
    return {
      available: !conflict,
      normalized,
      reason: conflict ? 'Username already exists on this device' : null,
    };
  },

  async registerLocalAccount(input: {
    username: string;
    password: string;
    displayName?: string;
    bio: string;
    avatarColor: string;
    avatarEmoji: string;
    avatarDataUrl?: string;
    allowSearchByDisplayName?: boolean;
    importedNostrSecret?: string;
    importedBackupPassword?: string;
  }): Promise<{
    user: PublicUser;
    secrets: DecryptedAccountSecrets;
  }> {
    const check = await this.isUsernameAvailable(input.username);
    if (!check.available) {
      throw new Error(check.reason || 'Invalid or duplicate username');
    }
    if (input.password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    const nostrKeys = input.importedNostrSecret?.trim()
      ? importNostrPrivateKey(input.importedNostrSecret, input.importedBackupPassword)
      : generateNostrKeys();

    const userId = `usr_${crypto.randomUUID()}`;
    const deviceId = `local_${crypto.randomUUID()}`;
    const keyBundle = await generateDeviceKeyBundle(deviceId);
    const dataMasterKeyB64 = generateMasterKeyB64();
    const secrets: DecryptedAccountSecrets = {
      keyBundle,
      dataMasterKeyB64,
      nostrPrivateKeyHex: nostrKeys.privateKeyHex,
      nsec: nostrKeys.nsec,
    };

    const { saltB64, verifierB64 } = await hashAccountPassword(input.password);
    const wrappedSecrets = await encryptAccountSecrets(input.password, secrets);

    const now = Date.now();
    const record: LocalAccountRecord = {
      userId,
      nostrPubkeyHex: nostrKeys.publicKeyHex,
      npub: nostrKeys.npub,
      username: check.normalized,
      displayName: (input.displayName || '').trim().slice(0, 48) || check.normalized,
      bio: input.bio.trim().slice(0, 160),
      avatarColor: input.avatarColor || '#00E5FF',
      avatarEmoji: input.avatarEmoji || '◈',
      avatarDataUrl: input.avatarDataUrl,
      hideOnline: false,
      hideLastSeen: false,
      allowSearchByDisplayName: input.allowSearchByDisplayName ?? true,
      ecdhPublicKeyJwk: keyBundle.ecdhPublicJwk,
      ecdsaPublicKeyJwk: keyBundle.ecdsaPublicJwk,
      blockedUserIds: [],
      friendIds: [],
      favoriteIds: [],
      preferredRelays: DEFAULT_NOSTR_RELAYS.map((r) => ({ ...r })),
      passwordSaltB64: saltB64,
      passwordVerifierB64: verifierB64,
      wrappedSecrets,
      createdAt: now,
      lastLoginAt: now,
    };

    await putInStore(STORES.ACCOUNTS, record);
    await this.setRelays(userId, DEFAULT_NOSTR_RELAYS.map((r) => ({ ...r })));
    return { user: toPublicUser(record, true), secrets };
  },

  async signInLocalAccount(rawUsername: string, password: string): Promise<{
    user: PublicUser;
    secrets: DecryptedAccountSecrets;
  }> {
    const normalized = rawUsername.trim().toLowerCase().replace(/^@/, '');
    const matches = await getByIndex<LocalAccountRecord>(STORES.ACCOUNTS, 'by_username', normalized);
    const record = matches[0];
    if (!record) {
      throw new Error('No local account found with that username on this device');
    }

    const valid = await verifyAccountPassword(
      password,
      record.passwordSaltB64,
      record.passwordVerifierB64,
    );
    if (!valid) {
      throw new Error('Incorrect password');
    }

    let secrets = await decryptAccountSecrets(password, record.wrappedSecrets);
    let updated: LocalAccountRecord = { ...record, lastLoginAt: Date.now() };

    // Upgrade pre-Nostr local accounts cleanly with a real secp256k1 identity
    if (!secrets.nostrPrivateKeyHex || !updated.nostrPubkeyHex) {
      const nostrKeys = generateNostrKeys();
      secrets = {
        ...secrets,
        nostrPrivateKeyHex: nostrKeys.privateKeyHex,
        nsec: nostrKeys.nsec,
      };
      const rewrapped = await encryptAccountSecrets(password, secrets);
      updated = {
        ...updated,
        nostrPubkeyHex: nostrKeys.publicKeyHex,
        npub: nostrKeys.npub,
        wrappedSecrets: rewrapped,
      };
    }

    await putInStore(STORES.ACCOUNTS, updated);
    return { user: toPublicUser(updated, true), secrets };
  },

  async changeLocalPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters');
    }
    const record = await getByKey<LocalAccountRecord>(STORES.ACCOUNTS, userId);
    if (!record) throw new Error('Account not found');

    const valid = await verifyAccountPassword(
      currentPassword,
      record.passwordSaltB64,
      record.passwordVerifierB64,
    );
    if (!valid) {
      throw new Error('Current password is incorrect');
    }

    const secrets = await decryptAccountSecrets(currentPassword, record.wrappedSecrets);
    const { saltB64, verifierB64 } = await hashAccountPassword(newPassword);
    const wrappedSecrets = await encryptAccountSecrets(newPassword, secrets);

    await putInStore(STORES.ACCOUNTS, {
      ...record,
      passwordSaltB64: saltB64,
      passwordVerifierB64: verifierB64,
      wrappedSecrets,
    });
  },

  async verifyLocalPassword(userId: string, password: string): Promise<boolean> {
    const record = await getByKey<LocalAccountRecord>(STORES.ACCOUNTS, userId);
    if (!record) return false;
    return verifyAccountPassword(password, record.passwordSaltB64, record.passwordVerifierB64);
  },

  async updateLocalProfile(
    userId: string,
    patch: {
      displayName?: string;
      username?: string;
      bio?: string;
      avatarColor?: string;
      avatarEmoji?: string;
      avatarDataUrl?: string;
      hideOnline?: boolean;
      hideLastSeen?: boolean;
      allowSearchByDisplayName?: boolean;
      blockedUserIds?: string[];
      friendIds?: string[];
    },
  ): Promise<PublicUser> {
    const record = await getByKey<LocalAccountRecord>(STORES.ACCOUNTS, userId);
    if (!record) throw new Error('Account not found');

    let nextUsername = record.username;
    if (typeof patch.username === 'string' && patch.username.trim()) {
      const check = await this.isUsernameAvailable(patch.username, userId);
      if (!check.available) {
        throw new Error(check.reason || 'Username unavailable');
      }
      nextUsername = check.normalized;
    }

    const updated: LocalAccountRecord = {
      ...record,
      username: nextUsername,
      displayName:
        typeof patch.displayName === 'string' && patch.displayName.trim()
          ? patch.displayName.trim().slice(0, 48)
          : record.displayName,
      bio: typeof patch.bio === 'string' ? patch.bio.trim().slice(0, 160) : record.bio,
      avatarColor: typeof patch.avatarColor === 'string' ? patch.avatarColor : record.avatarColor,
      avatarEmoji: typeof patch.avatarEmoji === 'string' ? patch.avatarEmoji : record.avatarEmoji,
      avatarDataUrl: 'avatarDataUrl' in patch ? patch.avatarDataUrl : record.avatarDataUrl,
      hideOnline: typeof patch.hideOnline === 'boolean' ? patch.hideOnline : record.hideOnline,
      hideLastSeen: typeof patch.hideLastSeen === 'boolean' ? patch.hideLastSeen : record.hideLastSeen,
      allowSearchByDisplayName:
        typeof patch.allowSearchByDisplayName === 'boolean'
          ? patch.allowSearchByDisplayName
          : (record.allowSearchByDisplayName ?? true),
      blockedUserIds: Array.isArray(patch.blockedUserIds) ? patch.blockedUserIds : (record.blockedUserIds || []),
      friendIds: Array.isArray(patch.friendIds) ? patch.friendIds : (record.friendIds || []),
    };

    await putInStore(STORES.ACCOUNTS, updated);
    return toPublicUser(updated, true);
  },

  async toggleFavorite(userId: string, targetUserId: string): Promise<PublicUser> {
    const record = await getByKey<LocalAccountRecord>(STORES.ACCOUNTS, userId);
    if (!record) throw new Error('Account not found');
    const cur = record.favoriteIds || [];
    const next = cur.includes(targetUserId)
      ? cur.filter((id) => id !== targetUserId)
      : [...cur, targetUserId];
    const updated: LocalAccountRecord = { ...record, favoriteIds: next };
    await putInStore(STORES.ACCOUNTS, updated);
    return toPublicUser(updated, true);
  },

  // Cached Nostr Peer Profiles (zero fake entries — strictly real profiles discovered via Nostr relays or QR)
  async upsertNostrPeer(peer: PublicUser): Promise<void> {
    if (!peer.nostrPubkeyHex) return;
    await putInStore(STORES.NOSTR_PEERS, {
      ...peer,
      nostrPubkeyHex: peer.nostrPubkeyHex.toLowerCase(),
    });
  },
  async listNostrPeers(): Promise<PublicUser[]> {
    return getAllFromStore<PublicUser>(STORES.NOSTR_PEERS);
  },
  async getNostrPeerByPubkey(pubkeyHex: string): Promise<PublicUser | undefined> {
    return getByKey<PublicUser>(STORES.NOSTR_PEERS, pubkeyHex.toLowerCase());
  },

  // Offline Nostr Outbox Queue (retries signed NIP-17 Gift Wraps when relays reconnect)
  async savePendingNostrWrap(ownerUserId: string, wrapEvent: NostrEvent, targetRelays?: string[]): Promise<void> {
    await putInStore(STORES.NOSTR_OUTBOX, {
      eventId: wrapEvent.id,
      ownerUserId,
      wrapEvent,
      targetRelays: targetRelays || [],
      queuedAt: Date.now(),
    });
  },
  async listPendingNostrWraps(ownerUserId: string): Promise<Array<{ eventId: string; ownerUserId: string; wrapEvent: NostrEvent; targetRelays: string[]; queuedAt: number }>> {
    return getByIndex(STORES.NOSTR_OUTBOX, 'by_owner', ownerUserId);
  },
  async deletePendingNostrWrap(eventId: string): Promise<void> {
    await deleteFromStore(STORES.NOSTR_OUTBOX, eventId);
  },

  // Phone-Free Friend Discovery & Friend Requests (Local + Nostr cross-device peers)
  async searchLocalUsers(requesterUserId: string, rawQuery: string): Promise<PublicUser[]> {
    const q = rawQuery.trim().toLowerCase().replace(/^@/, '');
    if (!q) return [];
    const [all, nostrPeers] = await Promise.all([
      this.listLocalAccounts(),
      this.listNostrPeers(),
    ]);
    const localResults = all
      .filter((acc) => acc.userId !== requesterUserId)
      .filter((acc) => !(acc.blockedUserIds || []).includes(requesterUserId))
      .filter((acc) => {
        const usernameMatch = acc.username.toLowerCase().includes(q);
        const idMatch =
          acc.userId.toLowerCase() === q ||
          acc.userId.toLowerCase().startsWith(q) ||
          (acc.npub || '').toLowerCase() === q ||
          (acc.nostrPubkeyHex || '').toLowerCase() === q;
        const displayMatch =
          (acc.allowSearchByDisplayName ?? true) && acc.displayName.toLowerCase().includes(q);
        return usernameMatch || idMatch || displayMatch;
      })
      .map((acc) => toPublicUser(acc, true));

    const seenPubkeys = new Set(localResults.map((r) => r.nostrPubkeyHex).filter(Boolean));
    const peerResults = nostrPeers.filter((p) => {
      if (p.userId === requesterUserId || seenPubkeys.has(p.nostrPubkeyHex)) return false;
      const usernameMatch = p.username.toLowerCase().includes(q);
      const keyMatch =
        p.npub.toLowerCase() === q ||
        p.nostrPubkeyHex.toLowerCase() === q ||
        p.userId.toLowerCase().startsWith(q);
      const displayMatch =
        (p.allowSearchByDisplayName ?? true) && p.displayName.toLowerCase().includes(q);
      return usernameMatch || keyMatch || displayMatch;
    });

    return [...localResults, ...peerResults];
  },

  async findLocalUserByIdOrUsername(userIdOrUsername: string): Promise<PublicUser | null> {
    const cleaned = userIdOrUsername.trim();
    const byId = await getByKey<LocalAccountRecord>(STORES.ACCOUNTS, cleaned);
    if (byId) return toPublicUser(byId, true);
    const normalized = cleaned.toLowerCase().replace(/^@/, '');
    const byUsername = await getByIndex<LocalAccountRecord>(STORES.ACCOUNTS, 'by_username', normalized);
    if (byUsername[0]) return toPublicUser(byUsername[0], true);
    const peerByPub = await this.getNostrPeerByPubkey(normalized);
    return peerByPub || null;
  },

  async listFriendRequests(userId: string): Promise<{
    incoming: FriendRequestRecord[];
    outgoing: FriendRequestRecord[];
  }> {
    const [inc, out] = await Promise.all([
      getByIndex<FriendRequestRecord>(STORES.FRIEND_REQUESTS, 'by_to', userId),
      getByIndex<FriendRequestRecord>(STORES.FRIEND_REQUESTS, 'by_from', userId),
    ]);
    return {
      incoming: inc.filter((r) => r.status === 'pending').sort((a, b) => b.createdAt - a.createdAt),
      outgoing: out.filter((r) => r.status === 'pending').sort((a, b) => b.createdAt - a.createdAt),
    };
  },

  async recordIncomingNostrFriendRequest(input: {
    requestId: string;
    fromUserId: string;
    toUserId: string;
    fromNostrPubkeyHex: string;
    toNostrPubkeyHex: string;
  }): Promise<FriendRequestRecord> {
    const existing = await getByKey<FriendRequestRecord>(STORES.FRIEND_REQUESTS, input.requestId);
    if (existing) return existing;
    const now = Date.now();
    const rec: FriendRequestRecord = {
      requestId: input.requestId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      fromNostrPubkeyHex: input.fromNostrPubkeyHex,
      toNostrPubkeyHex: input.toNostrPubkeyHex,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await putInStore(STORES.FRIEND_REQUESTS, rec);
    return rec;
  },

  async addFriendDirect(userId: string, friendUserId: string): Promise<PublicUser> {
    const me = await getByKey<LocalAccountRecord>(STORES.ACCOUNTS, userId);
    if (!me) throw new Error('Account not found');
    const updated: LocalAccountRecord = {
      ...me,
      friendIds: Array.from(new Set([...(me.friendIds || []), friendUserId])),
    };
    await putInStore(STORES.ACCOUNTS, updated);
    // Mark any pending requests between them as accepted
    const [outReqs, inReqs] = await Promise.all([
      getByIndex<FriendRequestRecord>(STORES.FRIEND_REQUESTS, 'by_from', userId),
      getByIndex<FriendRequestRecord>(STORES.FRIEND_REQUESTS, 'by_to', userId),
    ]);
    for (const r of [...outReqs, ...inReqs]) {
      if (
        r.status === 'pending' &&
        (r.fromUserId === friendUserId || r.toUserId === friendUserId)
      ) {
        await putInStore(STORES.FRIEND_REQUESTS, { ...r, status: 'accepted', updatedAt: Date.now() });
      }
    }
    return toPublicUser(updated, true);
  },

  async sendFriendRequest(fromUserId: string, toUserId: string, toNostrPubkeyHex?: string): Promise<FriendRequestRecord> {
    if (fromUserId === toUserId) {
      throw new Error('Cannot send a friend request to yourself');
    }
    const sender = await getByKey<LocalAccountRecord>(STORES.ACCOUNTS, fromUserId);
    if (!sender) throw new Error('Sender account not found');
    const target = await getByKey<LocalAccountRecord>(STORES.ACCOUNTS, toUserId);
    const peerTarget = target ? null : (toNostrPubkeyHex ? await this.getNostrPeerByPubkey(toNostrPubkeyHex) : null);

    if (!target && !peerTarget && !toNostrPubkeyHex) {
      throw new Error('Target user account not found');
    }
    if (
      (target && (target.blockedUserIds || []).includes(fromUserId)) ||
      (sender.blockedUserIds || []).includes(toUserId)
    ) {
      throw new Error('Cannot send request due to block status');
    }
    if ((sender.friendIds || []).includes(toUserId)) {
      throw new Error('Already friends');
    }

    const outgoing = await getByIndex<FriendRequestRecord>(STORES.FRIEND_REQUESTS, 'by_from', fromUserId);
    const existingPending = outgoing.find((r) => r.toUserId === toUserId && r.status === 'pending');
    if (existingPending) return existingPending;

    const incoming = await getByIndex<FriendRequestRecord>(STORES.FRIEND_REQUESTS, 'by_to', fromUserId);
    const reversePending = incoming.find((r) => r.fromUserId === toUserId && r.status === 'pending');
    if (reversePending) {
      await this.acceptFriendRequest(reversePending.requestId, fromUserId);
      return { ...reversePending, status: 'accepted', updatedAt: Date.now() };
    }

    const now = Date.now();
    const rec: FriendRequestRecord = {
      requestId: `fr_${crypto.randomUUID()}`,
      fromUserId,
      toUserId,
      fromNostrPubkeyHex: sender.nostrPubkeyHex,
      toNostrPubkeyHex: target?.nostrPubkeyHex || toNostrPubkeyHex,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    await putInStore(STORES.FRIEND_REQUESTS, rec);
    return rec;
  },

  async acceptFriendRequest(requestId: string, acceptingUserId: string): Promise<FriendRequestRecord> {
    const req = await getByKey<FriendRequestRecord>(STORES.FRIEND_REQUESTS, requestId);
    if (!req || req.toUserId !== acceptingUserId || req.status !== 'pending') {
      throw new Error('Pending friend request not found');
    }
    const receiver = await getByKey<LocalAccountRecord>(STORES.ACCOUNTS, req.toUserId);
    if (!receiver) throw new Error('Account not found');

    const sender = await getByKey<LocalAccountRecord>(STORES.ACCOUNTS, req.fromUserId);
    if (sender) {
      await putInStore(STORES.ACCOUNTS, {
        ...sender,
        friendIds: Array.from(new Set([...(sender.friendIds || []), receiver.userId])),
      });
    }

    const updatedReceiver: LocalAccountRecord = {
      ...receiver,
      friendIds: Array.from(new Set([...(receiver.friendIds || []), req.fromUserId])),
    };
    const updatedReq: FriendRequestRecord = { ...req, status: 'accepted', updatedAt: Date.now() };

    await Promise.all([
      putInStore(STORES.ACCOUNTS, updatedReceiver),
      putInStore(STORES.FRIEND_REQUESTS, updatedReq),
    ]);
    return updatedReq;
  },

  async declineFriendRequest(requestId: string, decliningUserId: string): Promise<void> {
    const req = await getByKey<FriendRequestRecord>(STORES.FRIEND_REQUESTS, requestId);
    if (!req || req.toUserId !== decliningUserId || req.status !== 'pending') return;
    await putInStore(STORES.FRIEND_REQUESTS, { ...req, status: 'declined', updatedAt: Date.now() });
  },

  async cancelFriendRequest(requestId: string, senderUserId: string): Promise<void> {
    const req = await getByKey<FriendRequestRecord>(STORES.FRIEND_REQUESTS, requestId);
    if (!req || req.fromUserId !== senderUserId || req.status !== 'pending') return;
    await putInStore(STORES.FRIEND_REQUESTS, { ...req, status: 'cancelled', updatedAt: Date.now() });
  },

  async removeFriend(userId: string, friendUserId: string): Promise<PublicUser> {
    const [me, peer] = await Promise.all([
      getByKey<LocalAccountRecord>(STORES.ACCOUNTS, userId),
      getByKey<LocalAccountRecord>(STORES.ACCOUNTS, friendUserId),
    ]);
    if (!me) throw new Error('Account not found');

    const nextMe: LocalAccountRecord = {
      ...me,
      friendIds: (me.friendIds || []).filter((id) => id !== friendUserId),
      favoriteIds: (me.favoriteIds || []).filter((id) => id !== friendUserId),
    };
    await putInStore(STORES.ACCOUNTS, nextMe);

    if (peer) {
      await putInStore(STORES.ACCOUNTS, {
        ...peer,
        friendIds: (peer.friendIds || []).filter((id) => id !== userId),
      });
    }
    return toPublicUser(nextMe, true);
  },

  async blockOrUnblockUser(userId: string, targetUserId: string, block: boolean): Promise<PublicUser> {
    const [me, peer] = await Promise.all([
      getByKey<LocalAccountRecord>(STORES.ACCOUNTS, userId),
      getByKey<LocalAccountRecord>(STORES.ACCOUNTS, targetUserId),
    ]);
    if (!me) throw new Error('Account not found');

    const nextBlocked = block
      ? Array.from(new Set([...(me.blockedUserIds || []), targetUserId]))
      : (me.blockedUserIds || []).filter((id) => id !== targetUserId);

    const nextMe: LocalAccountRecord = {
      ...me,
      blockedUserIds: nextBlocked,
      friendIds: block ? (me.friendIds || []).filter((id) => id !== targetUserId) : (me.friendIds || []),
      favoriteIds: block ? (me.favoriteIds || []).filter((id) => id !== targetUserId) : (me.favoriteIds || []),
    };
    await putInStore(STORES.ACCOUNTS, nextMe);

    if (block) {
      if (peer) {
        await putInStore(STORES.ACCOUNTS, {
          ...peer,
          friendIds: (peer.friendIds || []).filter((id) => id !== userId),
        });
      }
      const [outReqs, inReqs] = await Promise.all([
        getByIndex<FriendRequestRecord>(STORES.FRIEND_REQUESTS, 'by_from', userId),
        getByIndex<FriendRequestRecord>(STORES.FRIEND_REQUESTS, 'by_to', userId),
      ]);
      for (const r of [...outReqs, ...inReqs]) {
        if (
          r.status === 'pending' &&
          ((r.fromUserId === userId && r.toUserId === targetUserId) ||
            (r.fromUserId === targetUserId && r.toUserId === userId))
        ) {
          await putInStore(STORES.FRIEND_REQUESTS, { ...r, status: 'cancelled', updatedAt: Date.now() });
        }
      }
    }
    return toPublicUser(nextMe, true);
  },

  // Encrypted Per-User Conversations
  async getConversations(ownerUserId: string, masterKeyB64: string): Promise<Conversation[]> {
    const rows = await getByIndex<EncryptedLocalRecord>(STORES.CONVERSATIONS, 'by_owner', ownerUserId);
    const out: Conversation[] = [];
    for (const row of rows) {
      try {
        out.push(await decryptJsonWithKeyB64<Conversation>(masterKeyB64, row.ivB64, row.ciphertextB64));
      } catch {
        // Skip corrupted record safely
      }
    }
    return out;
  },

  async saveConversation(ownerUserId: string, masterKeyB64: string, conv: Conversation): Promise<void> {
    const enc = await encryptJsonWithKeyB64(masterKeyB64, conv);
    const rec: EncryptedLocalRecord = {
      id: makeScopedId(ownerUserId, conv.convId),
      ownerUserId,
      ivB64: enc.ivB64,
      ciphertextB64: enc.ciphertextB64,
    };
    await putInStore(STORES.CONVERSATIONS, rec);
  },

  async deleteConversation(ownerUserId: string, convId: string): Promise<void> {
    await deleteFromStore(STORES.CONVERSATIONS, makeScopedId(ownerUserId, convId));
  },

  // Encrypted Per-User Messages
  async getAllMessages(ownerUserId: string, masterKeyB64: string): Promise<ChatMessage[]> {
    const rows = await getByIndex<EncryptedLocalRecord>(STORES.MESSAGES, 'by_owner', ownerUserId);
    const out: ChatMessage[] = [];
    for (const row of rows) {
      try {
        out.push(await decryptJsonWithKeyB64<ChatMessage>(masterKeyB64, row.ivB64, row.ciphertextB64));
      } catch {
        // Skip unreadable record
      }
    }
    return out;
  },

  async saveMessage(ownerUserId: string, masterKeyB64: string, msg: ChatMessage): Promise<void> {
    const enc = await encryptJsonWithKeyB64(masterKeyB64, msg);
    const rec: EncryptedLocalRecord = {
      id: makeScopedId(ownerUserId, msg.msgId),
      ownerUserId,
      convId: makeScopedId(ownerUserId, msg.convId),
      ivB64: enc.ivB64,
      ciphertextB64: enc.ciphertextB64,
    };
    await putInStore(STORES.MESSAGES, rec);
  },

  async deleteMessage(ownerUserId: string, msgId: string): Promise<void> {
    await deleteFromStore(STORES.MESSAGES, makeScopedId(ownerUserId, msgId));
  },

  async clearConversationMessages(ownerUserId: string, convId: string): Promise<void> {
    const scopedConvId = makeScopedId(ownerUserId, convId);
    const rows = await getByIndex<EncryptedLocalRecord>(STORES.MESSAGES, 'by_conv', scopedConvId);
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = tx.objectStore(STORES.MESSAGES);
      for (const r of rows) {
        store.delete(r.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // Encrypted Per-User Stories
  async getStories(ownerUserId: string, masterKeyB64: string): Promise<StorySlide[]> {
    const rows = await getByIndex<EncryptedLocalRecord>(STORES.STORIES, 'by_owner', ownerUserId);
    const out: StorySlide[] = [];
    for (const row of rows) {
      try {
        out.push(await decryptJsonWithKeyB64<StorySlide>(masterKeyB64, row.ivB64, row.ciphertextB64));
      } catch {
        // Ignore
      }
    }
    return out;
  },

  async saveStory(ownerUserId: string, masterKeyB64: string, story: StorySlide): Promise<void> {
    const enc = await encryptJsonWithKeyB64(masterKeyB64, story);
    const rec: EncryptedLocalRecord = {
      id: makeScopedId(ownerUserId, story.storyId),
      ownerUserId,
      ivB64: enc.ivB64,
      ciphertextB64: enc.ciphertextB64,
    };
    await putInStore(STORES.STORIES, rec);
  },

  // Encrypted Per-User Calls
  async getCalls(ownerUserId: string, masterKeyB64: string): Promise<CallLogEntry[]> {
    const rows = await getByIndex<EncryptedLocalRecord>(STORES.CALLS, 'by_owner', ownerUserId);
    const out: CallLogEntry[] = [];
    for (const row of rows) {
      try {
        out.push(await decryptJsonWithKeyB64<CallLogEntry>(masterKeyB64, row.ivB64, row.ciphertextB64));
      } catch {
        // Ignore
      }
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  },

  async saveCall(ownerUserId: string, masterKeyB64: string, call: CallLogEntry): Promise<void> {
    const enc = await encryptJsonWithKeyB64(masterKeyB64, call);
    const rec: EncryptedLocalRecord = {
      id: makeScopedId(ownerUserId, call.callId),
      ownerUserId,
      ivB64: enc.ivB64,
      ciphertextB64: enc.ciphertextB64,
    };
    await putInStore(STORES.CALLS, rec);
  },

  // Encrypted Vault (Double-protected with separate Vault passphrase via PBKDF2 + AES-256-GCM)
  getVaultItems: (ownerUserId: string) => getByIndex<VaultItem>(STORES.VAULT, 'by_owner', ownerUserId),
  saveVaultItem: (item: VaultItem) => putInStore(STORES.VAULT, item),
  deleteVaultItem: (vaultId: string) => deleteFromStore(STORES.VAULT, vaultId),

  // Local Outbox & Local E2EE Envelopes between accounts on same device
  getOutbox: (ownerUserId: string) => getByIndex<OutboxItem>(STORES.OUTBOX, 'by_owner', ownerUserId),
  saveOutboxItem: (item: OutboxItem) => putInStore(STORES.OUTBOX, item),
  removeOutboxItem: (queueId: string) => deleteFromStore(STORES.OUTBOX, queueId),

  async enqueueLocalEnvelope(env: LocalEnvelopeRecord): Promise<void> {
    await putInStore(STORES.ENVELOPES, env);
  },

  async consumeLocalEnvelopes(recipientUserId: string): Promise<LocalEnvelopeRecord[]> {
    const envs = await getByIndex<LocalEnvelopeRecord>(STORES.ENVELOPES, 'by_recipient', recipientUserId);
    if (envs.length === 0) return [];
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.ENVELOPES, 'readwrite');
      const store = tx.objectStore(STORES.ENVELOPES);
      for (const e of envs) store.delete(e.envelopeId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return envs.sort((a, b) => a.queuedAt - b.queuedAt);
  },

  // Local Channels & Communities (100% IndexedDB, zero central servers)
  async getChannels(): Promise<ChannelItem[]> {
    const list = await getAllFromStore<ChannelItem>(STORES.CHANNELS);
    if (list.length > 0) return list;

    const seeded: ChannelItem[] = [
      {
        channelId: 'ch_charisma_local',
        name: 'CHARISMA Local Security Notes',
        description: 'Offline-first protocol notes and local privacy architecture tips stored exclusively on your device.',
        isPublic: true,
        kind: 'channel',
        adminUserIds: ['system'],
        subscriberUserIds: [],
        memberGroupNames: [],
        createdAt: Date.now() - 86_400_000,
        posts: [
          {
            postId: 'post_local_1',
            authorUserId: 'system',
            authorUsername: 'charisma_local',
            authorDisplayName: 'CHARISMA Local Core',
            text: 'All your chats, stories, vault items, and credentials are encrypted and stored solely on this device. Zero cloud servers or external APIs are used.',
            reactions: { '🔒': [], '⚡': [] },
            createdAt: Date.now() - 3_600_000 * 3,
          },
        ],
      },
      {
        channelId: 'comm_offline_builders',
        name: 'Offline Privacy Community · مجتمع الخصوصية المحلي',
        description: 'Local workspace community for organizing offline notes, research topics, and encrypted archives.',
        isPublic: true,
        kind: 'community',
        adminUserIds: ['system'],
        subscriberUserIds: [],
        memberGroupNames: ['Key Custody & Backups', 'Arabic RTL Design', 'Offline Vault Archive'],
        createdAt: Date.now() - 86_400_000 * 2,
        posts: [
          {
            postId: 'post_local_2',
            authorUserId: 'system',
            authorUsername: 'privacy_local',
            authorDisplayName: 'Privacy Architects',
            text: 'مرحباً بك في البيئة المحلية المستقلة. جميع بياناتك ومفاتيحك محفوظة ومشفرة على جهازك فقط وتعمل دون الحاجة للإنترنت.',
            reactions: { '🛡️': [], '💜': [] },
            createdAt: Date.now() - 3_600_000,
          },
        ],
      },
    ];

    for (const ch of seeded) {
      await putInStore(STORES.CHANNELS, ch);
    }
    return seeded;
  },

  async saveChannel(channel: ChannelItem): Promise<void> {
    await putInStore(STORES.CHANNELS, channel);
  },

  async publishChannelPost(channelId: string, post: ChannelPost): Promise<ChannelItem | null> {
    const ch = await getByKey<ChannelItem>(STORES.CHANNELS, channelId);
    if (!ch) return null;
    const updated: ChannelItem = { ...ch, posts: [post, ...ch.posts] };
    await putInStore(STORES.CHANNELS, updated);
    return updated;
  },

  async deleteLocalAccount(userId: string): Promise<void> {
    const db = await openDb();
    const [convs, msgs, stories, calls, vault, outbox, nostrOutbox, incomingEnv, userThemes, userTrash, sentReqs, recReqs] = await Promise.all([
      getByIndex<EncryptedLocalRecord>(STORES.CONVERSATIONS, 'by_owner', userId),
      getByIndex<EncryptedLocalRecord>(STORES.MESSAGES, 'by_owner', userId),
      getByIndex<EncryptedLocalRecord>(STORES.STORIES, 'by_owner', userId),
      getByIndex<EncryptedLocalRecord>(STORES.CALLS, 'by_owner', userId),
      getByIndex<VaultItem>(STORES.VAULT, 'by_owner', userId),
      getByIndex<OutboxItem>(STORES.OUTBOX, 'by_owner', userId),
      getByIndex<{ eventId: string }>(STORES.NOSTR_OUTBOX, 'by_owner', userId),
      getByIndex<LocalEnvelopeRecord>(STORES.ENVELOPES, 'by_recipient', userId),
      getByIndex<SavedThemePreset>(STORES.THEMES, 'by_owner', userId),
      getByIndex<DeletedThemeBackup>(STORES.THEME_TRASH, 'by_owner', userId),
      getByIndex<FriendRequestRecord>(STORES.FRIEND_REQUESTS, 'by_from', userId),
      getByIndex<FriendRequestRecord>(STORES.FRIEND_REQUESTS, 'by_to', userId),
    ]);

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [
          STORES.ACCOUNTS,
          STORES.CONVERSATIONS,
          STORES.MESSAGES,
          STORES.STORIES,
          STORES.CALLS,
          STORES.VAULT,
          STORES.OUTBOX,
          STORES.NOSTR_OUTBOX,
          STORES.ENVELOPES,
          STORES.META,
          STORES.THEMES,
          STORES.THEME_TRASH,
          STORES.FRIEND_REQUESTS,
        ],
        'readwrite',
      );
      tx.objectStore(STORES.ACCOUNTS).delete(userId);
      tx.objectStore(STORES.META).delete(`customization_${userId}`);
      tx.objectStore(STORES.META).delete(`theme_draft_${userId}`);
      tx.objectStore(STORES.META).delete(`privacy_plus_${userId}`);
      tx.objectStore(STORES.META).delete(`nostr_relays_${userId}`);
      for (const r of convs) tx.objectStore(STORES.CONVERSATIONS).delete(r.id);
      for (const r of msgs) tx.objectStore(STORES.MESSAGES).delete(r.id);
      for (const r of stories) tx.objectStore(STORES.STORIES).delete(r.id);
      for (const r of calls) tx.objectStore(STORES.CALLS).delete(r.id);
      for (const r of vault) tx.objectStore(STORES.VAULT).delete(r.vaultId);
      for (const r of outbox) tx.objectStore(STORES.OUTBOX).delete(r.queueId);
      for (const r of nostrOutbox) tx.objectStore(STORES.NOSTR_OUTBOX).delete(r.eventId);
      for (const r of incomingEnv) tx.objectStore(STORES.ENVELOPES).delete(r.envelopeId);
      for (const r of userThemes) tx.objectStore(STORES.THEMES).delete(r.themeId);
      for (const r of userTrash) tx.objectStore(STORES.THEME_TRASH).delete(r.backupId);
      for (const r of [...sentReqs, ...recReqs]) tx.objectStore(STORES.FRIEND_REQUESTS).delete(r.requestId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async wipeAllLocalData(): Promise<void> {
    const db = await openDb();
    const storeNames = Object.values(STORES);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite');
      for (const s of storeNames) tx.objectStore(s).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};
