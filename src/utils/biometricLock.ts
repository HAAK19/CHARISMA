export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return false;
  } catch {
    return false;
  }
}

function toB64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(b64u: string): Uint8Array {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function registerBiometricLock(username: string): Promise<string> {
  const available = await isBiometricAvailable();
  if (!available) {
    throw new Error('Platform biometric authenticator is not available on this device/browser');
  }
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userIdBytes = new TextEncoder().encode(username.slice(0, 32) || 'charisma_user');
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'CHARISMA Local Vault' },
      user: {
        id: userIdBytes,
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
      },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;

  if (!cred) throw new Error('Biometric registration was cancelled');
  return toB64Url(cred.rawId);
}

export async function verifyBiometricLock(credentialIdB64Url: string): Promise<boolean> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rawId = fromB64Url(credentialIdB64Url);
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        {
          id: rawId as unknown as BufferSource,
          type: 'public-key',
        },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return Boolean(assertion);
}
