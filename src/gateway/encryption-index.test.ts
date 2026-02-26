import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadEncryptionIndex,
  saveEncryptionIndex,
  markPendingEncryption,
  markEncrypted,
  getPendingEncryptionEntries,
  getEncryptedEntries,
  removeEncryptionEntry,
  resolveEncryptionIndexPath,
} from "./encryption-index.js";

describe("encryption-index", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "enc-idx-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty index when no file exists", () => {
    const index = loadEncryptionIndex(tmpDir);
    expect(index.version).toBe(1);
    expect(index.entries).toEqual({});
  });

  it("saves and loads an index", () => {
    const index = {
      version: 1 as const,
      entries: {
        "session-abc.jsonl.reset.123": {
          filename: "session-abc.jsonl.reset.123",
          ownerId: "alice",
          state: "plaintext" as const,
        },
      },
    };
    saveEncryptionIndex(tmpDir, index);
    const loaded = loadEncryptionIndex(tmpDir);
    expect(loaded).toEqual(index);
  });

  it("marks a file as pending encryption", () => {
    markPendingEncryption(tmpDir, "session-abc.jsonl.reset.123", "alice");
    const index = loadEncryptionIndex(tmpDir);
    const entry = index.entries["session-abc.jsonl.reset.123"];
    expect(entry).toBeDefined();
    expect(entry!.state).toBe("pendingEncryption");
    expect(entry!.ownerId).toBe("alice");
  });

  it("marks a file as encrypted", () => {
    markPendingEncryption(tmpDir, "session-abc.jsonl.reset.123", "alice");
    markEncrypted(tmpDir, "session-abc.jsonl.reset.123");
    const index = loadEncryptionIndex(tmpDir);
    const entry = index.entries["session-abc.jsonl.reset.123"];
    expect(entry!.state).toBe("encrypted");
    expect(entry!.encryptedAt).toBeTypeOf("number");
  });

  it("getPendingEncryptionEntries filters by ownerId", () => {
    markPendingEncryption(tmpDir, "file1", "alice");
    markPendingEncryption(tmpDir, "file2", "bob");
    markPendingEncryption(tmpDir, "file3", "alice");

    const alicePending = getPendingEncryptionEntries(tmpDir, "alice");
    expect(alicePending).toHaveLength(2);
    expect(alicePending.map((e) => e.filename).sort()).toEqual(["file1", "file3"]);

    const bobPending = getPendingEncryptionEntries(tmpDir, "bob");
    expect(bobPending).toHaveLength(1);
  });

  it("getEncryptedEntries filters by ownerId and state", () => {
    markPendingEncryption(tmpDir, "file1", "alice");
    markPendingEncryption(tmpDir, "file2", "alice");
    markEncrypted(tmpDir, "file1");

    const encrypted = getEncryptedEntries(tmpDir, "alice");
    expect(encrypted).toHaveLength(1);
    expect(encrypted[0]!.filename).toBe("file1");
  });

  it("removes an entry from the index", () => {
    markPendingEncryption(tmpDir, "file1", "alice");
    markPendingEncryption(tmpDir, "file2", "alice");
    removeEncryptionEntry(tmpDir, "file1");

    const index = loadEncryptionIndex(tmpDir);
    expect(Object.keys(index.entries)).toEqual(["file2"]);
  });

  it("resolves the index path correctly", () => {
    const p = resolveEncryptionIndexPath(tmpDir);
    expect(p).toBe(path.join(tmpDir, "encryption-index.json"));
  });

  it("handles corrupted JSON gracefully", () => {
    const indexPath = resolveEncryptionIndexPath(tmpDir);
    fs.writeFileSync(indexPath, "not valid json!!!", "utf-8");
    const index = loadEncryptionIndex(tmpDir);
    expect(index.version).toBe(1);
    expect(index.entries).toEqual({});
  });

  it("handles invalid version gracefully", () => {
    const indexPath = resolveEncryptionIndexPath(tmpDir);
    fs.writeFileSync(indexPath, JSON.stringify({ version: 999, entries: {} }), "utf-8");
    const index = loadEncryptionIndex(tmpDir);
    expect(index.version).toBe(1);
    expect(index.entries).toEqual({});
  });
});
