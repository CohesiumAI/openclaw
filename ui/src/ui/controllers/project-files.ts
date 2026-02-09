/** IndexedDB wrapper for project file binary storage (base64 dataUrls). */

const DB_NAME = "openclaw-project-files";
const DB_VERSION = 1;
const STORE_NAME = "files";

type StoredFile = {
  projectId: string;
  fileId: string;
  dataUrl: string;
  fileName: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.addEventListener("upgradeneeded", () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: ["projectId", "fileId"] });
        store.createIndex("byProject", "projectId", { unique: false });
      }
    });
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });
}

/** Store a file's binary data (dataUrl) for a project. */
export async function putProjectFile(
  projectId: string,
  fileId: string,
  dataUrl: string,
  fileName: string,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ projectId, fileId, dataUrl, fileName } satisfies StoredFile);
    tx.addEventListener("complete", () => resolve());
    tx.addEventListener("error", () => reject(tx.error));
  });
}

/** Retrieve a single file's data by project + file ID. */
export async function getProjectFile(
  projectId: string,
  fileId: string,
): Promise<{ dataUrl: string; fileName: string } | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get([projectId, fileId]);
    req.addEventListener("success", () => {
      const row = req.result as StoredFile | undefined;
      resolve(row ? { dataUrl: row.dataUrl, fileName: row.fileName } : null);
    });
    req.addEventListener("error", () => reject(req.error));
  });
}

/** Remove specific files by their IDs within a project. */
export async function removeProjectFiles(projectId: string, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) {
    return;
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const fileId of fileIds) {
      store.delete([projectId, fileId]);
    }
    tx.addEventListener("complete", () => resolve());
    tx.addEventListener("error", () => reject(tx.error));
  });
}

type ImportedFile = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sessionKey: string;
  addedAt: number;
};

/**
 * Scan chat messages for file attachments and image content blocks and import
 * them into a project. Handles both _attachments (full data) and image content
 * blocks (base64). Returns metadata entries for the imported files.
 */
export async function importChatFilesIntoProject(
  projectId: string,
  sessionKey: string,
  messages: unknown[],
  existingFileIds: Set<string>,
): Promise<ImportedFile[]> {
  const imported: ImportedFile[] = [];
  // Track IDs we've already imported in this run to avoid duplicates
  const seen = new Set(existingFileIds);
  let imageIdx = 0;
  let fileIdx = 0;

  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    if (m.role !== "user") {
      continue;
    }

    // Priority 1: _attachments — authoritative, carries dataUrl for all types
    if (Array.isArray(m._attachments) && m._attachments.length > 0) {
      for (const att of m._attachments as Array<Record<string, unknown>>) {
        const dataUrl = typeof att.dataUrl === "string" ? att.dataUrl : "";
        if (!dataUrl) {
          continue;
        }
        const mimeType = (att.mimeType as string) || "application/octet-stream";
        const isImage = mimeType.startsWith("image/");
        const idx = isImage ? ++imageIdx : ++fileIdx;
        const prefix = isImage ? "import-img" : "import-file";
        const fileId = `${prefix}-${sessionKey.slice(-8)}-${idx}`;
        if (seen.has(fileId)) {
          continue;
        }
        seen.add(fileId);
        const fileName =
          (att.fileName as string) ||
          (isImage ? `image-${idx}.${mimeType.split("/")[1] || "png"}` : `file-${idx}`);
        const sizeBytes = Math.round((dataUrl.length * 3) / 4);
        imported.push({
          id: fileId,
          fileName,
          mimeType,
          sizeBytes,
          sessionKey,
          addedAt: Date.now(),
        });
        await putProjectFile(projectId, fileId, dataUrl, fileName);
      }
      // _attachments is authoritative — skip content block scan for this message
      continue;
    }

    // Priority 2: content blocks (image with base64 source)
    const content = m.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      const b = block as Record<string, unknown>;
      if (b.type !== "image") {
        continue;
      }
      const source = b.source as Record<string, unknown> | undefined;
      if (!source || typeof source.data !== "string") {
        continue;
      }
      const dataUrl = source.data as string;
      const mimeType = (source.media_type as string) || "image/png";
      imageIdx++;
      const fileName = `image-${imageIdx}.${mimeType.split("/")[1] || "png"}`;
      const fileId = `import-img-${sessionKey.slice(-8)}-${imageIdx}`;
      if (seen.has(fileId)) {
        continue;
      }
      seen.add(fileId);
      const sizeBytes = Math.round((dataUrl.length * 3) / 4);
      imported.push({ id: fileId, fileName, mimeType, sizeBytes, sessionKey, addedAt: Date.now() });
      await putProjectFile(projectId, fileId, dataUrl, fileName);
    }
  }
  return imported;
}

/** Remove all files for an entire project (used when deleting a project). */
export async function removeAllProjectFiles(projectId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const idx = store.index("byProject");
    const cursor = idx.openCursor(IDBKeyRange.only(projectId));
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
}
