import { describe, expect, it, vi } from "vitest";
import {
  resolveAuthIdentity,
  canSeeAllSessions,
  assertSessionOwnership,
  filterStoreByOwner,
} from "./auth-identity.js";
import type { GatewayClient } from "./types.js";
import type { SessionEntry } from "../../config/sessions/types.js";

/* ---------- helpers ---------- */

/** Build a fake GatewayClient with optional authUser / authRole. */
function fakeClient(
  opts: { authUser?: string; authRole?: "admin" | "operator" | "read-only" } = {},
): GatewayClient {
  return {
    connect: {} as never,
    connId: "test-conn",
    authUser: opts.authUser,
    authRole: opts.authRole,
  } as unknown as GatewayClient;
}

/** Minimal SessionEntry stub. */
function fakeEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    sessionId: "sess-1",
    updatedAt: Date.now(),
    ...overrides,
  } as SessionEntry;
}

/** Spy that captures the respond() call. */
function respondSpy() {
  const calls: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
  const fn = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { fn, calls };
}

/* ============================= */
/* resolveAuthIdentity           */
/* ============================= */

describe("resolveAuthIdentity", () => {
  it("returns null when client is null (CLI / node)", () => {
    expect(resolveAuthIdentity(null)).toBeNull();
  });

  it("returns null when authUser is undefined (token mode)", () => {
    expect(resolveAuthIdentity(fakeClient())).toBeNull();
  });

  it("returns null when authUser is empty string", () => {
    expect(resolveAuthIdentity(fakeClient({ authUser: "" }))).toBeNull();
  });

  it("returns null when authUser is whitespace only", () => {
    expect(resolveAuthIdentity(fakeClient({ authUser: "   " }))).toBeNull();
  });

  it("returns identity for valid authUser (operator default)", () => {
    const id = resolveAuthIdentity(fakeClient({ authUser: "alice" }));
    expect(id).toEqual({ username: "alice", role: "operator" });
  });

  it("returns identity with explicit admin role", () => {
    const id = resolveAuthIdentity(fakeClient({ authUser: "root", authRole: "admin" }));
    expect(id).toEqual({ username: "root", role: "admin" });
  });

  it("trims whitespace from authUser", () => {
    const id = resolveAuthIdentity(fakeClient({ authUser: "  bob  " }));
    expect(id?.username).toBe("bob");
  });

  it("defaults to operator when authRole is undefined", () => {
    const id = resolveAuthIdentity(fakeClient({ authUser: "alice" }));
    expect(id?.role).toBe("operator");
  });
});

/* ============================= */
/* canSeeAllSessions             */
/* ============================= */

describe("canSeeAllSessions", () => {
  it("returns true in token mode (no authUser)", () => {
    expect(canSeeAllSessions(fakeClient())).toBe(true);
  });

  it("returns true when client is null (CLI)", () => {
    expect(canSeeAllSessions(null)).toBe(true);
  });

  it("returns false for admin role (admins use admin.sessions.list)", () => {
    expect(canSeeAllSessions(fakeClient({ authUser: "root", authRole: "admin" }))).toBe(false);
  });

  it("returns false for operator role", () => {
    expect(canSeeAllSessions(fakeClient({ authUser: "alice", authRole: "operator" }))).toBe(false);
  });

  it("returns false for read-only role", () => {
    expect(canSeeAllSessions(fakeClient({ authUser: "viewer", authRole: "read-only" }))).toBe(
      false,
    );
  });
});

/* ============================= */
/* assertSessionOwnership        */
/* ============================= */

describe("assertSessionOwnership", () => {
  it("allows access in token mode (no authUser)", () => {
    const r = respondSpy();
    const ok = assertSessionOwnership({
      client: fakeClient(),
      entry: fakeEntry({ ownerId: "someone" }),
      respond: r.fn as never,
    });
    expect(ok).toBe(true);
    expect(r.calls).toHaveLength(0);
  });

  it("allows access when client is null (CLI)", () => {
    const r = respondSpy();
    const ok = assertSessionOwnership({
      client: null,
      entry: fakeEntry({ ownerId: "someone" }),
      respond: r.fn as never,
    });
    expect(ok).toBe(true);
  });

  it("allows admin to access any session", () => {
    const r = respondSpy();
    const ok = assertSessionOwnership({
      client: fakeClient({ authUser: "root", authRole: "admin" }),
      entry: fakeEntry({ ownerId: "alice" }),
      respond: r.fn as never,
    });
    expect(ok).toBe(true);
    expect(r.calls).toHaveLength(0);
  });

  it("allows access to legacy sessions (no ownerId)", () => {
    const r = respondSpy();
    const ok = assertSessionOwnership({
      client: fakeClient({ authUser: "alice", authRole: "operator" }),
      entry: fakeEntry(), // no ownerId
      respond: r.fn as never,
    });
    expect(ok).toBe(true);
  });

  it("allows access to undefined entry (session not found)", () => {
    const r = respondSpy();
    const ok = assertSessionOwnership({
      client: fakeClient({ authUser: "alice", authRole: "operator" }),
      entry: undefined,
      respond: r.fn as never,
    });
    expect(ok).toBe(true);
  });

  it("allows owner to access their own session", () => {
    const r = respondSpy();
    const ok = assertSessionOwnership({
      client: fakeClient({ authUser: "alice", authRole: "operator" }),
      entry: fakeEntry({ ownerId: "alice" }),
      respond: r.fn as never,
    });
    expect(ok).toBe(true);
    expect(r.calls).toHaveLength(0);
  });

  it("denies operator access to another user's session", () => {
    const r = respondSpy();
    const ok = assertSessionOwnership({
      client: fakeClient({ authUser: "alice", authRole: "operator" }),
      entry: fakeEntry({ ownerId: "bob" }),
      respond: r.fn as never,
    });
    expect(ok).toBe(false);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.ok).toBe(false);
    expect(r.calls[0]!.error).toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("another user"),
    });
  });

  it("denies read-only access to another user's session", () => {
    const r = respondSpy();
    const ok = assertSessionOwnership({
      client: fakeClient({ authUser: "viewer", authRole: "read-only" }),
      entry: fakeEntry({ ownerId: "bob" }),
      respond: r.fn as never,
    });
    expect(ok).toBe(false);
  });
});

/* ============================= */
/* filterStoreByOwner            */
/* ============================= */

describe("filterStoreByOwner", () => {
  const store: Record<string, SessionEntry> = {
    "key-alice-1": fakeEntry({ sessionId: "s1", ownerId: "alice" }),
    "key-alice-2": fakeEntry({ sessionId: "s2", ownerId: "alice" }),
    "key-bob-1": fakeEntry({ sessionId: "s3", ownerId: "bob" }),
    "key-legacy": fakeEntry({ sessionId: "s4" }), // no ownerId
  };

  it("returns own + legacy sessions for a regular user", () => {
    const result = filterStoreByOwner(store, "alice");
    const keys = Object.keys(result);
    expect(keys).toContain("key-alice-1");
    expect(keys).toContain("key-alice-2");
    expect(keys).toContain("key-legacy");
    expect(keys).not.toContain("key-bob-1");
    expect(keys).toHaveLength(3);
  });

  it("returns only legacy sessions for a user with no owned sessions", () => {
    const result = filterStoreByOwner(store, "charlie");
    const keys = Object.keys(result);
    expect(keys).toEqual(["key-legacy"]);
  });

  it("returns empty object for empty store", () => {
    expect(filterStoreByOwner({}, "alice")).toEqual({});
  });

  it("returns all entries when none have ownerId (all legacy)", () => {
    const legacyStore: Record<string, SessionEntry> = {
      a: fakeEntry({ sessionId: "a" }),
      b: fakeEntry({ sessionId: "b" }),
    };
    const result = filterStoreByOwner(legacyStore, "anyone");
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("excludes all entries when all belong to other users", () => {
    const otherStore: Record<string, SessionEntry> = {
      a: fakeEntry({ sessionId: "a", ownerId: "bob" }),
      b: fakeEntry({ sessionId: "b", ownerId: "charlie" }),
    };
    const result = filterStoreByOwner(otherStore, "alice");
    expect(Object.keys(result)).toHaveLength(0);
  });
});
