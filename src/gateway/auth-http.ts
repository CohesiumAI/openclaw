/**
 * HTTP auth endpoints: /auth/login, /auth/logout, /auth/me, /auth/refresh,
 * /auth/reset-password, /auth/capabilities.
 * Includes progressive rate limiting on login and recovery attempts.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResolvedGatewayAuth } from "./auth.js";
import {
  createGatewayUser,
  getGatewayUser,
  hasGatewayUsers,
  updateGatewayUserPassword,
  updateGatewayUserTotp,
} from "../infra/auth-credentials.js";
import { audit } from "./audit-log.js";
import { clearSessionCookie, parseSessionCookie, setSessionCookie } from "./auth-cookies.js";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./auth-password.js";
import {
  createAuthSession,
  deleteAuthSession,
  deleteUserSessions,
  getAuthSession,
  getPendingTotpSession,
  promoteTotpSession,
  refreshAuthSession,
} from "./auth-sessions.js";
import {
  buildTotpUri,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  verifyBackupCode,
  verifyTotp,
} from "./auth-totp.js";
import { sendJson } from "./http-common.js";
import { resolveGatewayClientIp } from "./net.js";
import { createProgressiveRateLimiter } from "./rate-limiter.js";

/** Dynamic check — covers users created after gateway start (setup wizard, CLI). */
function isHashedMode(auth?: ResolvedGatewayAuth): boolean {
  if (auth?.mode === "password" && hasGatewayUsers()) {
    return true;
  }
  return false;
}

// --- Rate limiting (progressive) ---

const loginLimiter = createProgressiveRateLimiter();
const recoveryLimiter = createProgressiveRateLimiter();

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
  opts: { trustedProxies?: string[]; resolvedAuth?: ResolvedGatewayAuth },
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
  if (route === "/auth/revoke-all" && req.method === "POST") {
    handleRevokeAll(req, res);
    return true;
  }
  if (route === "/auth/reset-password" && req.method === "POST") {
    void handleResetPassword(req, res, opts);
    return true;
  }
  if (route === "/auth/capabilities" && req.method === "GET") {
    handleCapabilities(res, opts.resolvedAuth);
    return true;
  }
  if (route === "/auth/setup" && req.method === "POST") {
    void handleSetup(req, res, opts);
    return true;
  }
  if (route === "/auth/change-password" && req.method === "POST") {
    void handleChangePassword(req, res, opts);
    return true;
  }
  if (route === "/auth/totp/setup" && req.method === "POST") {
    void handleTotpSetup(req, res, opts);
    return true;
  }
  if (route === "/auth/totp/verify" && req.method === "POST") {
    void handleTotpVerify(req, res, opts);
    return true;
  }
  if (route === "/auth/totp/challenge" && req.method === "POST") {
    void handleTotpChallenge(req, res, opts);
    return true;
  }
  if (route === "/auth/totp/backup" && req.method === "POST") {
    void handleTotpBackup(req, res, opts);
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

  const loginRemaining = loginLimiter.check(`ip:${ip}`);
  if (loginRemaining > 0) {
    sendJson(res, 429, {
      error: {
        message: "Too many login attempts. Try again later.",
        type: "rate_limited",
        retryAfterMs: loginRemaining,
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

  loginLimiter.recordFailure(`ip:${ip}`);

  const user = getGatewayUser(username);
  // Always run scrypt to prevent user-enumeration timing oracle
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !valid) {
    audit("auth.login.failed", username, ip, {
      reason: user ? "password_mismatch" : "user_not_found",
    });
    sendJson(res, 401, {
      error: { message: "Invalid credentials", type: "unauthorized" },
    });
    return;
  }

  // Successful login — reset rate limit
  loginLimiter.reset(`ip:${ip}`);

  // 2FA check: if user has TOTP enabled, create a partial session
  if (user.totpEnabled && user.totpSecret) {
    audit("auth.login.totp_required", user.username, ip);
    const partialSession = createAuthSession({
      username: user.username,
      role: user.role,
    });
    // Mark as pending TOTP — no cookie set, no WS access
    partialSession.pendingTotpChallenge = true;
    // Short TTL for challenge (5 min)
    partialSession.expiresAt = Date.now() + 5 * 60 * 1000;
    sendJson(res, 200, {
      ok: true,
      totpRequired: true,
      challengeSessionId: partialSession.id,
    });
    return;
  }

  audit("auth.login.success", user.username, ip);

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
    const session = getAuthSession(sessionId);
    if (session) {
      audit("auth.logout", session.username, "session");
    }
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
  // Refresh sliding window on every /auth/me — proves user activity
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

function handleRevokeAll(req: IncomingMessage, res: ServerResponse): void {
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
  const count = deleteUserSessions(session.username);
  audit("auth.revoke_all", session.username, "session", { revokedCount: count });
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true, revokedCount: count });
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

// --- Reset password via recovery code (P0 — rate limited) ---

async function handleResetPassword(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { trustedProxies?: string[]; resolvedAuth?: ResolvedGatewayAuth },
): Promise<void> {
  // Only available in hashed-credentials mode
  if (!isHashedMode(opts.resolvedAuth)) {
    sendJson(res, 404, { error: { message: "Not Found", type: "not_found" } });
    return;
  }

  const ip = clientIpFromReq(req, opts.trustedProxies);

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

  const { username, recoveryCode, newPassword } = body as {
    username?: string;
    recoveryCode?: string;
    newPassword?: string;
  };
  if (
    !username ||
    typeof username !== "string" ||
    !recoveryCode ||
    typeof recoveryCode !== "string" ||
    !newPassword ||
    typeof newPassword !== "string"
  ) {
    sendJson(res, 400, {
      error: {
        message: "username, recoveryCode, and newPassword are required",
        type: "invalid_request",
      },
    });
    return;
  }

  if (newPassword.length < 8) {
    sendJson(res, 400, {
      error: { message: "Password must be at least 8 characters", type: "invalid_request" },
    });
    return;
  }

  // Progressive rate limiting: double-keyed by IP and username
  const ipKey = `recovery:ip:${ip}`;
  const userKey = `recovery:user:${username.toLowerCase()}`;
  const remaining = Math.max(recoveryLimiter.check(ipKey), recoveryLimiter.check(userKey));
  if (remaining > 0) {
    sendJson(res, 429, {
      error: {
        message: "Too many recovery attempts. Try again later.",
        type: "rate_limited",
        retryAfterMs: remaining,
      },
    });
    return;
  }

  const user = getGatewayUser(username);
  // Always run scrypt to prevent timing oracle
  const valid = await verifyPassword(recoveryCode, user?.recoveryCodeHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !valid || !user.recoveryCodeHash) {
    recoveryLimiter.recordFailure(ipKey);
    recoveryLimiter.recordFailure(userKey);
    audit("auth.recovery.failed", username, ip);
    sendJson(res, 401, {
      error: { message: "Invalid recovery code", type: "unauthorized" },
    });
    return;
  }

  // Valid recovery code — update password
  const newHash = await hashPassword(newPassword);
  updateGatewayUserPassword(username, newHash);
  recoveryLimiter.reset(ipKey);
  recoveryLimiter.reset(userKey);
  audit("auth.recovery.success", username, ip);

  sendJson(res, 200, { ok: true });
}

// --- Capabilities (feature discovery for frontend) ---

function handleCapabilities(res: ServerResponse, resolvedAuth?: ResolvedGatewayAuth): void {
  const isHashed = isHashedMode(resolvedAuth);
  // Password mode with no users yet → first-time setup required
  const needsSetup = resolvedAuth?.mode === "password" && !hasGatewayUsers();
  sendJson(res, 200, {
    authMode: resolvedAuth?.mode ?? "token",
    hasRecoveryReset: isHashed,
    has2fa: isHashed,
    hasUserManagement: isHashed,
    needsSetup,
  });
}

// --- First-time setup (creates first admin user, only when no users exist) ---

const RECOVERY_CODE_RE = /^\d{8,16}$/;

async function handleSetup(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { trustedProxies?: string[]; resolvedAuth?: ResolvedGatewayAuth },
): Promise<void> {
  // Only available in password mode when no users exist
  if (opts.resolvedAuth?.mode !== "password" || hasGatewayUsers()) {
    sendJson(res, 404, { error: { message: "Not Found", type: "not_found" } });
    return;
  }

  const ip = clientIpFromReq(req, opts.trustedProxies);

  // Rate limit to prevent brute-force race
  const ipKey = `setup:ip:${ip}`;
  const remaining = loginLimiter.check(ipKey);
  if (remaining > 0) {
    sendJson(res, 429, {
      error: {
        message: "Too many attempts. Try again later.",
        type: "rate_limited",
        retryAfterMs: remaining,
      },
    });
    return;
  }

  let body: unknown;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: { message: "Invalid JSON body", type: "invalid_request" } });
    return;
  }

  const { username, password, recoveryCode } = body as {
    username?: string;
    password?: string;
    recoveryCode?: string;
  };

  if (!username || typeof username !== "string" || !password || typeof password !== "string") {
    sendJson(res, 400, {
      error: { message: "username and password are required", type: "invalid_request" },
    });
    return;
  }

  if (username.trim().length < 1 || username.trim().length > 64) {
    sendJson(res, 400, {
      error: { message: "Username must be 1-64 characters", type: "invalid_request" },
    });
    return;
  }

  if (password.length < 8) {
    sendJson(res, 400, {
      error: { message: "Password must be at least 8 characters", type: "invalid_request" },
    });
    return;
  }

  if (
    recoveryCode !== undefined &&
    (typeof recoveryCode !== "string" || !RECOVERY_CODE_RE.test(recoveryCode))
  ) {
    sendJson(res, 400, {
      error: { message: "Recovery code must be 8-16 digits", type: "invalid_request" },
    });
    return;
  }

  // Double-check race condition: another request may have created a user
  if (hasGatewayUsers()) {
    sendJson(res, 409, {
      error: { message: "A user already exists. Please use the login page.", type: "conflict" },
    });
    return;
  }

  const passwordHash = await hashPassword(password);
  const recoveryCodeHash = recoveryCode ? await hashPassword(recoveryCode) : undefined;

  const created = createGatewayUser({
    username: username.trim(),
    passwordHash,
    role: "admin",
    recoveryCodeHash,
  });

  if (!created) {
    sendJson(res, 409, {
      error: { message: "User already exists", type: "conflict" },
    });
    return;
  }

  audit("auth.setup.success", username.trim(), ip);

  // Auto-login: create session + set cookie
  const session = createAuthSession({ username: username.trim(), role: "admin" });
  const secure = isSecureRequest(req);
  setSessionCookie(res, session.id, { secure });

  sendJson(res, 200, {
    ok: true,
    user: { username: session.username, role: session.role, scopes: session.scopes },
    csrfToken: session.csrfToken,
  });
}

// --- Change password (authenticated users) ---

async function handleChangePassword(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { trustedProxies?: string[]; resolvedAuth?: ResolvedGatewayAuth },
): Promise<void> {
  if (!isHashedMode(opts.resolvedAuth)) {
    sendJson(res, 404, { error: { message: "Not Found", type: "not_found" } });
    return;
  }

  const sessionId = parseSessionCookie(req);
  const session = sessionId ? getAuthSession(sessionId) : null;
  if (!session) {
    sendJson(res, 401, { error: { message: "Not authenticated", type: "unauthorized" } });
    return;
  }

  let body: unknown;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: { message: "Invalid JSON body", type: "invalid_request" } });
    return;
  }

  const { currentPassword, newPassword } = body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (
    !currentPassword ||
    typeof currentPassword !== "string" ||
    !newPassword ||
    typeof newPassword !== "string"
  ) {
    sendJson(res, 400, {
      error: { message: "currentPassword and newPassword are required", type: "invalid_request" },
    });
    return;
  }

  if (newPassword.length < 8) {
    sendJson(res, 400, {
      error: { message: "New password must be at least 8 characters", type: "invalid_request" },
    });
    return;
  }

  const user = getGatewayUser(session.username);
  const valid = await verifyPassword(currentPassword, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !valid) {
    const ip = clientIpFromReq(req, opts.trustedProxies);
    audit("auth.password_change.failed", session.username, ip, {
      reason: "wrong_current_password",
    });
    sendJson(res, 401, {
      error: { message: "Current password is incorrect", type: "unauthorized" },
    });
    return;
  }

  const newHash = await hashPassword(newPassword);
  updateGatewayUserPassword(session.username, newHash);

  const ip = clientIpFromReq(req, opts.trustedProxies);
  audit("auth.password_changed", session.username, ip);

  sendJson(res, 200, { ok: true });
}

// --- TOTP endpoints (P3a — only active in hashed-credentials mode) ---

async function handleTotpSetup(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { trustedProxies?: string[]; resolvedAuth?: ResolvedGatewayAuth },
): Promise<void> {
  if (!isHashedMode(opts.resolvedAuth)) {
    sendJson(res, 404, { error: { message: "Not Found", type: "not_found" } });
    return;
  }
  const sessionId = parseSessionCookie(req);
  const session = sessionId ? getAuthSession(sessionId) : null;
  if (!session) {
    sendJson(res, 401, { error: { message: "Not authenticated", type: "unauthorized" } });
    return;
  }

  const secret = generateTotpSecret();
  const uri = buildTotpUri(secret, session.username);
  const backupCodes = generateBackupCodes(10);
  const backupHashes = await hashBackupCodes(backupCodes);

  // Store secret (not yet enabled) and backup code hashes
  updateGatewayUserTotp(session.username, {
    totpSecret: secret,
    backupCodeHashes: backupHashes,
  });

  audit("auth.totp.setup_started", session.username, "session");

  sendJson(res, 200, {
    ok: true,
    secret,
    uri,
    backupCodes,
  });
}

async function handleTotpVerify(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { trustedProxies?: string[]; resolvedAuth?: ResolvedGatewayAuth },
): Promise<void> {
  if (!isHashedMode(opts.resolvedAuth)) {
    sendJson(res, 404, { error: { message: "Not Found", type: "not_found" } });
    return;
  }
  const sessionId = parseSessionCookie(req);
  const session = sessionId ? getAuthSession(sessionId) : null;
  if (!session) {
    sendJson(res, 401, { error: { message: "Not authenticated", type: "unauthorized" } });
    return;
  }

  let body: unknown;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: { message: "Invalid JSON body", type: "invalid_request" } });
    return;
  }

  const { code } = body as { code?: string };
  if (!code || typeof code !== "string") {
    sendJson(res, 400, { error: { message: "code is required", type: "invalid_request" } });
    return;
  }

  const user = getGatewayUser(session.username);
  if (!user?.totpSecret) {
    sendJson(res, 400, { error: { message: "TOTP setup not started", type: "invalid_request" } });
    return;
  }

  const matched = verifyTotp(user.totpSecret, code);
  if (!matched) {
    sendJson(res, 401, { error: { message: "Invalid TOTP code", type: "unauthorized" } });
    return;
  }

  // Enable TOTP
  updateGatewayUserTotp(session.username, {
    totpEnabled: true,
    lastUsedTotpCode: matched,
  });

  audit("auth.totp.enabled", session.username, "session");
  sendJson(res, 200, { ok: true });
}

async function handleTotpChallenge(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { trustedProxies?: string[]; resolvedAuth?: ResolvedGatewayAuth },
): Promise<void> {
  if (!isHashedMode(opts.resolvedAuth)) {
    sendJson(res, 404, { error: { message: "Not Found", type: "not_found" } });
    return;
  }

  let body: unknown;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: { message: "Invalid JSON body", type: "invalid_request" } });
    return;
  }

  const { challengeSessionId, code } = body as {
    challengeSessionId?: string;
    code?: string;
  };
  if (!challengeSessionId || !code) {
    sendJson(res, 400, {
      error: { message: "challengeSessionId and code are required", type: "invalid_request" },
    });
    return;
  }

  const pendingSession = getPendingTotpSession(challengeSessionId);
  if (!pendingSession) {
    sendJson(res, 401, {
      error: { message: "Challenge expired or invalid", type: "session_expired" },
    });
    return;
  }

  const user = getGatewayUser(pendingSession.username);
  if (!user?.totpSecret || !user.totpEnabled) {
    sendJson(res, 400, { error: { message: "TOTP not configured", type: "invalid_request" } });
    return;
  }

  const matched = verifyTotp(user.totpSecret, code, user.lastUsedTotpCode);
  if (!matched) {
    const ip = clientIpFromReq(req, opts.trustedProxies);
    audit("auth.totp.challenge_failed", pendingSession.username, ip);
    sendJson(res, 401, { error: { message: "Invalid TOTP code", type: "unauthorized" } });
    return;
  }

  // Update anti-replay
  updateGatewayUserTotp(pendingSession.username, { lastUsedTotpCode: matched });

  // Promote to full session
  const fullSession = promoteTotpSession(challengeSessionId);
  if (!fullSession) {
    sendJson(res, 401, { error: { message: "Session promotion failed", type: "session_expired" } });
    return;
  }

  const ip = clientIpFromReq(req, opts.trustedProxies);
  audit("auth.login.success", fullSession.username, ip, { method: "totp" });

  const secure = isSecureRequest(req);
  setSessionCookie(res, fullSession.id, { secure });

  sendJson(res, 200, {
    ok: true,
    user: {
      username: fullSession.username,
      role: fullSession.role,
      scopes: fullSession.scopes,
    },
    csrfToken: fullSession.csrfToken,
  });
}

async function handleTotpBackup(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { trustedProxies?: string[]; resolvedAuth?: ResolvedGatewayAuth },
): Promise<void> {
  if (!isHashedMode(opts.resolvedAuth)) {
    sendJson(res, 404, { error: { message: "Not Found", type: "not_found" } });
    return;
  }

  let body: unknown;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: { message: "Invalid JSON body", type: "invalid_request" } });
    return;
  }

  const { challengeSessionId, backupCode } = body as {
    challengeSessionId?: string;
    backupCode?: string;
  };
  if (!challengeSessionId || !backupCode) {
    sendJson(res, 400, {
      error: {
        message: "challengeSessionId and backupCode are required",
        type: "invalid_request",
      },
    });
    return;
  }

  const pendingSession = getPendingTotpSession(challengeSessionId);
  if (!pendingSession) {
    sendJson(res, 401, {
      error: { message: "Challenge expired or invalid", type: "session_expired" },
    });
    return;
  }

  const user = getGatewayUser(pendingSession.username);
  if (!user?.backupCodeHashes?.length) {
    sendJson(res, 400, {
      error: { message: "No backup codes configured", type: "invalid_request" },
    });
    return;
  }

  const matchedIdx = await verifyBackupCode(backupCode, user.backupCodeHashes);
  if (matchedIdx === -1) {
    const ip = clientIpFromReq(req, opts.trustedProxies);
    audit("auth.totp.backup_failed", pendingSession.username, ip);
    sendJson(res, 401, { error: { message: "Invalid backup code", type: "unauthorized" } });
    return;
  }

  // Remove used backup code
  const remaining = [...user.backupCodeHashes];
  remaining.splice(matchedIdx, 1);
  updateGatewayUserTotp(pendingSession.username, { backupCodeHashes: remaining });

  // Promote to full session
  const fullSession = promoteTotpSession(challengeSessionId);
  if (!fullSession) {
    sendJson(res, 401, { error: { message: "Session promotion failed", type: "session_expired" } });
    return;
  }

  const ip = clientIpFromReq(req, opts.trustedProxies);
  audit("auth.login.success", fullSession.username, ip, { method: "backup_code" });

  const secure = isSecureRequest(req);
  setSessionCookie(res, fullSession.id, { secure });

  sendJson(res, 200, {
    ok: true,
    user: {
      username: fullSession.username,
      role: fullSession.role,
      scopes: fullSession.scopes,
    },
    csrfToken: fullSession.csrfToken,
    remainingBackupCodes: remaining.length,
  });
}

/** Reset rate limiting state (for tests). */
export function resetRateLimitsForTest(): void {
  loginLimiter.resetAll();
  recoveryLimiter.resetAll();
}
