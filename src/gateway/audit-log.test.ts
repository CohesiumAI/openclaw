import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initAuditLog,
  audit,
  flushAuditLog,
  resetAuditLogForTest,
  getAuditFilePath,
} from "./audit-log.js";

describe("audit-log", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-audit-"));
  });

  afterEach(() => {
    resetAuditLogForTest();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates audit.jsonl on first write", () => {
    initAuditLog({ stateDir: tmpDir });
    audit("auth.login.success", "admin", "127.0.0.1", { method: "password" });
    flushAuditLog();

    const filePath = getAuditFilePath();
    expect(filePath).toBeTruthy();
    expect(fs.existsSync(filePath!)).toBe(true);
  });

  it("writes valid JSON Lines format", () => {
    initAuditLog({ stateDir: tmpDir });
    audit("auth.login.success", "alice", "10.0.0.1");
    audit("auth.login.failed", "anonymous", "10.0.0.2", { reason: "password_mismatch" });
    flushAuditLog();

    const lines = fs.readFileSync(getAuditFilePath()!, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const entry1 = JSON.parse(lines[0]);
    expect(entry1.event).toBe("auth.login.success");
    expect(entry1.actor).toBe("alice");
    expect(entry1.ip).toBe("10.0.0.1");
    expect(entry1.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const entry2 = JSON.parse(lines[1]);
    expect(entry2.event).toBe("auth.login.failed");
    expect(entry2.details.reason).toBe("password_mismatch");
  });

  it("is a no-op before initialization", () => {
    // Should not throw
    audit("test.event", "system", "0.0.0.0");
    flushAuditLog();
    expect(getAuditFilePath()).toBeNull();
  });

  it("survives write errors gracefully (fail-safe)", () => {
    initAuditLog({ stateDir: tmpDir });
    // Make the logs dir read-only to simulate write failure
    const logsDir = path.join(tmpDir, "logs");
    const filePath = getAuditFilePath()!;
    // Write first to create the file
    audit("test", "system", "0.0.0.0");
    flushAuditLog();

    // Now make file read-only
    try {
      fs.chmodSync(filePath, 0o444);
      fs.chmodSync(logsDir, 0o444);
    } catch {
      // Windows may not support chmod fully — skip test
      return;
    }

    // Should not throw
    audit("test2", "system", "0.0.0.0");
    expect(() => flushAuditLog()).not.toThrow();

    // Restore permissions for cleanup
    try {
      fs.chmodSync(logsDir, 0o755);
      fs.chmodSync(filePath, 0o644);
    } catch {
      // best effort
    }
  });

  it("rotates when file exceeds 50 MB", () => {
    initAuditLog({ stateDir: tmpDir, retention: 3 });
    const filePath = getAuditFilePath()!;

    // Create a file just over the 50 MB threshold
    const logsDir = path.dirname(filePath);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    // Write a 50 MB + 1 byte file
    const bigContent = "x".repeat(50 * 1024 * 1024 + 1);
    fs.writeFileSync(filePath, bigContent);

    // Next audit+flush should trigger rotation
    audit("after.rotation", "system", "0.0.0.0");
    flushAuditLog();

    const files = fs.readdirSync(logsDir);
    const rotated = files.filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl"));
    expect(rotated.length).toBeGreaterThanOrEqual(1);

    // New audit.jsonl should exist with the new entry
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("after.rotation");
  });

  it("flushes buffer on threshold (100 entries)", () => {
    initAuditLog({ stateDir: tmpDir });
    for (let i = 0; i < 100; i++) {
      audit("bulk.event", "system", "0.0.0.0", { i });
    }
    // Buffer should have auto-flushed at 100 entries
    const filePath = getAuditFilePath()!;
    expect(fs.existsSync(filePath)).toBe(true);
    const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines.length).toBe(100);
  });

  it("resetAuditLogForTest clears all state", () => {
    initAuditLog({ stateDir: tmpDir });
    audit("test", "system", "0.0.0.0");
    resetAuditLogForTest();
    expect(getAuditFilePath()).toBeNull();
  });
});
