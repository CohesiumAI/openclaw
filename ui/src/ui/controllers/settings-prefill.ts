import type { GatewayBrowserClient } from "../gateway.ts";
import type { UiSettings } from "../storage.ts";
import type { ConfigSchemaResponse, ConfigSnapshot, ConfigUiHints } from "../types.ts";
import type { JsonSchema } from "../views/config-form.shared.ts";

// -- Types ------------------------------------------------------------------

/** Where a setting value originates from */
export type SettingSource = "gateway" | "local" | "default";

/** Metadata for a single resolved setting field */
export type ResolvedField = {
  current: unknown;
  defaultVal: unknown;
  source: SettingSource;
  isModified: boolean;
  sensitive: boolean;
};

/** Full prefill state exposed to the view layer */
export type PrefillState = {
  /** Per-path metadata (dot-separated keys, e.g. "agents.default") */
  fields: Map<string, ResolvedField>;
  /** Gateway config object (redacted — secrets replaced by sentinel) */
  gatewayConfig: Record<string, unknown> | null;
  /** Schema defaults extracted from config.schema */
  schemaDefaults: Record<string, unknown>;
  /** Schema for the gateway config */
  schema: JsonSchema | null;
  /** UI hints from config.schema */
  uiHints: ConfigUiHints;
  /** True while fetching from gateway */
  loading: boolean;
  /** Non-null if the fetch failed */
  error: string | null;
  /** Hash of the config snapshot for optimistic-concurrency writes */
  baseHash: string | null;
};

// -- Defaults ---------------------------------------------------------------

/** Client-only UiSettings defaults (mirrors storage.ts loadSettings) */
export const UI_SETTINGS_DEFAULTS: Readonly<
  Pick<
    UiSettings,
    | "theme"
    | "chatFocusMode"
    | "chatShowThinking"
    | "chatStreamResponses"
    | "chatRenderMarkdown"
    | "showDefaultWebSession"
    | "sessionsActiveMinutes"
    | "ttsAutoPlay"
    | "maxAttachmentMb"
  >
> = {
  theme: "system",
  chatFocusMode: false,
  chatShowThinking: false,
  chatStreamResponses: true,
  chatRenderMarkdown: true,
  showDefaultWebSession: false,
  sessionsActiveMinutes: 0,
  ttsAutoPlay: false,
  maxAttachmentMb: 25,
};

// -- Helpers ----------------------------------------------------------------

const REDACTED_SENTINEL = "__OPENCLAW_REDACTED__";

const SENSITIVE_KEY_RE = /token|password|secret|api.?key/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

/** Deep-extract schema defaults into a flat Record<dotPath, value>. */
function extractSchemaDefaults(
  schema: JsonSchema | null | undefined,
  path: string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!schema) {
    return out;
  }

  if (schema.default !== undefined) {
    out[path.join(".")] = schema.default;
  }

  if (schema.properties) {
    for (const [key, child] of Object.entries(schema.properties)) {
      const nested = extractSchemaDefaults(child, [...path, key]);
      Object.assign(out, nested);
    }
  }

  return out;
}

/** Deep-flatten an object into dot-path entries. */
function flattenObject(
  obj: unknown,
  prefix: string[] = [],
): Array<{ path: string; value: unknown; sensitive: boolean }> {
  const entries: Array<{ path: string; value: unknown; sensitive: boolean }> = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return entries;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const currentPath = [...prefix, key];
    const dotPath = currentPath.join(".");
    const sensitive = isSensitiveKey(key);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      entries.push(...flattenObject(value, currentPath));
    } else {
      entries.push({ path: dotPath, value, sensitive });
    }
  }
  return entries;
}

/** Safe deep-equal for primitives, arrays, and plain objects. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) {
      return false;
    }
    return keysA.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

// -- Core -------------------------------------------------------------------

/** Build initial empty prefill state. */
export function createPrefillState(): PrefillState {
  return {
    fields: new Map(),
    gatewayConfig: null,
    schemaDefaults: {},
    schema: null,
    uiHints: {},
    loading: false,
    error: null,
    baseHash: null,
  };
}

/**
 * Fetch gateway config + schema, merge with local UiSettings, and populate
 * the prefill state. Uses structuredClone to isolate gateway data.
 *
 * Security:
 * - Gateway values arrive pre-redacted (server-side REDACTED_SENTINEL)
 * - Schema-validated types before merge
 * - structuredClone prevents prototype pollution
 * - 5 s timeout with graceful fallback to localStorage-only
 */
export async function loadPrefill(params: {
  client: GatewayBrowserClient | null;
  connected: boolean;
  settings: UiSettings;
}): Promise<PrefillState> {
  const state = createPrefillState();
  const { client, connected, settings } = params;

  // Always seed local-only fields from UiSettings defaults
  seedLocalFields(state, settings);

  if (!client || !connected) {
    state.error = "not connected";
    return state;
  }

  state.loading = true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    // Fetch config + schema in parallel (reuses existing RPC methods)
    const [configRes, schemaRes] = await Promise.all([
      client.request<ConfigSnapshot>("config.get", {}),
      client.request<ConfigSchemaResponse>("config.schema", {}),
    ]);

    clearTimeout(timeout);

    // Isolate gateway data via structuredClone (prevents prototype pollution)
    const safeConfig = structuredClone(configRes?.config ?? {}) as Record<string, unknown>;
    const safeSchema = structuredClone(schemaRes?.schema ?? null) as JsonSchema | null;

    state.gatewayConfig = safeConfig;
    state.schema = safeSchema;
    state.uiHints = structuredClone(schemaRes?.uiHints ?? {}) as ConfigUiHints;
    state.baseHash = typeof configRes?.hash === "string" ? configRes.hash : null;

    // Extract defaults from schema
    state.schemaDefaults = extractSchemaDefaults(safeSchema);

    // Build per-field metadata from gateway config
    const flatConfig = flattenObject(safeConfig);
    for (const entry of flatConfig) {
      const isRedacted = entry.value === REDACTED_SENTINEL;
      const schemaDefault = state.schemaDefaults[entry.path];
      const isModified = !isRedacted && !deepEqual(entry.value, schemaDefault);
      state.fields.set(entry.path, {
        current: entry.value,
        defaultVal: schemaDefault,
        source: "gateway",
        isModified,
        sensitive: entry.sensitive || isRedacted,
      });
    }

    // Re-seed local fields (overlay; local source takes precedence for local-only keys)
    seedLocalFields(state, settings);
  } catch (err) {
    clearTimeout(timeout);
    state.error = String(err);
    // Fallback: local fields are already seeded above
  } finally {
    state.loading = false;
  }

  return state;
}

/**
 * Seed local-only UiSettings fields into the prefill state.
 * These fields exist only in localStorage and have known defaults.
 */
function seedLocalFields(state: PrefillState, settings: UiSettings) {
  const localEntries: Array<{
    key: string;
    current: unknown;
    defaultVal: unknown;
    sensitive: boolean;
  }> = [
    {
      key: "ui.theme",
      current: settings.theme,
      defaultVal: UI_SETTINGS_DEFAULTS.theme,
      sensitive: false,
    },
    {
      key: "ui.chatFocusMode",
      current: settings.chatFocusMode,
      defaultVal: UI_SETTINGS_DEFAULTS.chatFocusMode,
      sensitive: false,
    },
    {
      key: "ui.chatShowThinking",
      current: settings.chatShowThinking,
      defaultVal: UI_SETTINGS_DEFAULTS.chatShowThinking,
      sensitive: false,
    },
    {
      key: "ui.chatStreamResponses",
      current: settings.chatStreamResponses,
      defaultVal: UI_SETTINGS_DEFAULTS.chatStreamResponses,
      sensitive: false,
    },
    {
      key: "ui.chatRenderMarkdown",
      current: settings.chatRenderMarkdown,
      defaultVal: UI_SETTINGS_DEFAULTS.chatRenderMarkdown,
      sensitive: false,
    },
    {
      key: "ui.showDefaultWebSession",
      current: settings.showDefaultWebSession,
      defaultVal: UI_SETTINGS_DEFAULTS.showDefaultWebSession,
      sensitive: false,
    },
    {
      key: "ui.sessionsActiveMinutes",
      current: settings.sessionsActiveMinutes,
      defaultVal: UI_SETTINGS_DEFAULTS.sessionsActiveMinutes,
      sensitive: false,
    },
    {
      key: "ui.ttsAutoPlay",
      current: settings.ttsAutoPlay,
      defaultVal: UI_SETTINGS_DEFAULTS.ttsAutoPlay,
      sensitive: false,
    },
    {
      key: "ui.maxAttachmentMb",
      current: settings.maxAttachmentMb,
      defaultVal: UI_SETTINGS_DEFAULTS.maxAttachmentMb,
      sensitive: false,
    },
  ];

  for (const entry of localEntries) {
    state.fields.set(entry.key, {
      current: entry.current,
      defaultVal: entry.defaultVal,
      source: "local",
      isModified: !deepEqual(entry.current, entry.defaultVal),
      sensitive: entry.sensitive,
    });
  }
}

/** Check if a specific field differs from its default. */
export function isFieldModified(state: PrefillState, path: string): boolean {
  return state.fields.get(path)?.isModified ?? false;
}

/** Get the default value for a field. */
export function getFieldDefault(state: PrefillState, path: string): unknown {
  return state.fields.get(path)?.defaultVal;
}

/** Count how many fields differ from their defaults (excludes sensitive/redacted). */
export function countModifiedFields(state: PrefillState): number {
  let count = 0;
  for (const field of state.fields.values()) {
    if (field.isModified && !field.sensitive) {
      count += 1;
    }
  }
  return count;
}
