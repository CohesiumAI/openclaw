/**
 * Encrypted session persistence for gateway auth sessions.
 * Persists the in-memory session Map to ~/.openclaw/sessions/auth-sessions.enc
 * using AES-256-GCM with a machine-generated key. Survives gateway restarts.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AuthSession } from "./auth-sessions.js";

const ALGORITHM = "aes-256-gcm" as const;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SESSIONS_DIR = "sessions";
const SESSIONS_FILENAME = "auth-sessions.enc";
const KEY_DIR = "credentials";
const KEY_FILENAME = "session-encryption-key";
const DEBOUNCE_MS = 2000;

let persistTimer: ReturnType<typeof setTimeout> | null = null;

// --- Machine key management ---

function resolveKeyPath(stateDir: string): string {
  return path.join(stateDir, KEY_DIR, KEY_FILENAME);
}

function resolveSessionsPath(stateDir: string): string {
  return path.join(stateDir, SESSIONS_DIR, SESSIONS_FILENAME);
}

const KEY_AGE_WARN_DAYS = 365;

/** Load or generate a 32-byte machine encryption key. */
export function generateOrLoadSessionKey(
  stateDir: string,
  log?: { warn?: (msg: string) => void },
): Buffer {
  const keyPath = resolveKeyPath(stateDir);
  try {
    if (fs.existsSync(keyPath)) {
      const hex = fs.readFileSync(keyPath, "utf8").trim();
      const buf = Buffer.from(hex, "hex");
      if (buf.length === KEY_LENGTH) {
        // P3b: warn if key is older than 365 days
        try {
          const stat = fs.statSync(keyPath);
          const ageDays = Math.floor((Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24));
          if (ageDays > KEY_AGE_WARN_DAYS) {
            log?.warn?.(
              `Session encryption key is ${ageDays} days old. Consider rotating: openclaw credentials rotate`,
            );
          }
        } catch {
          // stat failure is non-fatal
        }
        return buf;
      }
    }
  } catch {
    // Corrupt or unreadable — regenerate
  }
  const key = randomBytes(KEY_LENGTH);
  const dir = path.dirname(keyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(keyPath, key.toString("hex") + "\n", { mode: 0o600 });
  return key;
}

// --- Encrypt / Decrypt ---

function encrypt(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: [iv (12)] [authTag (16)] [ciphertext (...)]
  return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(data: Buffer, key: Buffer): string {
  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("encrypted data too short");
  }
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// --- Persist / Load ---

type PersistedStore = {
  v: 1;
  sessions: Array<AuthSession>;
};

/** Write sessions to encrypted file. */
export function persistSessions(
  sessions: Map<string, AuthSession>,
  key: Buffer,
  stateDir: string,
): void {
  const now = Date.now();
  // Only persist non-expired sessions
  const live = Array.from(sessions.values()).filter((s) => s.expiresAt > now);
  const payload: PersistedStore = { v: 1, sessions: live };
  const json = JSON.stringify(payload);
  const encrypted = encrypt(json, key);

  const filePath = resolveSessionsPath(stateDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
}

/** Load sessions from encrypted file. Returns empty Map on any failure (fail-open). */
export function loadPersistedSessions(key: Buffer, stateDir: string): Map<string, AuthSession> {
  const filePath = resolveSessionsPath(stateDir);
  const result = new Map<string, AuthSession>();
  try {
    if (!fs.existsSync(filePath)) {
      return result;
    }
    const raw = fs.readFileSync(filePath);
    const json = decrypt(raw, key);
    const parsed = JSON.parse(json) as PersistedStore;
    if (parsed.v !== 1 || !Array.isArray(parsed.sessions)) {
      return result;
    }
    const now = Date.now();
    for (const s of parsed.sessions) {
      // Skip expired sessions
      if (s.expiresAt > now && s.id && s.username) {
        result.set(s.id, s);
      }
    }
  } catch {
    // Corrupt, wrong key, or missing — start fresh (fail-open)
  }
  return result;
}

// --- Debounced persistence ---

/** Schedule a debounced persist (coalesces rapid mutations). */
export function schedulePersist(
  sessions: Map<string, AuthSession>,
  key: Buffer,
  stateDir: string,
): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      persistSessions(sessions, key, stateDir);
    } catch {
      // Non-fatal — next mutation will retry
    }
  }, DEBOUNCE_MS);
  // Don't keep the process alive for persistence
  if (typeof persistTimer === "object" && "unref" in persistTimer) {
    persistTimer.unref();
  }
}

/** Synchronous flush for shutdown — cancels pending debounce and writes immediately. */
export function flushSessions(
  sessions: Map<string, AuthSession>,
  key: Buffer,
  stateDir: string,
): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    persistSessions(sessions, key, stateDir);
  } catch {
    // Best-effort on shutdown
  }
}

/** Cancel pending persist timer (for tests). */
export function cancelPersistTimer(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
