import { finalizeEvent, getEventHash, getPublicKey, NostrEvent, verifyEvent } from 'nostr-tools/pure';
import * as nip59 from 'nostr-tools/nip59';
import { hexToBytes } from './nostrIdentity';
import { RelayConfig } from '../types/charisma';

export type CharismaNostrSignal =
  | {
      signalKind: 'friend_request' | 'friend_accept' | 'friend_decline';
      requestId: string;
      username?: string;
      displayName?: string;
      bio?: string;
      relayHints?: string[];
      ecdhPublicKeyJwk?: JsonWebKey;
      ecdsaPublicKeyJwk?: JsonWebKey;
    }
  | {
      signalKind: 'reaction';
      targetMsgId: string;
      emoji: string;
    }
  | {
      signalKind: 'edit';
      targetMsgId: string;
      newText: string;
    }
  | {
      signalKind: 'delete';
      targetMsgId: string;
    }
  | {
      signalKind: 'typing' | 'recording';
      active: boolean;
    }
  | {
      signalKind: 'read_ack';
      targetMsgId: string;
      status: 'delivered' | 'read';
    }
  | {
      signalKind: 'attachment';
      msgId: string;
      kind: 'image' | 'video' | 'document' | 'voice' | 'location' | 'contact';
      text: string;
      attachment: Record<string, unknown>;
      groupTitle?: string;
      memberPubkeys?: string[];
    }
  | {
      signalKind: 'rtc_offer' | 'rtc_answer' | 'rtc_ice' | 'rtc_hangup';
      callId: string;
      callKind?: 'audio' | 'video';
      sdp?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    }
  | {
      signalKind: 'transfer_offer' | 'transfer_answer' | 'transfer_ice';
      transferId: string;
      fileName?: string;
      sizeBytes?: number;
      sdp?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    };

export interface UnwrappedNip17Result {
  wrapId: string;
  rumorId: string;
  senderPubkeyHex: string;
  recipientPubkeys: string[];
  createdAtMs: number;
  kind: number;
  text: string;
  conversationTitle?: string;
  replyToEventId?: string;
  signal?: CharismaNostrSignal;
}

export function buildProfileMetadataEvent(
  privateKeyHex: string,
  profile: {
    username: string;
    displayName: string;
    bio: string;
    pictureUrl?: string;
    allowSearchByDisplayName?: boolean;
  },
): NostrEvent {
  const sk = hexToBytes(privateKeyHex);
  const metadata: Record<string, unknown> = {
    name: profile.username,
    display_name: profile.displayName || profile.username,
    about: profile.bio || '',
    charisma_v: 1,
    charisma_search_dn: profile.allowSearchByDisplayName ?? true,
  };
  if (profile.pictureUrl && /^https:\/\//i.test(profile.pictureUrl)) {
    metadata.picture = profile.pictureUrl;
  }

  return finalizeEvent(
    {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify(metadata),
    },
    sk,
  );
}

export function buildRelayListEvent(privateKeyHex: string, relays: RelayConfig[]): NostrEvent {
  const sk = hexToBytes(privateKeyHex);
  const tags: string[][] = relays
    .filter((r) => r.url.startsWith('wss://') || r.url.startsWith('ws://'))
    .map((r) => {
      if (r.read && r.write) return ['r', r.url];
      if (r.read) return ['r', r.url, 'read'];
      return ['r', r.url, 'write'];
    });
  return finalizeEvent(
    {
      kind: 10002,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    },
    sk,
  );
}

export function buildContactListEvent(privateKeyHex: string, friendPubkeysHex: string[]): NostrEvent {
  const sk = hexToBytes(privateKeyHex);
  const tags = Array.from(new Set(friendPubkeysHex))
    .filter((pk) => /^[0-9a-f]{64}$/i.test(pk))
    .map((pk) => ['p', pk.toLowerCase()]);

  return finalizeEvent(
    {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    },
    sk,
  );
}

/**
 * Creates standard NIP-17 Private Direct Message Gift Wraps (kind 1059)
 * using NIP-44 v2 encryption and NIP-59 Seal + Ephemeral Gift Wrap.
 * Produces one shared canonical rumor (same rumorId + full participant `p` tags across every member copy
 * and sender self-copy) so group chats and sender echo deduplication stay deterministic.
 * Never uses legacy NIP-04.
 */
export function buildNip17DirectMessageWraps(
  senderPrivateKeyHex: string,
  recipients: Array<{ publicKey: string; relayUrl?: string }>,
  plaintextMessage: string,
  opts?: {
    conversationTitle?: string;
    replyToEventId?: string;
    replyToRelayUrl?: string;
    createdAtSec?: number;
  },
): { wraps: NostrEvent[]; createdAtSec: number; rumorId: string } {
  const sk = hexToBytes(senderPrivateKeyHex);
  const senderPubkeyHex = getPublicKey(sk).toLowerCase();
  const createdAtSec = opts?.createdAtSec ?? Math.floor(Date.now() / 1000);

  const uniqueRecipientsMap = new Map<string, { publicKey: string; relayUrl?: string }>();
  for (const r of recipients) {
    const pk = r.publicKey.trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(pk) && !uniqueRecipientsMap.has(pk)) {
      uniqueRecipientsMap.set(pk, { publicKey: pk, relayUrl: r.relayUrl });
    }
  }

  const normalizedRecipients = Array.from(uniqueRecipientsMap.values());
  const tags: string[][] = normalizedRecipients.map((r) =>
    r.relayUrl ? ['p', r.publicKey, r.relayUrl] : ['p', r.publicKey],
  );
  if (opts?.replyToEventId) {
    tags.push(
      opts.replyToRelayUrl
        ? ['e', opts.replyToEventId, opts.replyToRelayUrl, 'reply']
        : ['e', opts.replyToEventId, '', 'reply'],
    );
  }
  if (opts?.conversationTitle?.trim()) {
    tags.push(['subject', opts.conversationTitle.trim()]);
  }

  const baseRumorEvent = {
    kind: 14,
    created_at: createdAtSec,
    tags,
    content: plaintextMessage,
  };

  const rumorId = getEventHash({
    ...baseRumorEvent,
    pubkey: senderPubkeyHex,
  });

  const remotePubkeys = normalizedRecipients
    .map((r) => r.publicKey)
    .filter((pk) => pk !== senderPubkeyHex);

  const wraps =
    remotePubkeys.length > 0
      ? nip59.wrapManyEvents(baseRumorEvent, sk, remotePubkeys)
      : [nip59.wrapEvent(baseRumorEvent, sk, senderPubkeyHex)];

  return { wraps, createdAtSec, rumorId };
}

/**
 * Wraps CHARISMA structured control payloads (friend requests, reactions, edits, deletes,
 * encrypted file descriptors, and WebRTC SDP/ICE signaling) strictly inside NIP-44 + NIP-59 Gift Wraps.
 * Relays observe only an anonymous ephemeral pubkey and encrypted ciphertext.
 */
export function buildNip59SignalWrap(
  senderPrivateKeyHex: string,
  recipientPubkeyHex: string,
  signal: CharismaNostrSignal,
): NostrEvent {
  const sk = hexToBytes(senderPrivateKeyHex);
  const payload = JSON.stringify({ __charisma_v1: true, ...signal });
  return nip59.wrapEvent(
    {
      kind: 14,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', recipientPubkeyHex.toLowerCase()],
        ['t', 'charisma-signal'],
      ],
      content: payload,
    },
    sk,
    recipientPubkeyHex.toLowerCase(),
  );
}

export function unwrapNip17OrNip59Event(
  wrapEvent: NostrEvent,
  recipientPrivateKeyHex: string,
): UnwrappedNip17Result | null {
  if (wrapEvent.kind !== 1059) return null;
  if (!verifyEvent(wrapEvent)) return null;

  try {
    const sk = hexToBytes(recipientPrivateKeyHex);
    const rumor = nip59.unwrapEvent(wrapEvent, sk);
    if (!rumor || typeof rumor.pubkey !== 'string' || typeof rumor.content !== 'string') {
      return null;
    }

    const recipientPubkeys = (rumor.tags || [])
      .filter((t) => t[0] === 'p' && typeof t[1] === 'string')
      .map((t) => t[1].toLowerCase());

    const subjectTag = (rumor.tags || []).find((t) => t[0] === 'subject')?.[1];
    const replyTag = (rumor.tags || []).find((t) => t[0] === 'e')?.[1];

    // Check if structured CHARISMA encrypted signal inside kind 14
    let signal: CharismaNostrSignal | undefined;
    if (rumor.content.startsWith('{') && rumor.content.includes('__charisma_v1')) {
      try {
        const parsed = JSON.parse(rumor.content) as { __charisma_v1?: boolean } & CharismaNostrSignal;
        if (parsed?.__charisma_v1 === true && typeof parsed.signalKind === 'string') {
          signal = parsed;
        }
      } catch {
        // Treat as regular text if malformed JSON
      }
    }

    return {
      wrapId: wrapEvent.id,
      rumorId: rumor.id,
      senderPubkeyHex: rumor.pubkey.toLowerCase(),
      recipientPubkeys,
      createdAtMs: (rumor.created_at || Math.floor(Date.now() / 1000)) * 1000,
      kind: rumor.kind,
      text: rumor.content,
      conversationTitle: subjectTag,
      replyToEventId: replyTag,
      signal,
    };
  } catch {
    return null;
  }
}
