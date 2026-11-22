import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip49 from 'nostr-tools/nip49';

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    throw new Error('Invalid hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export interface NostrKeyPair {
  privateKeyBytes: Uint8Array;
  privateKeyHex: string;
  publicKeyHex: string;
  npub: string;
  nsec: string;
}

export function isValidHex64(val: string): boolean {
  return /^[0-9a-f]{64}$/i.test(val.trim());
}

export function generateNostrKeys(): NostrKeyPair {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return {
    privateKeyBytes: sk,
    privateKeyHex: bytesToHex(sk),
    publicKeyHex: pk,
    npub: nip19.npubEncode(pk),
    nsec: nip19.nsecEncode(sk),
  };
}

export function keysFromPrivateHex(privateKeyHex: string): NostrKeyPair {
  const clean = privateKeyHex.trim().toLowerCase();
  if (!isValidHex64(clean)) {
    throw new Error('Invalid 64-char hex Nostr private key');
  }
  const sk = hexToBytes(clean);
  const pk = getPublicKey(sk);
  return {
    privateKeyBytes: sk,
    privateKeyHex: clean,
    publicKeyHex: pk,
    npub: nip19.npubEncode(pk),
    nsec: nip19.nsecEncode(sk),
  };
}

export function importNostrPrivateKey(rawInput: string, backupPassword?: string): NostrKeyPair {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('Nostr secret key is required');
  }

  if (trimmed.startsWith('ncryptsec1')) {
    if (!backupPassword) {
      throw new Error('Password is required to decrypt ncryptsec1 backup');
    }
    const sk = nip49.decrypt(trimmed, backupPassword);
    return keysFromPrivateHex(bytesToHex(sk));
  }

  if (trimmed.startsWith('nsec1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'nsec') {
      throw new Error('Invalid nsec1 key');
    }
    return keysFromPrivateHex(bytesToHex(decoded.data));
  }

  if (isValidHex64(trimmed)) {
    return keysFromPrivateHex(trimmed);
  }

  throw new Error('Supported backup formats: ncryptsec1..., nsec1..., or 64-char hex key');
}

export function exportNip49EncryptedBackup(privateKeyHex: string, password: string): string {
  if (!password || password.length < 4) {
    throw new Error('Backup password must be at least 4 characters');
  }
  const sk = hexToBytes(privateKeyHex.trim().toLowerCase());
  return nip49.encrypt(sk, password);
}

export function encodeNpub(pubkeyHex: string): string {
  return nip19.npubEncode(pubkeyHex.toLowerCase());
}

export function encodeNprofile(pubkeyHex: string, relays: string[] = []): string {
  return nip19.nprofileEncode({
    pubkey: pubkeyHex.toLowerCase(),
    relays: relays.slice(0, 4),
  });
}

export function parseNostrPublicIdentifier(rawInput: string): {
  pubkeyHex: string;
  npub: string;
  relayHints: string[];
} | null {
  let cleaned = rawInput.trim();
  if (!cleaned) return null;

  if (cleaned.toLowerCase().startsWith('nostr:')) {
    cleaned = cleaned.slice(6).trim();
  }

  // Handle CHARISMA profile share URI: charisma://nostr?npub=... or https://.../u/npub...
  if (cleaned.startsWith('charisma://') || cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    const match = cleaned.match(/(npub1[a-z0-9]+|nprofile1[a-z0-9]+)/i);
    if (match) cleaned = match[1];
  }

  if (isValidHex64(cleaned)) {
    const hex = cleaned.toLowerCase();
    return {
      pubkeyHex: hex,
      npub: nip19.npubEncode(hex),
      relayHints: [],
    };
  }

  if (cleaned.toLowerCase().startsWith('npub1') || cleaned.toLowerCase().startsWith('nprofile1')) {
    try {
      const decoded = nip19.decode(cleaned.toLowerCase());
      if (decoded.type === 'npub') {
        return {
          pubkeyHex: decoded.data,
          npub: nip19.npubEncode(decoded.data),
          relayHints: [],
        };
      }
      if (decoded.type === 'nprofile') {
        return {
          pubkeyHex: decoded.data.pubkey,
          npub: nip19.npubEncode(decoded.data.pubkey),
          relayHints: decoded.data.relays || [],
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}
