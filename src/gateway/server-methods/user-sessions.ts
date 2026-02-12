/**
 * Gateway WS handlers for session management.
 * Username is resolved from the authenticated session — never from client params.
 */

import type { GatewayWsClient } from "../server/ws-types.js";
import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { deleteUserSessions } from "../auth-sessions.js";

/** Resolve the authenticated username from the WS client (set during handshake). */
function resolveAuthUser(client: GatewayRequestHandlerOptions["client"]): string | null {
  const wsClient = client as unknown as GatewayWsClient | null;
  return wsClient?.authUser?.trim() || null;
}

export const userSessionsHandlers: GatewayRequestHandlers = {
  /** Revoke all HTTP sessions for the authenticated user. */
  "user.sessions.revoke-all": ({ client, respond }) => {
    const username = resolveAuthUser(client);
    if (!username) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "password authentication required"),
      );
      return;
    }
    const count = deleteUserSessions(username);
    respond(true, { revokedCount: count }, undefined);
  },
};
