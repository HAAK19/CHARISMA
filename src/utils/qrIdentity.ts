import { PublicUser } from '../types/charisma';
import { encodeNprofile, parseNostrPublicIdentifier } from '../nostr/nostrIdentity';

export interface ScannedQrIdentity {
  userId?: string;
  nostrPubkeyHex?: string;
  npub?: string;
  relayHints?: string[];
  username?: string;
  displayName?: string;
  bio?: string;
  avatarColor?: string;
  avatarEmoji?: string;
  raw: string;
}

export function buildUserQrPayload(user: PublicUser): string {
  const compact = {
    v: 2,
    userId: user.userId,
    pk: user.nostrPubkeyHex,
    npub: user.npub,
    relays: (user.relayHints || []).slice(0, 3),
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    avatarColor: user.avatarColor,
    avatarEmoji: user.avatarEmoji,
  };
  return `charisma://user?data=${encodeURIComponent(JSON.stringify(compact))}`;
}

export function buildProfileShareLink(user: PublicUser): string {
  if (user.nostrPubkeyHex) {
    return `nostr:${encodeNprofile(user.nostrPubkeyHex, user.relayHints || [])}`;
  }
  return `nostr:${user.npub}`;
}

export function buildWebInviteUrl(user: PublicUser, originUrl?: string): string {
  const origin =
    originUrl ||
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '');
  const peerToken = user.nostrPubkeyHex
    ? encodeNprofile(user.nostrPubkeyHex, user.relayHints || [])
    : user.npub;
  if (!origin) return `?peer=${encodeURIComponent(peerToken)}`;
  return `${origin}/?peer=${encodeURIComponent(peerToken)}`;
}

export function parseUserQrPayload(rawText: string): ScannedQrIdentity | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('charisma://user')) {
      const idx = trimmed.indexOf('data=');
      if (idx !== -1) {
        const encoded = trimmed.slice(idx + 5).split('&')[0];
        const parsed = JSON.parse(decodeURIComponent(encoded)) as Partial<ScannedQrIdentity> & {
          pk?: string;
          relays?: string[];
        };
        const pubkeyHex = parsed.nostrPubkeyHex || parsed.pk;
        if (pubkeyHex || parsed.npub || parsed.userId || parsed.username) {
          const parsedNostr = parseNostrPublicIdentifier(pubkeyHex || parsed.npub || '');
          return {
            userId: parsed.userId || (parsedNostr ? `nostr_${parsedNostr.pubkeyHex.slice(0, 16)}` : undefined),
            nostrPubkeyHex: parsedNostr?.pubkeyHex || pubkeyHex,
            npub: parsedNostr?.npub || parsed.npub,
            relayHints: parsed.relayHints || parsed.relays || parsedNostr?.relayHints || [],
            username: parsed.username?.toLowerCase().replace(/^@/, ''),
            displayName: parsed.displayName,
            bio: parsed.bio,
            avatarColor: parsed.avatarColor,
            avatarEmoji: parsed.avatarEmoji,
            raw: trimmed,
          };
        }
      }
    }

    if (trimmed.startsWith('charisma://local/')) {
      const uname = trimmed.replace('charisma://local/', '').replace(/^@/, '').trim().toLowerCase();
      if (uname) {
        return { username: uname, raw: trimmed };
      }
    }

    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed) as Partial<ScannedQrIdentity> & { pk?: string; pubkey?: string };
      const pubkey = parsed.nostrPubkeyHex || parsed.pk || parsed.pubkey || parsed.npub;
      const parsedNostr = pubkey ? parseNostrPublicIdentifier(pubkey) : null;
      if (parsed.userId || parsed.username || parsedNostr) {
        return {
          userId: parsed.userId,
          nostrPubkeyHex: parsedNostr?.pubkeyHex,
          npub: parsedNostr?.npub,
          relayHints: parsedNostr?.relayHints || [],
          username: parsed.username?.toLowerCase().replace(/^@/, ''),
          displayName: parsed.displayName,
          bio: parsed.bio,
          avatarColor: parsed.avatarColor,
          avatarEmoji: parsed.avatarEmoji,
          raw: trimmed,
        };
      }
    }
  } catch {
    return null;
  }

  // Direct Nostr identifier (npub1..., nprofile1..., nostr:npub1..., 64-char hex)
  const nostrParsed = parseNostrPublicIdentifier(trimmed);
  if (nostrParsed) {
    return {
      nostrPubkeyHex: nostrParsed.pubkeyHex,
      npub: nostrParsed.npub,
      relayHints: nostrParsed.relayHints,
      raw: trimmed,
    };
  }

  if (trimmed.startsWith('usr_')) {
    return { userId: trimmed, raw: trimmed };
  }

  const normalizedHandle = trimmed.toLowerCase().replace(/^@/, '');
  if (/^[a-z0-9_]{3,24}$/.test(normalizedHandle)) {
    return { username: normalizedHandle, raw: trimmed };
  }

  return null;
}
