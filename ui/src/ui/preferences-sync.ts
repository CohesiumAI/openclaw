/**
 * Sync user preferences between localStorage (local) and gateway (server).
 *
 * - On connect: fetch server prefs, merge with local, push back if local had changes
 * - On settings change: debounced push to server
 * - Falls back to localStorage-only if gateway is disconnected or auth is not password-based
 */

import type { GatewayBrowserClient } from "./gateway.ts";
import type { UiSettings } from "./storage.ts";
import { saveSettings } from "./storage.ts";

/** Keys that are synced to the server (excludes device-local fields). */
const SYNCED_KEYS = [
  "theme",
  "chatFocusMode",
  "chatShowThinking",
  "chatStreamResponses",
  "chatRenderMarkdown",
  "splitRatio",
  "navCollapsed",
  "navGroupsCollapsed",
  "showDefaultWebSession",
  "sessionsActiveMinutes",
  "ttsAutoPlay",
  "maxAttachmentMb",
  "pinnedSessionKeys",
  "archivedSessionKeys",
] as const;

type SyncedKey = (typeof SYNCED_KEYS)[number];

type ServerPreferences = Record<string, unknown>;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 600;

/** Extract only the synced fields from UiSettings. */
function extractSyncedFields(settings: UiSettings): Record<SyncedKey, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of SYNCED_KEYS) {
    result[key] = settings[key];
  }
  return result as Record<SyncedKey, unknown>;
}

/**
 * On successful gateway connect: fetch server preferences and merge.
 * Local values take precedence for the first sync (migration),
 * then server values take precedence on subsequent loads.
 */
export async function syncPreferencesOnConnect(params: {
  client: GatewayBrowserClient;
  settings: UiSettings;
  applySettings: (next: UiSettings) => void;
}): Promise<void> {
  const { client, settings, applySettings } = params;
  try {
    const res = await client.request<{
      preferences?: ServerPreferences;
      defaults?: ServerPreferences;
    }>("user.preferences.get", {});
    if (!res?.preferences) {
      // Server has no prefs yet — push local as initial sync
      await pushPreferences(client, settings);
      return;
    }

    // Merge: server values win for synced keys (server is source of truth)
    const serverPrefs = res.preferences;
    const merged = { ...settings };
    for (const key of SYNCED_KEYS) {
      if (key in serverPrefs && serverPrefs[key] !== undefined) {
        (merged as Record<string, unknown>)[key] = serverPrefs[key];
      }
    }
    applySettings(merged);
    saveSettings(merged);
  } catch {
    // Gateway doesn't support prefs (older version) or not password-authenticated — ignore
  }
}

/** Push current settings to server (fire-and-forget). */
async function pushPreferences(
  client: GatewayBrowserClient,
  settings: UiSettings,
): Promise<void> {
  try {
    await client.request("user.preferences.set", {
      preferences: extractSyncedFields(settings),
    });
  } catch {
    // Best-effort — server may not support this method yet
  }
}

/** Debounced push: call this on every settings change. */
export function schedulePrefSync(
  client: GatewayBrowserClient | null,
  settings: UiSettings,
): void {
  if (!client) {
    return;
  }
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void pushPreferences(client, settings);
  }, DEBOUNCE_MS);
}
