/**
 * Gateway WS handlers for per-session chat file attachments.
 * These methods don't require auth — they use the sessionKey
 * as the scope (same level of trust as chat.send/chat.history).
 */

import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  putSessionAttachment,
  listSessionAttachments,
  getSessionAttachment,
  removeSessionAttachments,
} from "../session-attachments.js";

/** Normalize the sessionKey used as storage key (use last segment after `:` if present). */
function normalizeSessionId(raw: string): string {
  // Session keys may contain colons (e.g., "main:uuid"); use the UUID part as the directory name
  const parts = raw.split(":");
  return parts[parts.length - 1] || raw;
}

export const chatFilesHandlers: GatewayRequestHandlers = {
  "chat.files.put": ({ params, respond }) => {
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
    const fileId = typeof params.fileId === "string" ? params.fileId.trim() : "";
    const fileName = typeof params.fileName === "string" ? params.fileName : "file";
    const dataUrl = typeof params.dataUrl === "string" ? params.dataUrl : "";
    const mimeType = typeof params.mimeType === "string" ? params.mimeType : undefined;
    if (!sessionKey || !fileId || !dataUrl) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey, fileId, and dataUrl required"),
      );
      return;
    }
    const sessionId = normalizeSessionId(sessionKey);
    const meta = putSessionAttachment(sessionId, { fileId, fileName, dataUrl, mimeType });
    if (!meta) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "file put failed (invalid id, size exceeded, or max files reached)",
        ),
      );
      return;
    }
    respond(true, { file: meta }, undefined);
  },

  "chat.files.list": ({ params, respond }) => {
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
    if (!sessionKey) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey required"));
      return;
    }
    const sessionId = normalizeSessionId(sessionKey);
    const files = listSessionAttachments(sessionId);
    respond(true, { files }, undefined);
  },

  "chat.files.get": ({ params, respond }) => {
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
    const fileId = typeof params.fileId === "string" ? params.fileId.trim() : "";
    if (!sessionKey || !fileId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey and fileId required"),
      );
      return;
    }
    const sessionId = normalizeSessionId(sessionKey);
    const file = getSessionAttachment(sessionId, fileId);
    if (!file) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "file not found"));
      return;
    }
    respond(true, file, undefined);
  },

  "chat.files.delete": ({ params, respond }) => {
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
    const fileIds = Array.isArray(params.fileIds)
      ? params.fileIds.filter((id): id is string => typeof id === "string")
      : [];
    if (!sessionKey || fileIds.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey and fileIds required"),
      );
      return;
    }
    const sessionId = normalizeSessionId(sessionKey);
    const removed = removeSessionAttachments(sessionId, fileIds);
    respond(true, { removed }, undefined);
  },
};
