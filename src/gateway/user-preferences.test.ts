import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getUserPreferencesDefaults,
  loadUserPreferences,
  mergeUserPreferences,
  saveUserPreferences,
} from "./user-preferences.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-prefs-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("user-preferences", () => {
  it("returns defaults for a fresh user", () => {
    const prefs = loadUserPreferences("alice", tmpDir);
    expect(prefs).toEqual(getUserPreferencesDefaults());
  });

  it("round-trips save and load", () => {
    const defaults = getUserPreferencesDefaults();
    const custom = { ...defaults, theme: "dark" as const, chatFocusMode: true };
    saveUserPreferences("alice", custom, tmpDir);
    const loaded = loadUserPreferences("alice", tmpDir);
    expect(loaded.theme).toBe("dark");
    expect(loaded.chatFocusMode).toBe(true);
    // Unchanged fields keep defaults
    expect(loaded.chatStreamResponses).toBe(true);
  });

  it("isolates users", () => {
    const defaults = getUserPreferencesDefaults();
    saveUserPreferences("alice", { ...defaults, theme: "dark" as const }, tmpDir);
    saveUserPreferences("bob", { ...defaults, theme: "light" as const }, tmpDir);
    expect(loadUserPreferences("alice", tmpDir).theme).toBe("dark");
    expect(loadUserPreferences("bob", tmpDir).theme).toBe("light");
  });

  it("sanitizes username for filesystem safety", () => {
    const defaults = getUserPreferencesDefaults();
    // Path traversal attempt
    saveUserPreferences("../evil", { ...defaults, theme: "dark" as const }, tmpDir);
    const loaded = loadUserPreferences("../evil", tmpDir);
    expect(loaded.theme).toBe("dark");
    // File should be in the safe sanitized path, not outside tmpDir
    const files = fs.readdirSync(path.join(tmpDir, "user-preferences"));
    expect(files.every((f) => !f.includes(".."))).toBe(true);
  });

  describe("mergeUserPreferences", () => {
    it("merges valid fields only", () => {
      const result = mergeUserPreferences("alice", { theme: "light", chatFocusMode: true }, tmpDir);
      expect(result.theme).toBe("light");
      expect(result.chatFocusMode).toBe(true);
      // Defaults preserved
      expect(result.chatStreamResponses).toBe(true);
    });

    it("ignores unknown fields", () => {
      const result = mergeUserPreferences("alice", { unknownField: 42, theme: "dark" }, tmpDir);
      expect(result.theme).toBe("dark");
      expect((result as Record<string, unknown>).unknownField).toBeUndefined();
    });

    it("ignores fields with invalid types", () => {
      const result = mergeUserPreferences(
        "alice",
        { theme: 123, chatFocusMode: "yes", splitRatio: 0.5 },
        tmpDir,
      );
      // theme and chatFocusMode should stay default (invalid types), splitRatio accepted
      expect(result.theme).toBe("system");
      expect(result.chatFocusMode).toBe(false);
      expect(result.splitRatio).toBe(0.5);
    });

    it("rejects splitRatio out of range", () => {
      const result = mergeUserPreferences("alice", { splitRatio: 0.1 }, tmpDir);
      expect(result.splitRatio).toBe(0.6); // default
      const result2 = mergeUserPreferences("alice", { splitRatio: 0.95 }, tmpDir);
      expect(result2.splitRatio).toBe(0.6); // still default (0.1 was rejected, never saved)
    });

    it("accepts valid array fields", () => {
      const result = mergeUserPreferences(
        "alice",
        { pinnedSessionKeys: ["a", "b"], archivedSessionKeys: ["c"] },
        tmpDir,
      );
      expect(result.pinnedSessionKeys).toEqual(["a", "b"]);
      expect(result.archivedSessionKeys).toEqual(["c"]);
    });

    it("rejects arrays with non-string elements", () => {
      const result = mergeUserPreferences("alice", { pinnedSessionKeys: [1, 2] }, tmpDir);
      expect(result.pinnedSessionKeys).toEqual([]); // default
    });

    it("persists merged prefs", () => {
      mergeUserPreferences("alice", { theme: "dark" }, tmpDir);
      const loaded = loadUserPreferences("alice", tmpDir);
      expect(loaded.theme).toBe("dark");
    });
  });

  it("returns defaults for corrupted JSON file", () => {
    const prefsDir = path.join(tmpDir, "user-preferences");
    fs.mkdirSync(prefsDir, { recursive: true });
    fs.writeFileSync(path.join(prefsDir, "alice.json"), "NOT JSON", "utf8");
    const prefs = loadUserPreferences("alice", tmpDir);
    expect(prefs).toEqual(getUserPreferencesDefaults());
  });

  it("returns defaults for wrong version", () => {
    const prefsDir = path.join(tmpDir, "user-preferences");
    fs.mkdirSync(prefsDir, { recursive: true });
    fs.writeFileSync(
      path.join(prefsDir, "alice.json"),
      JSON.stringify({ version: 99, theme: "dark" }),
      "utf8",
    );
    const prefs = loadUserPreferences("alice", tmpDir);
    expect(prefs.theme).toBe("system"); // default, not "dark"
  });
});
