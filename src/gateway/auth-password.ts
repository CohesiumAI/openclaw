/**
 * Password hashing and verification using node:crypto scrypt.
 * Produces PHC-format strings: $scrypt$ln=15,r=8,p=1$<salt>$<hash>
 * Upgradeable to Argon2id later without breaking existing hashes.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_COST = 16384; // 2^14 — safe for constrained environments
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 32;

/** Hash a plaintext password into a PHC-format scrypt string. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(plain, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
  });
  const saltB64 = salt.toString("base64url");
  const hashB64 = derived.toString("base64url");
  return `$scrypt$ln=14,r=${SCRYPT_BLOCK_SIZE},p=${SCRYPT_PARALLELISM}$${saltB64}$${hashB64}`;
}

/** Verify a plaintext password against a PHC-format hash string. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parsed = parsePhcHash(stored);
  if (!parsed) {
    return false;
  }
  const derived = await scryptAsync(plain, parsed.salt, parsed.keyLength, {
    N: parsed.cost,
    r: parsed.blockSize,
    p: parsed.parallelism,
  });
  if (derived.length !== parsed.hash.length) {
    return false;
  }
  return timingSafeEqual(derived, parsed.hash);
}

/** Check if a string looks like a PHC-format hash (vs plaintext). */
export function isHashedPassword(value: string): boolean {
  return value.startsWith("$scrypt$") || value.startsWith("$argon2");
}

// --- internals ---

type PhcParams = {
  cost: number;
  blockSize: number;
  parallelism: number;
  salt: Buffer;
  hash: Buffer;
  keyLength: number;
};

function parsePhcHash(phc: string): PhcParams | null {
  // Format: $scrypt$ln=15,r=8,p=1$<salt-b64url>$<hash-b64url>
  const parts = phc.split("$").filter(Boolean);
  if (parts.length !== 4 || parts[0] !== "scrypt") {
    return null;
  }
  const paramStr = parts[1]!;
  const paramMap = new Map<string, string>();
  for (const pair of paramStr.split(",")) {
    const [k, v] = pair.split("=");
    if (k && v) {
      paramMap.set(k, v);
    }
  }
  const ln = Number(paramMap.get("ln"));
  const r = Number(paramMap.get("r"));
  const p = Number(paramMap.get("p"));
  if (!Number.isFinite(ln) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return null;
  }
  try {
    const salt = Buffer.from(parts[2]!, "base64url");
    const hash = Buffer.from(parts[3]!, "base64url");
    return {
      cost: 2 ** ln,
      blockSize: r,
      parallelism: p,
      salt,
      hash,
      keyLength: hash.length,
    };
  } catch {
    return null;
  }
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, derived) => {
      if (err) {
        reject(err);
      } else {
        resolve(derived);
      }
    });
  });
}
