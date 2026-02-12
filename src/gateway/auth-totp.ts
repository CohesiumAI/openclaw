/**
 * TOTP (RFC 6238) implementation using native node:crypto.
 * Provides secret generation, verification with ±1 window, anti-replay,
 * and scrypt-hashed backup codes.
 */

import { createHmac, randomBytes, randomInt } from "node:crypto";
import { hashPassword, verifyPassword } from "./auth-password.js";

// --- Base32 encoding/decoding (RFC 4648) ---

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/[= ]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

// --- TOTP core (RFC 6238 / RFC 4226) ---

const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // ±1 period tolerance

function generateHotp(secret: Buffer, counter: bigint): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function currentCounter(timestampMs?: number): bigint {
  const ts = timestampMs ?? Date.now();
  return BigInt(Math.floor(ts / 1000 / TOTP_PERIOD));
}

// --- Public API ---

/** Generate a 160-bit (20-byte) TOTP secret, returned as base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * Build the otpauth:// URI for QR code generation.
 * @param secret Base32-encoded secret
 * @param username Account name
 * @param issuer Application name
 */
export function buildTotpUri(secret: string, username: string, issuer = "OpenClaw"): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Verify a TOTP code against a secret with ±1 window and anti-replay.
 * @returns The matched code string if valid (for anti-replay tracking), or null.
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastUsedCode?: string,
  timestampMs?: number,
): string | null {
  if (code.length !== TOTP_DIGITS || !/^\d+$/.test(code)) {
    return null;
  }
  // Anti-replay: reject if same code was used in the last verification
  if (lastUsedCode && code === lastUsedCode) {
    return null;
  }
  const secretBuf = base32Decode(secret);
  const counter = currentCounter(timestampMs);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset++) {
    const expected = generateHotp(secretBuf, counter + BigInt(offset));
    if (code === expected) {
      return code;
    }
  }
  return null;
}

/** Generate a current TOTP code for a secret (for testing). */
export function generateCurrentTotp(secret: string, timestampMs?: number): string {
  const secretBuf = base32Decode(secret);
  const counter = currentCounter(timestampMs);
  return generateHotp(secretBuf, counter);
}

// --- Backup codes ---

const BACKUP_CODE_LENGTH = 8;
const BACKUP_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No ambiguous I/O/0/1

/** Generate N backup codes (plaintext). Caller must hash before storing. */
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = "";
    for (let j = 0; j < BACKUP_CODE_LENGTH; j++) {
      code += BACKUP_CODE_CHARS[randomInt(BACKUP_CODE_CHARS.length)];
    }
    codes.push(code);
  }
  return codes;
}

/** Hash all backup codes with scrypt (same scheme as passwords). */
export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => hashPassword(code)));
}

/**
 * Verify a backup code against an array of hashes.
 * Returns the index of the matched hash, or -1 if none match.
 */
export async function verifyBackupCode(code: string, hashes: string[]): Promise<number> {
  // Check all hashes to prevent timing oracle on array position
  const results = await Promise.all(hashes.map((hash) => verifyPassword(code.toUpperCase(), hash)));
  return results.indexOf(true);
}
