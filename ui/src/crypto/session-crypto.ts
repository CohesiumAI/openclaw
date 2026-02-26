/**
 * Client-side E2E encryption for archived session transcripts.
 * Uses WebCrypto API: PBKDF2 → AES-256-GCM.
 *
 * The CryptoKey is derived once at login and kept in memory (non-extractable).
 * Lost on logout or tab close — re-derived on next login.
 *
 * Blob format: [IV 12 bytes][ciphertext+authTag]
 * AES-GCM automatically appends the 16-byte auth tag to the ciphertext.
 */

const PBKDF2_ITERATIONS = 310_000;
const IV_LENGTH = 12;

/** Convert hex string to Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Derive an AES-256-GCM CryptoKey from a password and hex-encoded salt.
 * The key is non-extractable — it can only be used for encrypt/decrypt operations.
 */
export async function deriveEncryptionKey(
  password: string,
  saltHex: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: hexToBytes(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext transcript string into a binary blob.
 * Returns an ArrayBuffer: [IV 12 bytes][ciphertext + authTag].
 */
export async function encryptTranscript(
  key: CryptoKey,
  plaintext: string,
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );

  // Concatenate: [IV][ciphertext+authTag]
  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_LENGTH);
  return result.buffer;
}

/**
 * Decrypt a binary blob back to plaintext.
 * Input: ArrayBuffer with format [IV 12 bytes][ciphertext + authTag].
 */
export async function decryptTranscript(
  key: CryptoKey,
  blob: ArrayBuffer,
): Promise<string> {
  const data = new Uint8Array(blob);
  if (data.length < IV_LENGTH + 1) {
    throw new Error("Encrypted blob too small");
  }

  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}

/**
 * Convert an ArrayBuffer to a base64 string (for WS transport).
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Convert a base64 string to an ArrayBuffer (from WS transport).
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
