/**
 * Secure cookie management for gateway HTTP sessions.
 * Cookie: openclaw_session — Secure, HttpOnly, SameSite=Strict.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

const COOKIE_NAME = "openclaw_session";
const COOKIE_MAX_AGE_S = 30 * 60; // 30 minutes — matches session TTL

/** Set session cookie on response. */
export function setSessionCookie(
  res: ServerResponse,
  sessionId: string,
  opts?: { secure?: boolean },
): void {
  const secure = opts?.secure !== false;
  const parts = [
    `${COOKIE_NAME}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${COOKIE_MAX_AGE_S}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}

/** Clear session cookie. */
export function clearSessionCookie(res: ServerResponse): void {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  res.setHeader("Set-Cookie", parts.join("; "));
}

/** Parse session ID from request cookies. Returns null if absent. */
export function parseSessionCookie(req: IncomingMessage): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return null;
  }
  for (const pair of cookieHeader.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name?.trim() === COOKIE_NAME) {
      const value = rest.join("=").trim();
      return value || null;
    }
  }
  return null;
}
