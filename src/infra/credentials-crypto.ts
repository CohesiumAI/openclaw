/**
 * Encrypt/decrypt gateway credentials file at rest.
 * Uses AES-256-GCM with a scrypt-derived key from a user-supplied password.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

type EncryptedPayload = {
  version: 1;
  encrypted: true;
  salt: string;
  iv: string;
  authTag: string;
  data: string;
};

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

/** Encrypt plaintext JSON string with a password. Returns JSON string of EncryptedPayload. */
export function encryptCredentials(plaintext: string, password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    version: 1,
    encrypted: true,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    data: encrypted.toString("base64"),
  };
  return JSON.stringify(payload, null, 2);
}

/** Decrypt an EncryptedPayload JSON string with a password. Returns plaintext JSON string. */
export function decryptCredentials(ciphertext: string, password: string): string {
  const payload = JSON.parse(ciphertext) as EncryptedPayload;
  if (payload.version !== 1 || payload.encrypted !== true) {
    throw new Error("Not an encrypted credentials file");
  }

  const salt = Buffer.from(payload.salt, "hex");
  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const data = Buffer.from(payload.data, "base64");
  const key = deriveKey(password, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Check if a raw JSON string looks like an encrypted credentials file. */
export function isEncryptedCredentials(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed.version === 1 && parsed.encrypted === true;
  } catch {
    return false;
  }
}
