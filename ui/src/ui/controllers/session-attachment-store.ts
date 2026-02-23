/**
 * Per-session attachment store (IndexedDB).
 *
 * Persists attachment metadata + binary data every time a user sends files
 * in ANY chat session (regardless of project membership).
 * When a chat is later added to a project the stored attachments can be
 * retrieved and imported into the project file store.
 */

const DB_NAME = "openclaw-session-attachments";
const DB_VERSION = 1;
const STORE_NAME = "attachments";

export type StoredSessionAttachment = {
  /** Composite key part 1 */
  sessionKey: string;
  /** Unique attachment id within the session */
  id: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  addedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.addEventListener("upgradeneeded", () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: ["sessionKey", "id"],
        });
        store.createIndex("bySession", "sessionKey", { unique: false });
      }
    });
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });
}

/**
 * Persist attachments for a chat session.
 * Idempotent — existing entries with the same (sessionKey, id) are overwritten.
 */
export async function storeSessionAttachments(
  sessionKey: string,
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    dataUrl: string;
  }>,
): Promise<void> {
  if (attachments.length === 0) {
    return;
  }
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const now = Date.now();
    for (const att of attachments) {
      store.put({
        sessionKey,
        id: att.id,
        fileName: att.fileName,
        mimeType: att.mimeType,
        dataUrl: att.dataUrl,
        addedAt: now,
      } satisfies StoredSessionAttachment);
    }
    await new Promise<void>((resolve, reject) => {
      tx.addEventListener("complete", () => resolve());
      tx.addEventListener("error", () => reject(tx.error));
    });
  } catch {
    // Best-effort — IndexedDB may be unavailable in private browsing
  }
}

/** Retrieve all stored attachments for a given session key. */
export async function getSessionAttachments(
  sessionKey: string,
): Promise<StoredSessionAttachment[]> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const idx = tx.objectStore(STORE_NAME).index("bySession");
      const req = idx.getAll(IDBKeyRange.only(sessionKey));
      req.addEventListener("success", () => {
        resolve((req.result ?? []) as StoredSessionAttachment[]);
      });
      req.addEventListener("error", () => reject(req.error));
    });
  } catch {
    return [];
  }
}

/** Remove all stored attachments for a session (cleanup on chat deletion). */
export async function removeSessionAttachments(sessionKey: string): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const idx = store.index("bySession");
      const cursor = idx.openCursor(IDBKeyRange.only(sessionKey));
      cursor.addEventListener("success", () => {
        const c = cursor.result;
        if (!c) {
          return;
        }
        c.delete();
        c.continue();
      });
      tx.addEventListener("complete", () => resolve());
      tx.addEventListener("error", () => reject(tx.error));
    });
  } catch {
    // Best-effort
  }
}
