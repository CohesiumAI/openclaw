import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthSession } from "./auth-sessions.js";
import {
  cancelPersistTimer,
  flushSessions,
  generateOrLoadSessionKey,
  loadPersistedSessions,
  persistSessions,
} from "./session-persistence.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-session-test-"));
}

function makeSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    id: `sid-${Math.random().toString(36).slice(2)}`,
    username: "testuser",
    role: "admin",
    scopes: ["operator.admin"],
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 60 * 1000,
    lastActivityAt: Date.now(),
    csrfToken: `csrf-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

describe("session-persistence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cancelPersistTimer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateOrLoadSessionKey creates and reloads a consistent key", () => {
    const key1 = generateOrLoadSessionKey(tmpDir);
    expect(key1).toBeInstanceOf(Buffer);
    expect(key1.length).toBe(32);

    const key2 = generateOrLoadSessionKey(tmpDir);
    expect(key2.equals(key1)).toBe(true);
  });

  it("generateOrLoadSessionKey regenerates on corrupt key file", () => {
    const key1 = generateOrLoadSessionKey(tmpDir);
    // Corrupt the key file
    const keyPath = path.join(tmpDir, "credentials", "session-encryption-key");
    fs.writeFileSync(keyPath, "not-hex\n");
    const key2 = generateOrLoadSessionKey(tmpDir);
    expect(key2.length).toBe(32);
    expect(key2.equals(key1)).toBe(false);
  });

  it("round-trip: persist then load restores sessions", () => {
    const key = generateOrLoadSessionKey(tmpDir);
    const sessions = new Map<string, AuthSession>();
    const s1 = makeSession({ username: "alice" });
    const s2 = makeSession({ username: "bob" });
    sessions.set(s1.id, s1);
    sessions.set(s2.id, s2);

    persistSessions(sessions, key, tmpDir);

    const restored = loadPersistedSessions(key, tmpDir);
    expect(restored.size).toBe(2);
    expect(restored.get(s1.id)?.username).toBe("alice");
    expect(restored.get(s2.id)?.username).toBe("bob");
    expect(restored.get(s1.id)?.csrfToken).toBe(s1.csrfToken);
  });

  it("expired sessions are not restored", () => {
    const key = generateOrLoadSessionKey(tmpDir);
    const sessions = new Map<string, AuthSession>();
    const live = makeSession({ username: "live" });
    const expired = makeSession({ username: "expired", expiresAt: Date.now() - 1000 });
    sessions.set(live.id, live);
    sessions.set(expired.id, expired);

    persistSessions(sessions, key, tmpDir);

    const restored = loadPersistedSessions(key, tmpDir);
    expect(restored.size).toBe(1);
    expect(restored.get(live.id)?.username).toBe("live");
    expect(restored.has(expired.id)).toBe(false);
  });

  it("corrupt file returns empty map (fail-open)", () => {
    const key = generateOrLoadSessionKey(tmpDir);
    const sessionsDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, "auth-sessions.enc"), "garbage-data");

    const restored = loadPersistedSessions(key, tmpDir);
    expect(restored.size).toBe(0);
  });

  it("wrong key returns empty map (fail-open)", () => {
    const key1 = generateOrLoadSessionKey(tmpDir);
    const sessions = new Map<string, AuthSession>();
    sessions.set("s1", makeSession());
    persistSessions(sessions, key1, tmpDir);

    // Use a different tmpDir to get a different key
    const tmpDir2 = makeTmpDir();
    try {
      const key2 = generateOrLoadSessionKey(tmpDir2);
      // Read file from tmpDir but decrypt with key2
      const restored = loadPersistedSessions(key2, tmpDir);
      expect(restored.size).toBe(0);
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });

  it("missing file returns empty map", () => {
    const key = generateOrLoadSessionKey(tmpDir);
    const restored = loadPersistedSessions(key, tmpDir);
    expect(restored.size).toBe(0);
  });

  it("flushSessions writes immediately", () => {
    const key = generateOrLoadSessionKey(tmpDir);
    const sessions = new Map<string, AuthSession>();
    sessions.set("s1", makeSession());

    flushSessions(sessions, key, tmpDir);

    const restored = loadPersistedSessions(key, tmpDir);
    expect(restored.size).toBe(1);
  });

  it("expired sessions are purged on persist (not written to disk)", () => {
    const key = generateOrLoadSessionKey(tmpDir);
    const sessions = new Map<string, AuthSession>();
    const live = makeSession();
    const expired = makeSession({ expiresAt: Date.now() - 1 });
    sessions.set(live.id, live);
    sessions.set(expired.id, expired);

    persistSessions(sessions, key, tmpDir);
    const restored = loadPersistedSessions(key, tmpDir);
    expect(restored.size).toBe(1);
  });
});
