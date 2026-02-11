/**
 * HTTP auth endpoints: /auth/login, /auth/logout, /auth/me, /auth/refresh.
 * Includes rate limiting on login attempts.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getGatewayUser } from "../infra/auth-credentials.js";
import { clearSessionCookie, parseSessionCookie, setSessionCookie } from "./auth-cookies.js";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "./auth-password.js";
import {
  createAuthSession,
  deleteAuthSession,
  getAuthSession,
  refreshAuthSession,
} from "./auth-sessions.js";
import { sendJson } from "./http-common.js";
import { resolveGatewayClientIp } from "./net.js";

// --- Rate limiting ---

type RateBucket = { count: number; resetAt: number };
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const rateBuckets = new Map<string, RateBucket>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    return false;
  }
  return bucket.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginAttempt(ip: string): void {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  bucket.count++;
}

function resetRateLimit(ip: string): void {
  rateBuckets.delete(ip);
}

// --- Helpers ---

function clientIpFromReq(req: IncomingMessage, trustedProxies?: string[]): string {
  return (
    resolveGatewayClientIp({
      remoteAddr: req.socket?.remoteAddress ?? "",
      forwardedFor: headerValue(req.headers["x-forwarded-for"]),
      realIp: headerValue(req.headers["x-real-ip"]),
      trustedProxies,
    }) ?? "unknown"
  );
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(req: IncomingMessage, maxBytes = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isSecureRequest(req: IncomingMessage): boolean {
  // Encrypted socket, or behind a TLS-terminating proxy
  if ((req.socket as { encrypted?: boolean }).encrypted) {
    return true;
  }
  const proto = req.headers["x-forwarded-proto"];
  return proto === "https";
}

// --- Route handler ---

/**
 * Handle /auth/* HTTP requests. Returns true if handled.
 * Must be called before Control UI serving.
 */
export function handleAuthHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { trustedProxies?: string[] },
): boolean {
  const url = req.url ?? "";
  if (!url.startsWith("/auth/")) {
    return false;
  }

  const route = url.split("?")[0];
  if (route === "/auth/login" && req.method === "POST") {
    void handleLogin(req, res, opts);
    return true;
  }
  if (route === "/auth/logout" && req.method === "POST") {
    handleLogout(req, res);
    return true;
  }
  if (route === "/auth/me" && req.method === "GET") {
    handleMe(req, res);
    return true;
  }
  if (route === "/auth/refresh" && req.method === "POST") {
    handleRefresh(req, res);
    return true;
  }

  // Unknown auth route
  sendJson(res, 404, { error: { message: "Not Found", type: "not_found" } });
  return true;
}

// --- Endpoint handlers ---

async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { trustedProxies?: string[] },
): Promise<void> {
  const ip = clientIpFromReq(req, opts.trustedProxies);

  if (isRateLimited(ip)) {
    sendJson(res, 429, {
      error: {
        message: "Too many login attempts. Try again later.",
        type: "rate_limited",
      },
    });
    return;
  }

  let body: unknown;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, {
      error: { message: "Invalid JSON body", type: "invalid_request" },
    });
    return;
  }

  const { username, password } = body as { username?: string; password?: string };
  if (!username || typeof username !== "string" || !password || typeof password !== "string") {
    sendJson(res, 400, {
      error: { message: "username and password are required", type: "invalid_request" },
    });
    return;
  }

  recordLoginAttempt(ip);

  const user = getGatewayUser(username);
  // Always run scrypt to prevent user-enumeration timing oracle
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !valid) {
    sendJson(res, 401, {
      error: { message: "Invalid credentials", type: "unauthorized" },
    });
    return;
  }

  // Successful login — reset rate limit
  resetRateLimit(ip);

  const session = createAuthSession({
    username: user.username,
    role: user.role,
  });

  const secure = isSecureRequest(req);
  setSessionCookie(res, session.id, { secure });

  sendJson(res, 200, {
    ok: true,
    user: {
      username: session.username,
      role: session.role,
      scopes: session.scopes,
    },
    csrfToken: session.csrfToken,
  });
}

function handleLogout(req: IncomingMessage, res: ServerResponse): void {
  const sessionId = parseSessionCookie(req);
  if (sessionId) {
    deleteAuthSession(sessionId);
  }
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}

function handleMe(req: IncomingMessage, res: ServerResponse): void {
  const sessionId = parseSessionCookie(req);
  if (!sessionId) {
    sendJson(res, 401, {
      error: { message: "Not authenticated", type: "unauthorized" },
    });
    return;
  }
  const session = getAuthSession(sessionId);
  if (!session) {
    clearSessionCookie(res);
    sendJson(res, 401, {
      error: { message: "Session expired", type: "session_expired" },
    });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    user: {
      username: session.username,
      role: session.role,
      scopes: session.scopes,
    },
    csrfToken: session.csrfToken,
  });
}

function handleRefresh(req: IncomingMessage, res: ServerResponse): void {
  const sessionId = parseSessionCookie(req);
  if (!sessionId) {
    sendJson(res, 401, {
      error: { message: "Not authenticated", type: "unauthorized" },
    });
    return;
  }
  const session = refreshAuthSession(sessionId);
  if (!session) {
    clearSessionCookie(res);
    sendJson(res, 401, {
      error: { message: "Session expired", type: "session_expired" },
    });
    return;
  }
  const secure = isSecureRequest(req);
  setSessionCookie(res, session.id, { secure });
  sendJson(res, 200, { ok: true });
}

// --- CSRF verification middleware ---

/**
 * Verify CSRF token for mutative requests.
 * Returns true if valid (or not required). False if rejected.
 */
export function verifyCsrf(req: IncomingMessage, res: ServerResponse): boolean {
  const method = req.method ?? "GET";
  // Safe methods don't need CSRF
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return true;
  }
  // Auth routes handle their own CSRF (login doesn't need it, logout is idempotent)
  const url = req.url ?? "";
  if (url.startsWith("/auth/")) {
    return true;
  }

  const sessionId = parseSessionCookie(req);
  if (!sessionId) {
    // No session → no CSRF needed (request will fail auth anyway)
    return true;
  }
  const session = getAuthSession(sessionId);
  if (!session) {
    return true;
  }

  const csrfHeader = req.headers["x-csrf-token"];
  const csrfValue = typeof csrfHeader === "string" ? csrfHeader : undefined;
  if (!csrfValue || csrfValue !== session.csrfToken) {
    sendJson(res, 403, {
      error: { message: "Invalid CSRF token", type: "csrf_error" },
    });
    return false;
  }
  return true;
}

/** Reset rate limiting state (for tests). */
export function resetRateLimitsForTest(): void {
  rateBuckets.clear();
}
