import type { GatewayUserRole } from "../../infra/auth-credentials.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import type { GatewayWsClient } from "../server/ws-types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlerOptions, RespondFn } from "./types.js";

export type AuthIdentity = { username: string; role: GatewayUserRole };

/** Resolve the authenticated user identity from the WS client. Returns null if no auth user (token mode, CLI, node). */
export function resolveAuthIdentity(
  client: GatewayRequestHandlerOptions["client"],
): AuthIdentity | null {
  const wsClient = client as unknown as GatewayWsClient | null;
  const username = wsClient?.authUser?.trim();
  if (!username) return null;
  return { username, role: wsClient?.authRole ?? "operator" };
}

/** Returns true when no per-user filtering should apply (token mode only — no authenticated user). */
export function canSeeAllSessions(
  client: GatewayRequestHandlerOptions["client"],
): boolean {
  const id = resolveAuthIdentity(client);
  return !id; // true only in token mode (no authenticated user) — admins use admin.sessions.list
}

/**
 * Returns true if the client is allowed to access the given session entry.
 * If not allowed, sends a FORBIDDEN error response and returns false.
 */
export function assertSessionOwnership(params: {
  client: GatewayRequestHandlerOptions["client"];
  entry: SessionEntry | undefined;
  respond: RespondFn;
}): boolean {
  const id = resolveAuthIdentity(params.client);
  if (!id) return true; // token mode — no restriction
  if (id.role === "admin") return true;
  if (!params.entry?.ownerId) return true; // legacy session without owner — accessible to all
  if (params.entry.ownerId === id.username) return true;
  params.respond(
    false,
    undefined,
    errorShape(ErrorCodes.FORBIDDEN, "session belongs to another user"),
  );
  return false;
}

/** Filter a session store to only include sessions owned by (or unowned/legacy) the given user. */
export function filterStoreByOwner(
  store: Record<string, SessionEntry>,
  username: string,
): Record<string, SessionEntry> {
  const filtered: Record<string, SessionEntry> = {};
  for (const [key, entry] of Object.entries(store)) {
    if (!entry.ownerId || entry.ownerId === username) {
      filtered[key] = entry;
    }
  }
  return filtered;
}
