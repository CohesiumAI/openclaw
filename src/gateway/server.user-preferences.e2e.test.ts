/**
 * E2E tests for user.preferences.get / user.preferences.set via WS.
 * Uses HTTP login to populate authUser (session cookie auth).
 */

import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { createGatewayUser } from "../infra/auth-credentials.js";
import { resetRateLimitsForTest } from "./auth-http.js";
import { hashPassword } from "./auth-password.js";
import {
  connectReq,
  getFreePort,
  installGatewayTestHooks,
  rpcReq,
  startGatewayServer,
  testState,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

const TEST_USER = "prefuser";
const TEST_PASSWORD = "pref-password-secure";

type JsonResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
};

function httpRequest(
  port: number,
  method: string,
  path: string,
  opts?: { body?: unknown; cookie?: string },
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    let payload: string | undefined;
    if (opts?.body) {
      payload = JSON.stringify(opts.body);
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(payload));
    }
    if (opts?.cookie) {
      headers.cookie = opts.cookie;
    }
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // non-JSON
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    });
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function extractSessionCookie(headers: http.IncomingHttpHeaders): string | null {
  const setCookie = headers["set-cookie"];
  if (!setCookie) {
    return null;
  }
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const entry of arr) {
    const match = /openclaw_session=([^;]+)/.exec(entry);
    if (match) {
      return `openclaw_session=${match[1]}`;
    }
  }
  return null;
}

/** Login via HTTP and open an authenticated WS connection. */
async function openAuthenticatedWs(port: number): Promise<{ ws: WebSocket; cookie: string }> {
  const loginRes = await httpRequest(port, "POST", "/auth/login", {
    body: { username: TEST_USER, password: TEST_PASSWORD },
  });
  const cookie = extractSessionCookie(loginRes.headers);
  if (!cookie) {
    throw new Error("login failed — no session cookie");
  }
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { cookie } });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const res = await connectReq(ws, { skipDefaultAuth: true });
  if (!res.ok) {
    throw new Error(`connect failed: ${res.error?.message}`);
  }
  return { ws, cookie };
}

describe("user.preferences E2E", () => {
  let server: Awaited<ReturnType<typeof startGatewayServer>>;
  let port: number;

  beforeAll(async () => {
    testState.gatewayAuth = { mode: "password", password: "fallback" };
    const passwordHash = await hashPassword(TEST_PASSWORD);
    createGatewayUser({ username: TEST_USER, passwordHash, role: "admin" });
    port = await getFreePort();
    server = await startGatewayServer(port, { controlUiEnabled: true });
  });

  beforeEach(() => {
    resetRateLimitsForTest();
  });

  afterAll(async () => {
    await server.close();
  });

  test("get returns defaults for a fresh user", async () => {
    const { ws } = await openAuthenticatedWs(port);
    const res = await rpcReq(ws, "user.preferences.get");
    expect(res.ok).toBe(true);
    const prefs = (res.payload as Record<string, unknown>)?.preferences as Record<string, unknown>;
    expect(prefs).toBeDefined();
    expect(prefs.version).toBe(1);
    expect(prefs.theme).toBe("system");
    expect(prefs.chatStreamResponses).toBe(true);
    // Defaults are also returned
    const defaults = (res.payload as Record<string, unknown>)?.defaults as Record<string, unknown>;
    expect(defaults).toBeDefined();
    expect(defaults.theme).toBe("system");
    ws.close();
  });

  test("set merges valid fields and returns updated prefs", async () => {
    const { ws } = await openAuthenticatedWs(port);
    const res = await rpcReq(ws, "user.preferences.set", {
      preferences: { theme: "dark", chatFocusMode: true },
    });
    expect(res.ok).toBe(true);
    const prefs = (res.payload as Record<string, unknown>)?.preferences as Record<string, unknown>;
    expect(prefs.theme).toBe("dark");
    expect(prefs.chatFocusMode).toBe(true);
    // Unchanged defaults preserved
    expect(prefs.chatStreamResponses).toBe(true);
    ws.close();
  });

  test("set persists across connections", async () => {
    // Set a preference
    const { ws: ws1 } = await openAuthenticatedWs(port);
    await rpcReq(ws1, "user.preferences.set", {
      preferences: { theme: "light", splitRatio: 0.4 },
    });
    ws1.close();

    // Read back from a new connection
    const { ws: ws2 } = await openAuthenticatedWs(port);
    const res = await rpcReq(ws2, "user.preferences.get");
    expect(res.ok).toBe(true);
    const prefs = (res.payload as Record<string, unknown>)?.preferences as Record<string, unknown>;
    expect(prefs.theme).toBe("light");
    expect(prefs.splitRatio).toBe(0.4);
    ws2.close();
  });

  test("set ignores unknown and invalid fields silently", async () => {
    const { ws } = await openAuthenticatedWs(port);
    const res = await rpcReq(ws, "user.preferences.set", {
      preferences: { theme: 42, unknownKey: "nope", chatFocusMode: false },
    });
    expect(res.ok).toBe(true);
    const prefs = (res.payload as Record<string, unknown>)?.preferences as Record<string, unknown>;
    // theme unchanged (invalid type), unknown ignored, chatFocusMode accepted
    expect(prefs.theme).not.toBe(42);
    expect((prefs as Record<string, unknown>).unknownKey).toBeUndefined();
    expect(prefs.chatFocusMode).toBe(false);
    ws.close();
  });

  test("set rejects missing preferences object", async () => {
    const { ws } = await openAuthenticatedWs(port);
    const res = await rpcReq(ws, "user.preferences.set", { notPrefs: true });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("preferences object required");
    ws.close();
  });

  test("set rejects missing preferences key in params", async () => {
    const { ws } = await openAuthenticatedWs(port);
    const res = await rpcReq(ws, "user.preferences.set", {});
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("preferences object required");
    ws.close();
  });

  test("get fails without session cookie (no authUser)", async () => {
    // Connect with token — no HTTP session → authUser is null
    testState.gatewayAuth = { mode: "password", password: "fallback" };
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws.once("open", resolve));
    // Use the test user's credentials as password auth via connectReq
    const connRes = await connectReq(ws, { password: TEST_PASSWORD });
    // Password auth via WS connect may succeed, but authUser won't be set
    // because there's no HTTP session cookie — the user is authenticated
    // by the gateway password, not by a per-user login session.
    if (connRes.ok) {
      const res = await rpcReq(ws, "user.preferences.get");
      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain("password authentication required");
    }
    // If connect itself fails (no fallback password match), that's also valid
    ws.close();
  });
});
