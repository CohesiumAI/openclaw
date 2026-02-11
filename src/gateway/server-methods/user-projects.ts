/**
 * Gateway WS handlers for user projects sync.
 * Username is resolved from the authenticated session — never from client params.
 */

import type { GatewayWsClient } from "../server/ws-types.js";
import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  putProjectFile,
  getProjectFile,
  removeProjectFiles,
} from "../user-projects.js";

/** Resolve the authenticated username from the WS client (set during handshake). */
function resolveAuthUser(client: GatewayRequestHandlerOptions["client"]): string | null {
  const wsClient = client as unknown as GatewayWsClient | null;
  return wsClient?.authUser?.trim() || null;
}

function requireAuth(
  client: GatewayRequestHandlerOptions["client"],
  respond: GatewayRequestHandlerOptions["respond"],
): string | null {
  const username = resolveAuthUser(client);
  if (!username) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "password authentication required"),
    );
    return null;
  }
  return username;
}

export const userProjectsHandlers: GatewayRequestHandlers = {
  "user.projects.list": ({ client, respond }) => {
    const username = requireAuth(client, respond);
    if (!username) {
      return;
    }
    respond(true, { projects: listProjects(username) }, undefined);
  },

  "user.projects.create": ({ params, client, respond }) => {
    const username = requireAuth(client, respond);
    if (!username) {
      return;
    }
    const id = typeof params.id === "string" ? params.id.trim() : "";
    const name = typeof params.name === "string" ? params.name.trim() : "";
    const color = typeof params.color === "string" ? params.color.trim() : "#888";
    const sessionKeys = Array.isArray(params.sessionKeys) ? params.sessionKeys : [];
    if (!id || !name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id and name required"));
      return;
    }
    const project = createProject(username, { id, name, color, sessionKeys });
    if (!project) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "project create failed (duplicate id or invalid)"),
      );
      return;
    }
    respond(true, { project }, undefined);
  },

  "user.projects.update": ({ params, client, respond }) => {
    const username = requireAuth(client, respond);
    if (!username) {
      return;
    }
    const projectId = typeof params.projectId === "string" ? params.projectId.trim() : "";
    if (!projectId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "projectId required"));
      return;
    }
    const patch: Record<string, unknown> = {};
    if (typeof params.name === "string") {
      patch.name = params.name;
    }
    if (typeof params.color === "string") {
      patch.color = params.color;
    }
    if (Array.isArray(params.sessionKeys)) {
      patch.sessionKeys = params.sessionKeys;
    }
    const project = updateProject(username, projectId, patch);
    if (!project) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "project not found or invalid id"),
      );
      return;
    }
    respond(true, { project }, undefined);
  },

  "user.projects.delete": ({ params, client, respond }) => {
    const username = requireAuth(client, respond);
    if (!username) {
      return;
    }
    const projectId = typeof params.projectId === "string" ? params.projectId.trim() : "";
    if (!projectId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "projectId required"));
      return;
    }
    const ok = deleteProject(username, projectId);
    respond(true, { ok, projectId }, undefined);
  },

  "user.projects.files.put": ({ params, client, respond }) => {
    const username = requireAuth(client, respond);
    if (!username) {
      return;
    }
    const projectId = typeof params.projectId === "string" ? params.projectId.trim() : "";
    const fileId = typeof params.fileId === "string" ? params.fileId.trim() : "";
    const fileName = typeof params.fileName === "string" ? params.fileName : "file";
    const dataUrl = typeof params.dataUrl === "string" ? params.dataUrl : "";
    const mimeType = typeof params.mimeType === "string" ? params.mimeType : undefined;
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;
    if (!projectId || !fileId || !dataUrl) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "projectId, fileId, and dataUrl required"),
      );
      return;
    }
    const meta = putProjectFile(username, projectId, {
      fileId,
      fileName,
      dataUrl,
      mimeType,
      sessionKey,
    });
    if (!meta) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "file put failed (invalid id, project not found, or size exceeded)",
        ),
      );
      return;
    }
    respond(true, { file: meta }, undefined);
  },

  "user.projects.files.get": ({ params, client, respond }) => {
    const username = requireAuth(client, respond);
    if (!username) {
      return;
    }
    const projectId = typeof params.projectId === "string" ? params.projectId.trim() : "";
    const fileId = typeof params.fileId === "string" ? params.fileId.trim() : "";
    if (!projectId || !fileId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "projectId and fileId required"),
      );
      return;
    }
    const file = getProjectFile(username, projectId, fileId);
    if (!file) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "file not found"));
      return;
    }
    respond(true, file, undefined);
  },

  "user.projects.files.delete": ({ params, client, respond }) => {
    const username = requireAuth(client, respond);
    if (!username) {
      return;
    }
    const projectId = typeof params.projectId === "string" ? params.projectId.trim() : "";
    const fileIds = Array.isArray(params.fileIds)
      ? params.fileIds.filter((id): id is string => typeof id === "string")
      : [];
    if (!projectId || fileIds.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "projectId and fileIds required"),
      );
      return;
    }
    const removed = removeProjectFiles(username, projectId, fileIds);
    respond(true, { removed }, undefined);
  },
};
