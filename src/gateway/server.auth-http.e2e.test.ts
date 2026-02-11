/**
 * E2E smoke tests for HTTP auth endpoints: login → /auth/me → logout.
 * Also tests rate limiting and WS auth via session cookie.
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
  startGatewayServer,
  testState,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

const TEST_USERNAME = "admin";
const TEST_PASSWORD = "test-password-secure";

type JsonResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
};

/** Simple HTTP request helper returning parsed JSON. */
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
          // non-JSON response
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

/** Extract session cookie value from Set-Cookie header. */
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

describe("gateway HTTP auth endpoints", () => {
  let server: Awaited<ReturnType<typeof startGatewayServer>>;
  let port: number;

  beforeAll(async () => {
    // Configure gateway with password auth (allows hashed credentials)
    testState.gatewayAuth = { mode: "password", password: "fallback-not-used" };

    // Create a test user with hashed password
    const passwordHash = await hashPassword(TEST_PASSWORD);
    createGatewayUser({
      username: TEST_USERNAME,
      passwordHash,
      role: "admin",
    });

    port = await getFreePort();
    server = await startGatewayServer(port, { controlUiEnabled: true });
  });

  beforeEach(() => {
    resetRateLimitsForTest();
  });

  afterAll(async () => {
    await server.close();
  });

  test("POST /auth/login with valid credentials returns 200 + cookie + user", async () => {
    const res = await httpRequest(port, "POST", "/auth/login", {
      body: { username: TEST_USERNAME, password: TEST_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((res.body.user as Record<string, unknown>)?.username).toBe(TEST_USERNAME);
    expect((res.body.user as Record<string, unknown>)?.role).toBe("admin");
    expect(typeof res.body.csrfToken).toBe("string");
    const cookie = extractSessionCookie(res.headers);
    expect(cookie).toBeTruthy();
  });

  test("POST /auth/login with wrong password returns 401", async () => {
    const res = await httpRequest(port, "POST", "/auth/login", {
      body: { username: TEST_USERNAME, password: "wrong-password" },
    });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBeUndefined();
  });

  test("GET /auth/me without cookie returns 401", async () => {
    const res = await httpRequest(port, "GET", "/auth/me");
    expect(res.status).toBe(401);
  });

  test("GET /auth/me with valid session cookie returns 200 + user", async () => {
    // Login first
    const loginRes = await httpRequest(port, "POST", "/auth/login", {
      body: { username: TEST_USERNAME, password: TEST_PASSWORD },
    });
    const cookie = extractSessionCookie(loginRes.headers);
    expect(cookie).toBeTruthy();

    // Check /auth/me
    const meRes = await httpRequest(port, "GET", "/auth/me", { cookie: cookie! });
    expect(meRes.status).toBe(200);
    expect(meRes.body.ok).toBe(true);
    expect((meRes.body.user as Record<string, unknown>)?.username).toBe(TEST_USERNAME);
    expect(typeof meRes.body.csrfToken).toBe("string");
  });

  test("POST /auth/logout clears session", async () => {
    // Login
    const loginRes = await httpRequest(port, "POST", "/auth/login", {
      body: { username: TEST_USERNAME, password: TEST_PASSWORD },
    });
    const cookie = extractSessionCookie(loginRes.headers);
    expect(cookie).toBeTruthy();

    // Logout
    const logoutRes = await httpRequest(port, "POST", "/auth/logout", { cookie: cookie! });
    expect(logoutRes.status).toBe(200);

    // /auth/me should now return 401
    const meRes = await httpRequest(port, "GET", "/auth/me", { cookie: cookie! });
    expect(meRes.status).toBe(401);
  });

  test("rate limiting kicks in after 5 failed attempts", async () => {
    for (let i = 0; i < 5; i++) {
      await httpRequest(port, "POST", "/auth/login", {
        body: { username: TEST_USERNAME, password: "wrong" },
      });
    }
    // 6th attempt should be rate limited
    const res = await httpRequest(port, "POST", "/auth/login", {
      body: { username: TEST_USERNAME, password: "wrong" },
    });
    expect(res.status).toBe(429);
  });

  test("POST /auth/login with missing fields returns 400", async () => {
    const res = await httpRequest(port, "POST", "/auth/login", {
      body: { username: TEST_USERNAME },
    });
    expect(res.status).toBe(400);
  });

  test("WS connect with session cookie succeeds", async () => {
    // Login via HTTP to get a session cookie
    const loginRes = await httpRequest(port, "POST", "/auth/login", {
      body: { username: TEST_USERNAME, password: TEST_PASSWORD },
    });
    const cookie = extractSessionCookie(loginRes.headers);
    expect(cookie).toBeTruthy();

    // Open WS with cookie header
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { cookie: cookie! },
    });
    await new Promise<void>((resolve) => ws.once("open", resolve));

    // Send connect request (no token needed — session cookie provides auth)
    const res = await connectReq(ws, { skipDefaultAuth: true });
    expect(res.ok).toBe(true);
    const payload = res.payload as { type?: string } | undefined;
    expect(payload?.type).toBe("hello-ok");

    ws.close();
  });
});
