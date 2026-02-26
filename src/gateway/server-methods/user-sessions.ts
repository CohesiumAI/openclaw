/**
 * Gateway WS handlers for session management.
 * Username is resolved from the authenticated session — never from client params.
 */

import type { GatewayRequestHandlers } from "./types.js";
import { resolveAuthIdentity } from "./auth-identity.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { deleteUserSessions } from "../auth-sessions.js";

export const userSessionsHandlers: GatewayRequestHandlers = {
  /** Revoke all HTTP sessions for the authenticated user. */
  "user.sessions.revoke-all": ({ client, respond }) => {
    const username = resolveAuthIdentity(client)?.username;
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
