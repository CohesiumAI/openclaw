/**
 * Per-user preferences store.
 * Persists JSON in ~/.openclaw/user-preferences/<username>.json (mode 0o600).
 * Username is always resolved server-side from the auth session — never from client params.
 */

import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";

const PREFS_DIR = "user-preferences";

export type UserPreferences = {
  version: 1;
  theme: "light" | "dark" | "system";
  chatFocusMode: boolean;
  chatShowThinking: boolean;
  chatStreamResponses: boolean;
  chatRenderMarkdown: boolean;
  splitRatio: number;
  navCollapsed: boolean;
  navGroupsCollapsed: Record<string, boolean>;
  showDefaultWebSession: boolean;
  sessionsActiveMinutes: number;
  ttsAutoPlay: boolean;
  maxAttachmentMb: number;
  pinnedSessionKeys: string[];
  archivedSessionKeys: string[];
};

const DEFAULTS: UserPreferences = {
  version: 1,
  theme: "system",
  chatFocusMode: false,
  chatShowThinking: false,
  chatStreamResponses: true,
  chatRenderMarkdown: true,
  splitRatio: 0.6,
  navCollapsed: false,
  navGroupsCollapsed: {},
  showDefaultWebSession: false,
  sessionsActiveMinutes: 0,
  ttsAutoPlay: false,
  maxAttachmentMb: 25,
  pinnedSessionKeys: [],
  archivedSessionKeys: [],
};

/** Allowed fields and their type validators (whitelist). */
const FIELD_VALIDATORS: Record<string, (v: unknown) => boolean> = {
  theme: (v) => v === "light" || v === "dark" || v === "system",
  chatFocusMode: (v) => typeof v === "boolean",
  chatShowThinking: (v) => typeof v === "boolean",
  chatStreamResponses: (v) => typeof v === "boolean",
  chatRenderMarkdown: (v) => typeof v === "boolean",
  splitRatio: (v) => typeof v === "number" && v >= 0.2 && v <= 0.9,
  navCollapsed: (v) => typeof v === "boolean",
  navGroupsCollapsed: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  showDefaultWebSession: (v) => typeof v === "boolean",
  sessionsActiveMinutes: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
  ttsAutoPlay: (v) => typeof v === "boolean",
  maxAttachmentMb: (v) => typeof v === "number" && Number.isFinite(v) && v > 0,
  pinnedSessionKeys: (v) =>
    Array.isArray(v) && v.every((k) => typeof k === "string"),
  archivedSessionKeys: (v) =>
    Array.isArray(v) && v.every((k) => typeof k === "string"),
};

// Sanitize username for filesystem path — alphanumeric + dash/underscore only
function sanitizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

function resolvePrefsPath(username: string, stateDir?: string): string {
  const dir = stateDir ?? resolveStateDir();
  return path.join(dir, PREFS_DIR, `${sanitizeUsername(username)}.json`);
}

/** Load preferences for a user. Returns defaults for missing/invalid files. */
export function loadUserPreferences(username: string, stateDir?: string): UserPreferences {
  const filePath = resolvePrefsPath(username, stateDir);
  const raw = loadJsonFile(filePath);
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULTS };
  }
  const data = raw as Record<string, unknown>;
  if (data.version !== 1) {
    return { ...DEFAULTS };
  }
  // Merge stored values with defaults, validating each field
  const result = { ...DEFAULTS };
  for (const [key, validator] of Object.entries(FIELD_VALIDATORS)) {
    if (key in data && validator(data[key])) {
      (result as Record<string, unknown>)[key] = data[key];
    }
  }
  return result;
}

/** Save full preferences for a user. */
export function saveUserPreferences(
  username: string,
  prefs: UserPreferences,
  stateDir?: string,
): void {
  const filePath = resolvePrefsPath(username, stateDir);
  saveJsonFile(filePath, prefs);
}

/**
 * Merge-patch preferences: only update fields present in the patch.
 * Returns the full updated preferences.
 */
export function mergeUserPreferences(
  username: string,
  patch: Record<string, unknown>,
  stateDir?: string,
): UserPreferences {
  const current = loadUserPreferences(username, stateDir);
  for (const [key, value] of Object.entries(patch)) {
    const validator = FIELD_VALIDATORS[key];
    if (validator && validator(value)) {
      (current as Record<string, unknown>)[key] = value;
    }
    // Silently ignore unknown or invalid fields (defense in depth)
  }
  saveUserPreferences(username, current, stateDir);
  return current;
}

/** Get the defaults (exposed for frontend sync). */
export function getUserPreferencesDefaults(): UserPreferences {
  return { ...DEFAULTS };
}
