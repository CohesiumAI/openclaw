import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGatewayUser,
  deleteGatewayUser,
  getGatewayUser,
  hasGatewayUsers,
  listGatewayUsers,
  resolveGatewayUsersPath,
  updateGatewayUserPassword,
  updateGatewayUserRecoveryCode,
  updateGatewayUserRole,
  updateGatewayUsername,
} from "./auth-credentials.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oc-cred-test-"));
}

let tmpDir: string;

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("auth-credentials", () => {
  it("resolveGatewayUsersPath returns a path inside credentials dir", () => {
    const p = resolveGatewayUsersPath("/fake/state");
    expect(p).toContain("credentials");
    expect(p).toContain("gateway-users.json");
  });

  it("hasGatewayUsers returns false for empty state dir", () => {
    tmpDir = makeTmpDir();
    expect(hasGatewayUsers(tmpDir)).toBe(false);
  });

  it("createGatewayUser creates a user and persists it", () => {
    tmpDir = makeTmpDir();
    const ok = createGatewayUser(
      { username: "admin", passwordHash: "$scrypt$test", role: "admin" },
      tmpDir,
    );
    expect(ok).toBe(true);
    expect(hasGatewayUsers(tmpDir)).toBe(true);

    const user = getGatewayUser("admin", tmpDir);
    expect(user).not.toBeNull();
    expect(user!.username).toBe("admin");
    expect(user!.role).toBe("admin");
    expect(user!.passwordHash).toBe("$scrypt$test");
  });

  it("createGatewayUser rejects duplicate username (case-insensitive)", () => {
    tmpDir = makeTmpDir();
    createGatewayUser({ username: "Admin", passwordHash: "$scrypt$test", role: "admin" }, tmpDir);
    const ok = createGatewayUser(
      { username: "admin", passwordHash: "$scrypt$other", role: "operator" },
      tmpDir,
    );
    expect(ok).toBe(false);
    expect(listGatewayUsers(tmpDir)).toHaveLength(1);
  });

  it("getGatewayUser is case-insensitive", () => {
    tmpDir = makeTmpDir();
    createGatewayUser({ username: "Alice", passwordHash: "$scrypt$x", role: "admin" }, tmpDir);
    expect(getGatewayUser("alice", tmpDir)).not.toBeNull();
    expect(getGatewayUser("ALICE", tmpDir)).not.toBeNull();
  });

  it("updateGatewayUserPassword updates the hash", () => {
    tmpDir = makeTmpDir();
    createGatewayUser({ username: "admin", passwordHash: "$scrypt$old", role: "admin" }, tmpDir);
    const ok = updateGatewayUserPassword("admin", "$scrypt$new", tmpDir);
    expect(ok).toBe(true);
    expect(getGatewayUser("admin", tmpDir)!.passwordHash).toBe("$scrypt$new");
  });

  it("updateGatewayUserRole changes the role", () => {
    tmpDir = makeTmpDir();
    createGatewayUser({ username: "admin", passwordHash: "$scrypt$x", role: "admin" }, tmpDir);
    const ok = updateGatewayUserRole("admin", "read-only", tmpDir);
    expect(ok).toBe(true);
    expect(getGatewayUser("admin", tmpDir)!.role).toBe("read-only");
  });

  it("deleteGatewayUser removes the user", () => {
    tmpDir = makeTmpDir();
    createGatewayUser({ username: "admin", passwordHash: "$scrypt$x", role: "admin" }, tmpDir);
    const ok = deleteGatewayUser("admin", tmpDir);
    expect(ok).toBe(true);
    expect(hasGatewayUsers(tmpDir)).toBe(false);
  });

  it("deleteGatewayUser returns false for unknown user", () => {
    tmpDir = makeTmpDir();
    expect(deleteGatewayUser("nobody", tmpDir)).toBe(false);
  });

  it("createGatewayUser stores recoveryCodeHash when provided", () => {
    tmpDir = makeTmpDir();
    const ok = createGatewayUser(
      {
        username: "admin",
        passwordHash: "$scrypt$p",
        role: "admin",
        recoveryCodeHash: "$scrypt$r",
      },
      tmpDir,
    );
    expect(ok).toBe(true);
    const user = getGatewayUser("admin", tmpDir);
    expect(user!.recoveryCodeHash).toBe("$scrypt$r");
  });

  it("createGatewayUser omits recoveryCodeHash when not provided", () => {
    tmpDir = makeTmpDir();
    createGatewayUser({ username: "admin", passwordHash: "$scrypt$p", role: "admin" }, tmpDir);
    const user = getGatewayUser("admin", tmpDir);
    expect(user!.recoveryCodeHash).toBeUndefined();
  });

  it("updateGatewayUserRecoveryCode updates the hash", () => {
    tmpDir = makeTmpDir();
    createGatewayUser({ username: "admin", passwordHash: "$scrypt$p", role: "admin" }, tmpDir);
    const ok = updateGatewayUserRecoveryCode("admin", "$scrypt$newcode", tmpDir);
    expect(ok).toBe(true);
    expect(getGatewayUser("admin", tmpDir)!.recoveryCodeHash).toBe("$scrypt$newcode");
  });

  it("updateGatewayUserRecoveryCode returns false for unknown user", () => {
    tmpDir = makeTmpDir();
    expect(updateGatewayUserRecoveryCode("nobody", "$scrypt$x", tmpDir)).toBe(false);
  });

  it("updateGatewayUsername renames the user", () => {
    tmpDir = makeTmpDir();
    createGatewayUser({ username: "alice", passwordHash: "$scrypt$p", role: "admin" }, tmpDir);
    const ok = updateGatewayUsername("alice", "bob", tmpDir);
    expect(ok).toBe(true);
    expect(getGatewayUser("alice", tmpDir)).toBeNull();
    expect(getGatewayUser("bob", tmpDir)!.username).toBe("bob");
  });

  it("updateGatewayUsername rejects if new name is taken", () => {
    tmpDir = makeTmpDir();
    createGatewayUser({ username: "alice", passwordHash: "$scrypt$p", role: "admin" }, tmpDir);
    createGatewayUser({ username: "bob", passwordHash: "$scrypt$p", role: "operator" }, tmpDir);
    const ok = updateGatewayUsername("alice", "bob", tmpDir);
    expect(ok).toBe(false);
    expect(getGatewayUser("alice", tmpDir)).not.toBeNull();
  });

  it("updateGatewayUsername returns false for unknown user", () => {
    tmpDir = makeTmpDir();
    expect(updateGatewayUsername("nobody", "newname", tmpDir)).toBe(false);
  });
});
