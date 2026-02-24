/**
 * Per-session chat attachment store.
 * Files:    ~/.openclaw/session-attachments/<sessionId>/<fileId>   (dataUrl as UTF-8)
 * Metadata: ~/.openclaw/session-attachments/<sessionId>/meta.json
 *
 * Session IDs and file IDs are always validated server-side.
 * No user-supplied paths are trusted.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";

const ATTACHMENTS_DIR = "session-attachments";
const META_FILENAME = "meta.json";

// Strict ID format: UUID or alphanumeric + dash/underscore, 1–64 chars
const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

// Max file size: 25 MB base64 ≈ ~34 MB encoded
const MAX_FILE_DATA_LENGTH = 35_000_000;

// Resource limits per session (DoS prevention)
const MAX_FILES_PER_SESSION = 200;

export type SessionAttachmentMeta = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  addedAt: number;
};

type MetaFile = {
  version: 1;
  files: SessionAttachmentMeta[];
};

function isSafeId(id: string): boolean {
  return SAFE_ID_RE.test(id);
}

function resolveSessionDir(sessionId: string, stateDir?: string): string {
  const dir = stateDir ?? resolveStateDir();
  return path.join(dir, ATTACHMENTS_DIR, sessionId);
}

function resolveMetaPath(sessionId: string, stateDir?: string): string {
  return path.join(resolveSessionDir(sessionId, stateDir), META_FILENAME);
}

function resolveFilePath(sessionId: string, fileId: string, stateDir?: string): string {
  return path.join(resolveSessionDir(sessionId, stateDir), fileId);
}

function loadMetaFile(sessionId: string, stateDir?: string): MetaFile {
  const filePath = resolveMetaPath(sessionId, stateDir);
  const raw = loadJsonFile(filePath);
  if (
    raw &&
    typeof raw === "object" &&
    (raw as Record<string, unknown>).version === 1 &&
    Array.isArray((raw as Record<string, unknown>).files)
  ) {
    return raw as MetaFile;
  }
  return { version: 1, files: [] };
}

function saveMetaFile(sessionId: string, data: MetaFile, stateDir?: string): void {
  const dir = resolveSessionDir(sessionId, stateDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const filePath = resolveMetaPath(sessionId, stateDir);
  saveJsonFile(filePath, data);
}

// --- CRUD operations ---

/**
 * Store an attachment for a session.
 * Idempotent — existing entries with the same fileId are overwritten.
 */
export function putSessionAttachment(
  sessionId: string,
  file: {
    fileId: string;
    fileName: string;
    dataUrl: string;
    mimeType?: string;
  },
  stateDir?: string,
): SessionAttachmentMeta | null {
  if (!isSafeId(sessionId) || !isSafeId(file.fileId)) {
    return null;
  }
  if (file.dataUrl.length > MAX_FILE_DATA_LENGTH) {
    return null;
  }
  const data = loadMetaFile(sessionId, stateDir);
  // Enforce file count limit (re-put of existing file is always allowed)
  const isNewFile = !data.files.some((f) => f.id === file.fileId);
  if (isNewFile && data.files.length >= MAX_FILES_PER_SESSION) {
    return null;
  }
  // Write binary to disk
  const filePath = resolveFilePath(sessionId, file.fileId, stateDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(filePath, file.dataUrl, "utf8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows may not support chmod
  }
  // Update metadata
  const sizeBytes = Math.round((file.dataUrl.length * 3) / 4);
  const meta: SessionAttachmentMeta = {
    id: file.fileId,
    fileName: file.fileName.slice(0, 255),
    mimeType: (file.mimeType ?? "application/octet-stream").slice(0, 100),
    sizeBytes,
    addedAt: Date.now(),
  };
  const existingIdx = data.files.findIndex((f) => f.id === file.fileId);
  if (existingIdx >= 0) {
    data.files[existingIdx] = meta;
  } else {
    data.files.push(meta);
  }
  saveMetaFile(sessionId, data, stateDir);
  return meta;
}

/** List all attachment metadata for a session. */
export function listSessionAttachments(
  sessionId: string,
  stateDir?: string,
): SessionAttachmentMeta[] {
  if (!isSafeId(sessionId)) {
    return [];
  }
  return loadMetaFile(sessionId, stateDir).files;
}

/** Retrieve a single attachment's dataUrl. */
export function getSessionAttachment(
  sessionId: string,
  fileId: string,
  stateDir?: string,
): { dataUrl: string; fileName: string; mimeType: string } | null {
  if (!isSafeId(sessionId) || !isSafeId(fileId)) {
    return null;
  }
  const data = loadMetaFile(sessionId, stateDir);
  const fileMeta = data.files.find((f) => f.id === fileId);
  if (!fileMeta) {
    return null;
  }
  const filePath = resolveFilePath(sessionId, fileId, stateDir);
  try {
    const dataUrl = fs.readFileSync(filePath, "utf8");
    return { dataUrl, fileName: fileMeta.fileName, mimeType: fileMeta.mimeType };
  } catch {
    return null;
  }
}

/** Remove specific attachments by IDs. */
export function removeSessionAttachments(
  sessionId: string,
  fileIds: string[],
  stateDir?: string,
): number {
  if (!isSafeId(sessionId)) {
    return 0;
  }
  const data = loadMetaFile(sessionId, stateDir);
  let removed = 0;
  const toRemove = new Set(fileIds.filter(isSafeId));
  for (const fileId of toRemove) {
    const idx = data.files.findIndex((f) => f.id === fileId);
    if (idx >= 0) {
      data.files.splice(idx, 1);
      removed++;
    }
    const filePath = resolveFilePath(sessionId, fileId, stateDir);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // best-effort
    }
  }
  if (removed > 0) {
    saveMetaFile(sessionId, data, stateDir);
  }
  return removed;
}

/** Remove all attachments for a session (e.g., on chat deletion). */
export function removeAllSessionAttachments(sessionId: string, stateDir?: string): void {
  if (!isSafeId(sessionId)) {
    return;
  }
  const sessionDir = resolveSessionDir(sessionId, stateDir);
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
