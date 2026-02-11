/**
 * Gateway WS handlers for user preferences sync.
 * Username is resolved from the authenticated session — never from client params.
 */

import type { GatewayWsClient } from "../server/ws-types.js";
import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  loadUserPreferences,
  mergeUserPreferences,
  getUserPreferencesDefaults,
} from "../user-preferences.js";

/** Resolve the authenticated username from the WS client (set during handshake). */
function resolveAuthUser(client: GatewayRequestHandlerOptions["client"]): string | null {
  // authUser is set on the GatewayWsClient during the WS handshake from httpSession.username
  const wsClient = client as unknown as GatewayWsClient | null;
  return wsClient?.authUser?.trim() || null;
}

export const userPreferencesHandlers: GatewayRequestHandlers = {
  /** Return current preferences for the authenticated user. */
  "user.preferences.get": ({ client, respond }) => {
    const username = resolveAuthUser(client);
    if (!username) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "password authentication required"),
      );
      return;
    }
    const prefs = loadUserPreferences(username);
    respond(true, { preferences: prefs, defaults: getUserPreferencesDefaults() }, undefined);
  },

  /** Merge-patch preferences for the authenticated user. */
  "user.preferences.set": ({ params, client, respond }) => {
    const username = resolveAuthUser(client);
    if (!username) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "password authentication required"),
      );
      return;
    }
    if (!params || typeof params !== "object") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "params required"));
      return;
    }
    const patch = (params as Record<string, unknown>).preferences;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "preferences object required"),
      );
      return;
    }
    const updated = mergeUserPreferences(username, patch as Record<string, unknown>);
    respond(true, { preferences: updated }, undefined);
  },
};
