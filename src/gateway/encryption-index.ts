/**
 * Encryption index for E2E session transcript encryption.
 * Tracks the encryption state of archived session transcripts per agent.
 * Stored at ~/.openclaw/agents/<agentId>/sessions/encryption-index.json
 */

import fs from "node:fs";
import path from "node:path";

export type EncryptionState = "plaintext" | "encrypted" | "pendingEncryption";

export type EncryptionIndexEntry = {
  /** Filename of the archived transcript (e.g. "session-abc.jsonl.reset.1234"). */
  filename: string;
  /** Username of the session owner. */
  ownerId: string;
  /** Current encryption state. */
  state: EncryptionState;
  /** Timestamp when the file was encrypted (set when state = "encrypted"). */
  encryptedAt?: number;
};

export type EncryptionIndex = {
  version: 1;
  entries: Record<string, EncryptionIndexEntry>;
};

const INDEX_FILENAME = "encryption-index.json";

/** Resolve the encryption index path for a given sessions directory. */
export function resolveEncryptionIndexPath(sessionsDir: string): string {
  return path.join(sessionsDir, INDEX_FILENAME);
}

/** Load the encryption index from disk. Returns empty index if not found or invalid. */
export function loadEncryptionIndex(sessionsDir: string): EncryptionIndex {
  const indexPath = resolveEncryptionIndexPath(sessionsDir);
  try {
    if (!fs.existsSync(indexPath)) {
      return { version: 1, entries: {} };
    }
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    if (raw && typeof raw === "object" && raw.version === 1 && raw.entries) {
      return raw as EncryptionIndex;
    }
  } catch {
    // Corrupted or missing — return empty
  }
  return { version: 1, entries: {} };
}

/** Save the encryption index to disk. */
export function saveEncryptionIndex(sessionsDir: string, index: EncryptionIndex): void {
  const indexPath = resolveEncryptionIndexPath(sessionsDir);
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
}

/** Mark an archived file as pending encryption. */
export function markPendingEncryption(
  sessionsDir: string,
  filename: string,
  ownerId: string,
): void {
  const index = loadEncryptionIndex(sessionsDir);
  index.entries[filename] = {
    filename,
    ownerId,
    state: "pendingEncryption",
  };
  saveEncryptionIndex(sessionsDir, index);
}

/** Mark an archived file as encrypted. */
export function markEncrypted(sessionsDir: string, filename: string): void {
  const index = loadEncryptionIndex(sessionsDir);
  const entry = index.entries[filename];
  if (entry) {
    entry.state = "encrypted";
    entry.encryptedAt = Date.now();
    saveEncryptionIndex(sessionsDir, index);
  }
}

/** Get all pending encryption entries for a given owner. */
export function getPendingEncryptionEntries(
  sessionsDir: string,
  ownerId: string,
): EncryptionIndexEntry[] {
  const index = loadEncryptionIndex(sessionsDir);
  return Object.values(index.entries).filter(
    (e) => e.state === "pendingEncryption" && e.ownerId === ownerId,
  );
}

/** Get all encrypted entries for a given owner. */
export function getEncryptedEntries(
  sessionsDir: string,
  ownerId: string,
): EncryptionIndexEntry[] {
  const index = loadEncryptionIndex(sessionsDir);
  return Object.values(index.entries).filter(
    (e) => e.state === "encrypted" && e.ownerId === ownerId,
  );
}

/** Remove an entry from the index. */
export function removeEncryptionEntry(sessionsDir: string, filename: string): void {
  const index = loadEncryptionIndex(sessionsDir);
  delete index.entries[filename];
  saveEncryptionIndex(sessionsDir, index);
}
