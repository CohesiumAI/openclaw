/**
 * WS handlers for E2E session transcript encryption.
 * Allows authenticated clients to fetch pending transcripts, push encrypted blobs,
 * and manage re-encryption on password change.
 */

import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { resolveStorePath } from "../../config/sessions.js";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  getPendingEncryptionEntries,
  getEncryptedEntries,
  markEncrypted,
  removeEncryptionEntry,
  loadEncryptionIndex,
} from "../encryption-index.js";
import { resolveAuthIdentity } from "./auth-identity.js";
import type { GatewayRequestHandlers } from "./types.js";

/** Resolve the sessions directory for the default agent. */
function resolveDefaultSessionsDir(): string {
  const cfg = loadConfig();
  const agentId = normalizeAgentId(resolveDefaultAgentId(cfg));
  const storeConfig = cfg.session?.store;
  const storePath = resolveStorePath(storeConfig, { agentId });
  return path.dirname(storePath);
}

/** Resolve all sessions directories (for multi-agent setups). */
function resolveAllSessionsDirs(): string[] {
  const cfg = loadConfig();
  const storeConfig = cfg.session?.store;
  const dirs = new Set<string>();

  // Default agent
  const defaultAgentId = normalizeAgentId(resolveDefaultAgentId(cfg));
  dirs.add(path.dirname(resolveStorePath(storeConfig, { agentId: defaultAgentId })));

  // Additional agents if configured
  const agents = cfg.agents;
  if (agents && typeof agents === "object") {
    for (const agentId of Object.keys(agents)) {
      try {
        const normalized = normalizeAgentId(agentId);
        dirs.add(path.dirname(resolveStorePath(storeConfig, { agentId: normalized })));
      } catch {
        // Skip invalid agent IDs
      }
    }
  }

  return [...dirs];
}

export const sessionEncryptionHandlers: GatewayRequestHandlers = {
  /**
   * Returns the list of archived transcripts pending encryption for the current user.
   */
  "sessions.encrypt.pending": ({ respond, client }) => {
    const identity = resolveAuthIdentity(client);
    if (!identity) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "authentication required"));
      return;
    }

    const pending: Array<{ filename: string; sessionsDir: string }> = [];
    for (const sessionsDir of resolveAllSessionsDirs()) {
      for (const entry of getPendingEncryptionEntries(sessionsDir, identity.username)) {
        pending.push({ filename: entry.filename, sessionsDir });
      }
    }

    respond(true, { pending: pending.map((p) => ({ filename: p.filename })) }, undefined);
  },

  /**
   * Fetch the plaintext content of a pending-encryption archived transcript.
   * The client will encrypt this and push back via sessions.encrypt.push.
   */
  "sessions.encrypt.fetch": ({ params, respond, client }) => {
    const identity = resolveAuthIdentity(client);
    if (!identity) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "authentication required"));
      return;
    }

    const filename = typeof params.filename === "string" ? params.filename.trim() : "";
    if (!filename) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "filename is required"));
      return;
    }

    // Security: prevent path traversal
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid filename"));
      return;
    }

    // Find the file across sessions directories
    for (const sessionsDir of resolveAllSessionsDirs()) {
      const entries = getPendingEncryptionEntries(sessionsDir, identity.username);
      const entry = entries.find((e) => e.filename === filename);
      if (!entry) continue;

      const filePath = path.join(sessionsDir, filename);
      if (!fs.existsSync(filePath)) {
        // File gone — remove stale index entry
        removeEncryptionEntry(sessionsDir, filename);
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "file not found"));
        return;
      }

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        respond(true, { filename, content }, undefined);
      } catch {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "failed to read file"));
      }
      return;
    }

    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "file not found"));
  },

  /**
   * Push an encrypted blob to replace the plaintext archived transcript.
   * The blob is a base64-encoded binary: [IV 12B][authTag 16B][ciphertext].
   */
  "sessions.encrypt.push": ({ params, respond, client }) => {
    const identity = resolveAuthIdentity(client);
    if (!identity) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "authentication required"));
      return;
    }

    const filename = typeof params.filename === "string" ? params.filename.trim() : "";
    const blobBase64 = typeof params.blob === "string" ? params.blob : "";

    if (!filename || !blobBase64) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "filename and blob are required"),
      );
      return;
    }

    // Security: prevent path traversal
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid filename"));
      return;
    }

    // Decode and validate blob
    let blobBuffer: Buffer;
    try {
      blobBuffer = Buffer.from(blobBase64, "base64");
    } catch {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid base64 blob"));
      return;
    }

    // Minimum size: 12 (IV) + 16 (authTag) + 1 (ciphertext) = 29 bytes
    if (blobBuffer.length < 29) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "blob too small"));
      return;
    }

    // Find and replace the file
    for (const sessionsDir of resolveAllSessionsDirs()) {
      const index = loadEncryptionIndex(sessionsDir);
      const entry = index.entries[filename];
      if (!entry || entry.ownerId !== identity.username) continue;

      const plaintextPath = path.join(sessionsDir, filename);
      const encPath = `${plaintextPath}.enc`;

      try {
        // Write encrypted blob
        fs.writeFileSync(encPath, blobBuffer);
        // Remove plaintext (if still exists)
        if (fs.existsSync(plaintextPath)) {
          fs.unlinkSync(plaintextPath);
        }
        // Update index
        markEncrypted(sessionsDir, filename);
        respond(true, { filename, encrypted: true }, undefined);
      } catch {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "failed to write encrypted file"));
      }
      return;
    }

    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "file not found in index"));
  },

  /**
   * For password change: returns all encrypted blobs for the current user.
   * The client will decrypt with old key and re-encrypt with new key.
   */
  "sessions.encrypt.reencrypt": ({ respond, client }) => {
    const identity = resolveAuthIdentity(client);
    if (!identity) {
      respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, "authentication required"));
      return;
    }

    const files: Array<{ filename: string; blob: string }> = [];
    for (const sessionsDir of resolveAllSessionsDirs()) {
      for (const entry of getEncryptedEntries(sessionsDir, identity.username)) {
        const encPath = path.join(sessionsDir, `${entry.filename}.enc`);
        if (!fs.existsSync(encPath)) continue;
        try {
          const data = fs.readFileSync(encPath);
          files.push({ filename: entry.filename, blob: data.toString("base64") });
        } catch {
          // Skip unreadable files
        }
      }
    }

    respond(true, { files }, undefined);
  },
};
