import type { GatewayBrowserClient } from "../gateway.ts";
import type { SessionsListResult } from "../types.ts";
import { toNumber } from "../format.ts";

type SessionsOverrides = {
  activeMinutes?: number;
  limit?: number;
  includeGlobal?: boolean;
  includeUnknown?: boolean;
};

export type SessionsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionsLoading: boolean;
  sessionsResult: SessionsListResult | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
  /** Optimistic labels awaiting gateway confirmation — survive loadSessions overwrites */
  pendingLabels: Map<string, string>;
};

// Coalesce: when a loadSessions call is in-flight, store pending overrides
// so we auto-relaunch once the current call finishes (no silent drops).
let _pendingOverrides: SessionsOverrides | null = null;
let _pendingState: SessionsState | null = null;

export async function loadSessions(state: SessionsState, overrides?: SessionsOverrides) {
  if (!state.client || !state.connected) {
    return;
  }
  // Coalesce: if already loading, schedule a follow-up instead of dropping
  if (state.sessionsLoading) {
    _pendingOverrides = overrides ?? null;
    _pendingState = state;
    return;
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  try {
    const includeGlobal = overrides?.includeGlobal ?? state.sessionsIncludeGlobal;
    const includeUnknown = overrides?.includeUnknown ?? state.sessionsIncludeUnknown;
    const activeMinutes = overrides?.activeMinutes ?? toNumber(state.sessionsFilterActive, 0);
    const limit = overrides?.limit ?? toNumber(state.sessionsFilterLimit, 0);
    const params: Record<string, unknown> = {
      includeGlobal,
      includeUnknown,
    };
    if (activeMinutes > 0) {
      params.activeMinutes = activeMinutes;
    }
    if (limit > 0) {
      params.limit = limit;
    }
    const res = await state.client.request<SessionsListResult | undefined>("sessions.list", params);
    if (res) {
      // Re-apply optimistic labels so stale gateway data doesn't overwrite renames in flight
      if (state.pendingLabels.size > 0 && res.sessions) {
        for (const s of res.sessions) {
          const pending = state.pendingLabels.get(s.key);
          if (pending !== undefined) {
            s.label = pending;
          }
        }
      }
      state.sessionsResult = res;
    }
  } catch (err) {
    state.sessionsError = String(err);
  } finally {
    state.sessionsLoading = false;
    // Drain coalesced call if one was queued while we were loading
    const nextOverrides = _pendingOverrides;
    const nextState = _pendingState;
    _pendingOverrides = null;
    _pendingState = null;
    if (nextState) {
      void loadSessions(nextState, nextOverrides ?? undefined);
    }
  }
}

export async function patchSession(
  state: SessionsState,
  key: string,
  patch: {
    label?: string | null;
    thinkingLevel?: string | null;
    verboseLevel?: string | null;
    reasoningLevel?: string | null;
    model?: string | null;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const params: Record<string, unknown> = { key };
  if ("label" in patch) {
    params.label = patch.label;
  }
  if ("thinkingLevel" in patch) {
    params.thinkingLevel = patch.thinkingLevel;
  }
  if ("verboseLevel" in patch) {
    params.verboseLevel = patch.verboseLevel;
  }
  if ("reasoningLevel" in patch) {
    params.reasoningLevel = patch.reasoningLevel;
  }
  if ("model" in patch) {
    params.model = patch.model;
  }
  try {
    await state.client.request("sessions.patch", params);
    await loadSessions(state);
  } catch (err) {
    state.sessionsError = String(err);
  }
}

export type SessionPreviewItem = {
  role: string;
  text: string;
  timestamp?: number;
};

export type SessionsPreviewEntry = {
  key: string;
  status: "ok" | "empty" | "missing" | "error";
  items: SessionPreviewItem[];
};

export type SessionsPreviewState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionsPreview: Map<string, string>;
};

/** Fetch last-message preview text for a batch of session keys */
export async function loadSessionPreviews(state: SessionsPreviewState, keys: string[]) {
  if (!state.client || !state.connected || keys.length === 0) {
    return;
  }
  try {
    const res = await state.client.request<{ previews?: SessionsPreviewEntry[] }>(
      "sessions.preview",
      { keys, limit: 1, maxChars: 80 },
    );
    if (!res?.previews) {
      return;
    }
    const next = new Map(state.sessionsPreview);
    for (const entry of res.previews) {
      if (entry.status === "ok" && entry.items.length > 0) {
        const last = entry.items[entry.items.length - 1];
        next.set(entry.key, last.text);
      }
    }
    state.sessionsPreview = next;
  } catch {
    // Best-effort; previews are non-critical
  }
}

export async function deleteSession(state: SessionsState, key: string) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.sessionsLoading) {
    return;
  }
  const confirmed = window.confirm(
    `Delete session "${key}"?\n\nDeletes the session entry and archives its transcript.`,
  );
  if (!confirmed) {
    return;
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  try {
    await state.client.request("sessions.delete", { key, deleteTranscript: true });
    await loadSessions(state);
  } catch (err) {
    state.sessionsError = String(err);
  } finally {
    state.sessionsLoading = false;
  }
}
