/**
 * In-memory HTTP session store for gateway authentication.
 * Sessions are short-lived (30 min default) with sliding-window refresh.
 * Persisted to disk (AES-256-GCM encrypted) to survive gateway restarts.
 */

import { randomBytes } from "node:crypto";
import type { GatewayUserRole } from "../infra/auth-credentials.js";
import { resolveStateDir } from "../config/paths.js";
import {
  cancelPersistTimer,
  flushSessions,
  generateOrLoadSessionKey,
  loadPersistedSessions,
  schedulePersist,
} from "./session-persistence.js";

export type AuthSession = {
  id: string;
  username: string;
  role: GatewayUserRole;
  scopes: string[];
  createdAt: number;
  expiresAt: number;
  lastActivityAt: number;
  /** CSRF token bound to this session. */
  csrfToken: string;
  /** If true, session is a partial 2FA challenge — no WS/API access until TOTP verified. */
  pendingTotpChallenge?: boolean;
};

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_ID_BYTES = 32;
const CSRF_TOKEN_BYTES = 32;

/** Map role names to gateway scopes. */
export function rolesToScopes(role: GatewayUserRole): string[] {
  switch (role) {
    case "admin":
      return ["operator.admin", "operator.approvals", "operator.pairing"];
    case "operator":
      return ["operator.read", "operator.write", "operator.approvals"];
    case "read-only":
      return ["operator.read"];
    default:
      return [];
  }
}

const sessions = new Map<string, AuthSession>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// --- Persistence state ---
let sessionKey: Buffer | null = null;
let stateDir: string | null = null;

function getPersistenceCtx(): { key: Buffer; dir: string } | null {
  if (sessionKey && stateDir) {
    return { key: sessionKey, dir: stateDir };
  }
  return null;
}

function triggerPersist(): void {
  const ctx = getPersistenceCtx();
  if (ctx) {
    schedulePersist(sessions, ctx.key, ctx.dir);
  }
}

/** Initialize persistence: load sessions from encrypted disk store. */
export function initSessionPersistence(dir?: string): void {
  stateDir = dir ?? resolveStateDir();
  sessionKey = generateOrLoadSessionKey(stateDir);
  const restored = loadPersistedSessions(sessionKey, stateDir);
  for (const [id, session] of restored) {
    sessions.set(id, session);
  }
  if (sessions.size > 0) {
    ensureCleanupRunning();
  }
}

/** Flush sessions to disk synchronously (call on shutdown). */
export function flushSessionsToDisk(): void {
  const ctx = getPersistenceCtx();
  if (ctx) {
    flushSessions(sessions, ctx.key, ctx.dir);
  }
}

function generateSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString("base64url");
}

function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
}

/** Create a new session. */
export function createAuthSession(params: {
  username: string;
  role: GatewayUserRole;
}): AuthSession {
  const now = Date.now();
  const session: AuthSession = {
    id: generateSessionId(),
    username: params.username,
    role: params.role,
    scopes: rolesToScopes(params.role),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastActivityAt: now,
    csrfToken: generateCsrfToken(),
  };
  sessions.set(session.id, session);
  ensureCleanupRunning();
  triggerPersist();
  return session;
}

/** Get a session by ID, returns null if expired, not found, or pending TOTP challenge. */
export function getAuthSession(sessionId: string): AuthSession | null {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  // Partial 2FA sessions are not valid for normal access
  if (session.pendingTotpChallenge) {
    return null;
  }
  return session;
}

/** Get a pending TOTP challenge session (for 2FA verification only). */
export function getPendingTotpSession(sessionId: string): AuthSession | null {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  if (!session.pendingTotpChallenge) {
    return null;
  }
  return session;
}

/** Promote a pending TOTP session to a full session. */
export function promoteTotpSession(sessionId: string): AuthSession | null {
  const session = sessions.get(sessionId);
  if (!session || !session.pendingTotpChallenge) {
    return null;
  }
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  session.pendingTotpChallenge = undefined;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  session.lastActivityAt = Date.now();
  triggerPersist();
  return session;
}

/** Refresh a session (sliding window). Returns the updated session or null. */
export function refreshAuthSession(sessionId: string): AuthSession | null {
  const session = getAuthSession(sessionId);
  if (!session) {
    return null;
  }
  const now = Date.now();
  session.expiresAt = now + SESSION_TTL_MS;
  session.lastActivityAt = now;
  triggerPersist();
  return session;
}

/** Delete a specific session. */
export function deleteAuthSession(sessionId: string): boolean {
  const deleted = sessions.delete(sessionId);
  if (deleted) {
    triggerPersist();
  }
  return deleted;
}

/** Delete all sessions for a given username. */
export function deleteUserSessions(username: string): number {
  const normalized = username.trim().toLowerCase();
  let count = 0;
  for (const [id, session] of sessions) {
    if (session.username.toLowerCase() === normalized) {
      sessions.delete(id);
      count++;
    }
  }
  if (count > 0) {
    triggerPersist();
  }
  return count;
}

/** Delete all sessions. */
export function deleteAllAuthSessions(): void {
  sessions.clear();
  triggerPersist();
}

/** List all session IDs for a user (for WS revocation). */
export function listUserSessionIds(username: string): string[] {
  const normalized = username.trim().toLowerCase();
  const ids: string[] = [];
  for (const [id, session] of sessions) {
    if (session.username.toLowerCase() === normalized && Date.now() <= session.expiresAt) {
      ids.push(id);
    }
  }
  return ids;
}

/** Get current session count (for monitoring). */
export function getSessionCount(): number {
  return sessions.size;
}

// --- Cleanup ---

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(id);
    }
  }
  if (sessions.size === 0 && cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

function ensureCleanupRunning(): void {
  if (cleanupTimer) {
    return;
  }
  cleanupTimer = setInterval(purgeExpired, CLEANUP_INTERVAL_MS);
  // Don't keep the process alive just for cleanup
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/** Stop cleanup timer (for tests). */
export function stopSessionCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/** Reset all state (for tests). */
export function resetSessionStoreForTest(): void {
  sessions.clear();
  stopSessionCleanup();
  cancelPersistTimer();
  sessionKey = null;
  stateDir = null;
}
