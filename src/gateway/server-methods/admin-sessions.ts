/**
 * Admin-only session overview handler.
 * Returns metadata about all sessions grouped by owner — no content, no previews.
 */

import { loadConfig } from "../../config/config.js";
import { listGatewayUsers } from "../../infra/auth-credentials.js";
import type { GatewayUserRole } from "../../infra/auth-credentials.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { loadCombinedSessionStoreForGateway } from "../session-utils.js";
import { resolveAuthIdentity } from "./auth-identity.js";
import type { GatewayRequestHandlers } from "./types.js";

export type AdminSessionRow = {
  sessionKey: string;
  sessionId?: string;
  ownerId?: string;
  updatedAt: number | null;
  title?: string;
};

export type AdminUserRow = {
  username: string;
  role: GatewayUserRole;
  sessionCount: number;
  lastActivity: number | null;
};

export type AdminSessionsListResult = {
  ts: number;
  users: AdminUserRow[];
  unownedSessions: AdminSessionRow[];
};

export const adminSessionsHandlers: GatewayRequestHandlers = {
  "admin.sessions.list": ({ respond, client }) => {
    const identity = resolveAuthIdentity(client);
    if (!identity || identity.role !== "admin") {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "admin role required"));
      return;
    }

    const cfg = loadConfig();
    const { store } = loadCombinedSessionStoreForGateway(cfg);

    // Build per-user aggregation
    const userMap = new Map<string, { sessions: AdminSessionRow[]; lastActivity: number | null }>();
    const unownedSessions: AdminSessionRow[] = [];

    for (const [key, entry] of Object.entries(store)) {
      const row: AdminSessionRow = {
        sessionKey: key,
        sessionId: entry?.sessionId,
        ownerId: entry?.ownerId,
        updatedAt: entry?.updatedAt ?? null,
        title: entry?.label ?? entry?.displayName,
      };

      if (!entry?.ownerId) {
        unownedSessions.push(row);
        continue;
      }

      const existing = userMap.get(entry.ownerId);
      if (existing) {
        existing.sessions.push(row);
        if (row.updatedAt && (!existing.lastActivity || row.updatedAt > existing.lastActivity)) {
          existing.lastActivity = row.updatedAt;
        }
      } else {
        userMap.set(entry.ownerId, {
          sessions: [row],
          lastActivity: row.updatedAt,
        });
      }
    }

    // Merge with registered users (include users with 0 sessions)
    const registeredUsers = listGatewayUsers();
    const users: AdminUserRow[] = [];

    for (const gwUser of registeredUsers) {
      const data = userMap.get(gwUser.username);
      users.push({
        username: gwUser.username,
        role: gwUser.role,
        sessionCount: data?.sessions.length ?? 0,
        lastActivity: data?.lastActivity ?? null,
      });
      userMap.delete(gwUser.username);
    }

    // Include orphan owners (sessions with ownerId but user deleted)
    for (const [username, data] of userMap) {
      users.push({
        username,
        role: "operator", // best guess for deleted users
        sessionCount: data.sessions.length,
        lastActivity: data.lastActivity,
      });
    }

    // Sort users by lastActivity descending
    users.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));

    respond(
      true,
      {
        ts: Date.now(),
        users,
        unownedSessions,
      } satisfies AdminSessionsListResult,
      undefined,
    );
  },

  "admin.sessions.detail": ({ params, respond, client }) => {
    const identity = resolveAuthIdentity(client);
    if (!identity || identity.role !== "admin") {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "admin role required"));
      return;
    }

    const username = typeof params.username === "string" ? params.username.trim() : "";
    if (!username) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "username is required"));
      return;
    }

    const cfg = loadConfig();
    const { store } = loadCombinedSessionStoreForGateway(cfg);

    const sessions: AdminSessionRow[] = [];
    for (const [key, entry] of Object.entries(store)) {
      if (entry?.ownerId === username || (!username && !entry?.ownerId)) {
        sessions.push({
          sessionKey: key,
          sessionId: entry?.sessionId,
          ownerId: entry?.ownerId,
          updatedAt: entry?.updatedAt ?? null,
          title: entry?.label ?? entry?.displayName,
        });
      }
    }

    sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    respond(true, { ts: Date.now(), username, sessions }, undefined);
  },
};
