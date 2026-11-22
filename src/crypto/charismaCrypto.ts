import {
  DecryptedAccountSecrets,
  EncryptedEnvelopePayload,
  LocalKeyBundle,
  WrappedAccountSecrets,
} from '../types/charisma';

const PASSWORD_PBKDF2_ITERATIONS = 310_000;
const KEY_WRAP_ITERATIONS = 180_000;

export function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function generateDeviceKeyBundle(deviceId: string): Promise<LocalKeyBundle> {
  const ecdhPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits'],
  );
  const ecdsaPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );

  return {
    deviceId,
    ecdhPublicJwk: await crypto.subtle.exportKey('jwk', ecdhPair.publicKey),
    ecdhPrivateJwk: await crypto.subtle.exportKey('jwk', ecdhPair.privateKey),
    ecdsaPublicJwk: await crypto.subtle.exportKey('jwk', ecdsaPair.publicKey),
    ecdsaPrivateJwk: await crypto.subtle.exportKey('jwk', ecdsaPair.privateKey),
  };
}

export function generateMasterKeyB64(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return toBase64(raw);
}

/**
 * Derives a 256-bit password verifier via PBKDF2-HMAC-SHA256 (310,000 iterations)
 * with a unique 16-byte random salt per local account.
 */
export async function hashAccountPassword(
  password: string,
  existingSaltB64?: string,
): Promise<{ saltB64: string; verifierB64: string }> {
  const salt = existingSaltB64
    ? fromBase64(existingSaltB64)
    : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PASSWORD_PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  return {
    saltB64: toBase64(salt),
    verifierB64: toBase64(bits),
  };
}

export async function verifyAccountPassword(
  password: string,
  saltB64: string,
  expectedVerifierB64: string,
): Promise<boolean> {
  const { verifierB64 } = await hashAccountPassword(password, saltB64);
  const actual = fromBase64(verifierB64);
  const expected = fromBase64(expectedVerifierB64);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual[i] ^ expected[i];
  }
  return diff === 0;
}

export async function encryptAccountSecrets(
  password: string,
  secrets: DecryptedAccountSecrets,
): Promise<WrappedAccountSecrets> {
  const encoded = new TextEncoder().encode(JSON.stringify(secrets));
  return encryptWithPassphrase(password, encoded.buffer as ArrayBuffer);
}

export async function decryptAccountSecrets(
  password: string,
  wrapped: WrappedAccountSecrets,
): Promise<DecryptedAccountSecrets> {
  const buf = await decryptWithPassphrase(
    password,
    wrapped.ivB64,
    wrapped.saltB64,
    wrapped.encryptedDataB64,
  );
  return JSON.parse(new TextDecoder().decode(buf)) as DecryptedAccountSecrets;
}

export async function encryptJsonWithKeyB64(
  keyB64: string,
  value: unknown,
): Promise<{ ivB64: string; ciphertextB64: string }> {
  const rawKey = fromBase64(keyB64);
  const aesKey = await crypto.subtle.importKey(
    'raw',
    rawKey as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);
  return {
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(ciphertext),
  };
}

export async function decryptJsonWithKeyB64<T>(
  keyB64: string,
  ivB64: string,
  ciphertextB64: string,
): Promise<T> {
  const rawKey = fromBase64(keyB64);
  const aesKey = await crypto.subtle.importKey(
    'raw',
    rawKey as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const iv = fromBase64(ivB64);
  const ciphertext = fromBase64(ciphertextB64);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    aesKey,
    ciphertext as unknown as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

async function deriveSharedAesKey(
  ownEcdhPrivateJwk: JsonWebKey,
  peerEcdhPublicJwk: JsonWebKey,
): Promise<CryptoKey> {
  const privKey = await crypto.subtle.importKey(
    'jwk',
    ownEcdhPrivateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const pubKey = await crypto.subtle.importKey(
    'jwk',
    peerEcdhPublicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: pubKey },
    privKey,
    256,
  );

  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('CHARISMA-E2EE-V1'),
      info: new TextEncoder().encode('charisma-message-key'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptEnvelope(
  bundle: LocalKeyBundle,
  peerEcdhPublicJwk: JsonWebKey,
  envelopeType: EncryptedEnvelopePayload['envelopeType'],
  plaintextObj: unknown,
): Promise<EncryptedEnvelopePayload> {
  const aesKey = await deriveSharedAesKey(bundle.ecdhPrivateJwk, peerEcdhPublicJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(plaintextObj));

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);
  const signingKey = await crypto.subtle.importKey(
    'jwk',
    bundle.ecdsaPrivateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sigInput = new Uint8Array([...iv, ...new Uint8Array(ciphertext)]);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    sigInput,
  );

  return {
    alg: 'ECDH-P256-HKDF-AES256GCM',
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(ciphertext),
    senderEcdhPubJwk: bundle.ecdhPublicJwk,
    signatureB64: toBase64(signature),
    envelopeType,
  };
}

export async function decryptEnvelope<T = unknown>(
  bundle: LocalKeyBundle,
  envelope: EncryptedEnvelopePayload,
  senderEcdsaPublicJwk?: JsonWebKey,
): Promise<T> {
  const iv = fromBase64(envelope.ivB64);
  const ciphertext = fromBase64(envelope.ciphertextB64);

  if (senderEcdsaPublicJwk && envelope.signatureB64) {
    const verifyKey = await crypto.subtle.importKey(
      'jwk',
      senderEcdsaPublicJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const sigInput = new Uint8Array([...iv, ...ciphertext]);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      fromBase64(envelope.signatureB64) as unknown as BufferSource,
      sigInput,
    );
    if (!valid) {
      throw new Error('Cryptographic signature verification failed');
    }
  }

  const aesKey = await deriveSharedAesKey(bundle.ecdhPrivateJwk, envelope.senderEcdhPubJwk);
  const plaintextBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    aesKey,
    ciphertext as unknown as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintextBuf)) as T;
}

export async function computeSafetyNumber(
  ownEcdsaPublicJwk: JsonWebKey,
  peerEcdsaPublicJwk: JsonWebKey,
): Promise<string> {
  const keys = [JSON.stringify(ownEcdsaPublicJwk), JSON.stringify(peerEcdsaPublicJwk)].sort();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(keys.join('|')),
  );
  const bytes = new Uint8Array(digest);
  let digits = '';
  for (let i = 0; i < 30; i++) {
    const val = ((bytes[i % bytes.length] << 8) | bytes[(i + 1) % bytes.length]) % 100;
    digits += val.toString().padStart(2, '0');
  }
  return digits.match(/.{1,5}/g)?.join(' ') ?? digits;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashPin(pin: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`CHARISMA-PIN:${pin}`));
  return toBase64(digest);
}

async function derivePassphraseAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: KEY_WRAP_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptWithPassphrase(passphrase: string, data: ArrayBuffer): Promise<{
  ivB64: string;
  saltB64: string;
  encryptedDataB64: string;
}> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePassphraseAesKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return {
    ivB64: toBase64(iv),
    saltB64: toBase64(salt),
    encryptedDataB64: toBase64(encrypted),
  };
}

export async function decryptWithPassphrase(
  passphrase: string,
  ivB64: string,
  saltB64: string,
  encryptedDataB64: string,
): Promise<ArrayBuffer> {
  const salt = fromBase64(saltB64);
  const iv = fromBase64(ivB64);
  const encrypted = fromBase64(encryptedDataB64);
  const key = await derivePassphraseAesKey(passphrase, salt);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encrypted as unknown as BufferSource,
  );
}
