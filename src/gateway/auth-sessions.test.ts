import { afterEach, describe, expect, it } from "vitest";
import {
  createAuthSession,
  deleteAuthSession,
  deleteUserSessions,
  getAuthSession,
  getSessionCount,
  listUserSessionIds,
  refreshAuthSession,
  resetSessionStoreForTest,
  rolesToScopes,
} from "./auth-sessions.js";

afterEach(() => {
  resetSessionStoreForTest();
});

describe("auth-sessions", () => {
  it("createAuthSession returns a valid session", () => {
    const session = createAuthSession({ username: "admin", role: "admin" });
    expect(session.id).toBeTruthy();
    expect(session.username).toBe("admin");
    expect(session.role).toBe("admin");
    expect(session.csrfToken).toBeTruthy();
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("getAuthSession retrieves an existing session", () => {
    const session = createAuthSession({ username: "admin", role: "admin" });
    const retrieved = getAuthSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.username).toBe("admin");
  });

  it("getAuthSession returns null for unknown ID", () => {
    expect(getAuthSession("nonexistent")).toBeNull();
  });

  it("deleteAuthSession removes the session", () => {
    const session = createAuthSession({ username: "admin", role: "admin" });
    expect(deleteAuthSession(session.id)).toBe(true);
    expect(getAuthSession(session.id)).toBeNull();
  });

  it("deleteAuthSession returns false for unknown ID", () => {
    expect(deleteAuthSession("nonexistent")).toBe(false);
  });

  it("refreshAuthSession extends expiry", () => {
    const session = createAuthSession({ username: "admin", role: "admin" });
    const originalExpiry = session.expiresAt;
    // Simulate slight time passage
    const refreshed = refreshAuthSession(session.id);
    expect(refreshed).not.toBeNull();
    expect(refreshed!.expiresAt).toBeGreaterThanOrEqual(originalExpiry);
  });

  it("refreshAuthSession returns null for expired sessions", () => {
    const session = createAuthSession({ username: "admin", role: "admin" });
    // Force expire
    session.expiresAt = Date.now() - 1;
    expect(refreshAuthSession(session.id)).toBeNull();
  });

  it("deleteUserSessions removes all sessions for a user", () => {
    createAuthSession({ username: "alice", role: "admin" });
    createAuthSession({ username: "alice", role: "admin" });
    createAuthSession({ username: "bob", role: "operator" });
    expect(getSessionCount()).toBe(3);
    const deleted = deleteUserSessions("alice");
    expect(deleted).toBe(2);
    expect(getSessionCount()).toBe(1);
  });

  it("listUserSessionIds returns active session IDs", () => {
    const s1 = createAuthSession({ username: "alice", role: "admin" });
    const s2 = createAuthSession({ username: "alice", role: "admin" });
    createAuthSession({ username: "bob", role: "operator" });
    const ids = listUserSessionIds("alice");
    expect(ids).toHaveLength(2);
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);
  });

  it("rolesToScopes maps roles correctly", () => {
    expect(rolesToScopes("admin")).toContain("operator.admin");
    expect(rolesToScopes("operator")).toContain("operator.read");
    expect(rolesToScopes("operator")).toContain("operator.write");
    expect(rolesToScopes("operator")).not.toContain("operator.admin");
    expect(rolesToScopes("read-only")).toEqual(["operator.read"]);
  });
});
