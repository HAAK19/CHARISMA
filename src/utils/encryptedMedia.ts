import { finalizeEvent } from 'nostr-tools/pure';
import { hexToBytes } from '../nostr/nostrIdentity';
import { fromBase64, sha256Hex, toBase64 } from '../crypto/charismaCrypto';

export interface EncryptedBlobResult {
  encryptedBytes: Uint8Array;
  keyB64: string;
  ivB64: string;
  ciphertextSha256: string;
}

export async function encryptBytesAesGcm(plainBuffer: ArrayBuffer): Promise<EncryptedBlobResult> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBuffer);
  const ciphertextSha256 = await sha256Hex(ciphertext);

  return {
    encryptedBytes: new Uint8Array(ciphertext),
    keyB64: toBase64(rawKey),
    ivB64: toBase64(iv),
    ciphertextSha256,
  };
}

export async function decryptBytesAesGcm(
  encryptedBuffer: ArrayBuffer | Uint8Array,
  keyB64: string,
  ivB64: string,
  expectedSha256?: string,
): Promise<ArrayBuffer> {
  const exactBuffer: ArrayBuffer =
    encryptedBuffer instanceof Uint8Array
      ? (encryptedBuffer.buffer.slice(
          encryptedBuffer.byteOffset,
          encryptedBuffer.byteOffset + encryptedBuffer.byteLength,
        ) as ArrayBuffer)
      : encryptedBuffer;

  if (expectedSha256) {
    const actualHash = await sha256Hex(exactBuffer);
    if (actualHash !== expectedSha256) {
      throw new Error('Encrypted file integrity check (SHA-256) failed');
    }
  }
  const rawKey = fromBase64(keyB64);
  const iv = fromBase64(ivB64);
  const key = await crypto.subtle.importKey(
    'raw',
    rawKey as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    exactBuffer,
  );
}

/**
 * Uploads an already AES-256-GCM encrypted blob to a user-consented Blossom server (BUD-02).
 * Signs a short-lived kind: 24242 authorization event locally without exposing plaintext or private keys.
 * Fails honestly if the remote host rejects the upload or blocks CORS.
 */
export async function uploadEncryptedBlobToBlossom(
  blossomBaseUrl: string,
  encryptedBytes: Uint8Array,
  ciphertextSha256: string,
  senderPrivateKeyHex: string,
): Promise<string> {
  const cleanBase = blossomBaseUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(cleanBase)) {
    throw new Error('Blossom media host must use HTTPS');
  }

  const exp = Math.floor(Date.now() / 1000) + 300;
  const authEvent = finalizeEvent(
    {
      kind: 24242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['t', 'upload'],
        ['x', ciphertextSha256],
        ['expiration', String(exp)],
      ],
      content: 'Upload encrypted CHARISMA attachment',
    },
    hexToBytes(senderPrivateKeyHex),
  );

  const authHeader = `Nostr ${btoa(JSON.stringify(authEvent))}`;
  const blob = new Blob([encryptedBytes as unknown as BlobPart], { type: 'application/octet-stream' });

  const res = await fetch(`${cleanBase}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/octet-stream',
      'X-SHA-256': ciphertextSha256,
    },
    body: blob,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Media host rejected upload (HTTP ${res.status}): ${errText.slice(0, 120) || 'Authorization or storage limit required'}`);
  }

  const json = (await res.json()) as { url?: string; sha256?: string };
  if (!json.url) {
    throw new Error('Media host response did not return a download URL');
  }
  return json.url;
}
