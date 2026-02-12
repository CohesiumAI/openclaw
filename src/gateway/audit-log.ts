/**
 * Security audit logger — structured JSON Lines to ~/.openclaw/logs/audit.jsonl.
 * Covers all auth modes (token, password, tailscale, device-token).
 * Buffer: flush every 1s or 100 entries. Sync flush on shutdown. Fail-safe: never blocks auth flow.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const LOGS_DIR = "logs";
const AUDIT_FILENAME = "audit.jsonl";
const FLUSH_INTERVAL_MS = 1000;
const FLUSH_THRESHOLD = 100;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB rotation trigger
const DEFAULT_RETENTION = 10;

export type AuditEvent = {
  ts: string;
  event: string;
  actor: string;
  ip: string;
  details: Record<string, unknown>;
};

// --- Singleton state ---

let buffer: string[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let auditFilePath: string | null = null;
let initialized = false;
let retentionFiles = DEFAULT_RETENTION;

/** Resolve the path to audit.jsonl for a given stateDir. Exported for CLI audit commands. */
export function resolveAuditPath(stateDir: string): string {
  return path.join(stateDir, LOGS_DIR, AUDIT_FILENAME);
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

// --- Rotation ---

function rotateIfNeeded(): void {
  if (!auditFilePath) {
    return;
  }
  try {
    const stat = fs.statSync(auditFilePath);
    if (stat.size < MAX_FILE_SIZE) {
      return;
    }
  } catch {
    return;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rotatedName = `audit-${ts}.jsonl`;
  const rotatedPath = path.join(path.dirname(auditFilePath), rotatedName);
  try {
    fs.renameSync(auditFilePath, rotatedPath);
  } catch {
    // Best effort
  }
  pruneOldFiles();
}

function pruneOldFiles(): void {
  if (!auditFilePath) {
    return;
  }
  const dir = path.dirname(auditFilePath);
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"))
      .toSorted()
      .toReversed();
    for (const file of files.slice(retentionFiles)) {
      try {
        fs.unlinkSync(path.join(dir, file));
      } catch {
        // best effort
      }
    }
  } catch {
    // best effort
  }
}

// --- Core ---

function flushBuffer(): void {
  if (buffer.length === 0 || !auditFilePath) {
    return;
  }
  const lines = buffer.join("");
  buffer = [];
  try {
    rotateIfNeeded();
    fs.appendFileSync(auditFilePath, lines, { mode: 0o600 });
  } catch {
    // Fail-safe: never crash the gateway because of audit I/O
  }
}

/** Initialize the audit log system. Call once at gateway startup. */
export function initAuditLog(opts?: { stateDir?: string; retention?: number }): void {
  const stateDir = opts?.stateDir ?? resolveStateDir();
  retentionFiles = opts?.retention ?? DEFAULT_RETENTION;
  auditFilePath = resolveAuditPath(stateDir);
  ensureDir(auditFilePath);
  initialized = true;
  if (!flushTimer) {
    flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
    if (typeof flushTimer === "object" && "unref" in flushTimer) {
      flushTimer.unref();
    }
  }
}

/** Write a structured audit event. No-op if not initialized. */
export function audit(
  event: string,
  actor: string,
  ip: string,
  details: Record<string, unknown> = {},
): void {
  if (!initialized) {
    return;
  }
  const entry: AuditEvent = {
    ts: new Date().toISOString(),
    event,
    actor,
    ip,
    details,
  };
  buffer.push(JSON.stringify(entry) + "\n");
  if (buffer.length >= FLUSH_THRESHOLD) {
    flushBuffer();
  }
}

/** Synchronous flush for shutdown — writes all buffered entries immediately. */
export function flushAuditLog(): void {
  flushBuffer();
}

/** Shutdown: flush and stop timer. */
export function shutdownAuditLog(): void {
  flushBuffer();
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  initialized = false;
}

/** Reset all state (for tests). */
export function resetAuditLogForTest(): void {
  shutdownAuditLog();
  buffer = [];
  auditFilePath = null;
  retentionFiles = DEFAULT_RETENTION;
}

/** Get the current audit file path (for CLI tools). */
export function getAuditFilePath(): string | null {
  return auditFilePath;
}
