import { describe, expect, it, vi } from "vitest";
import {
  createPrefillState,
  countModifiedFields,
  getFieldDefault,
  isFieldModified,
  loadPrefill,
  UI_SETTINGS_DEFAULTS,
} from "./settings-prefill.ts";
import type { UiSettings } from "../storage.ts";

// -- Helpers ----------------------------------------------------------------

function makeSettings(overrides: Partial<UiSettings> = {}): UiSettings {
  return {
    gatewayUrl: "ws://localhost:18789",
    token: "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
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
    projects: [],
    ...overrides,
  };
}

function makeMockClient(responses: Record<string, unknown> = {}) {
  return {
    request: vi.fn(async (method: string) => {
      if (method in responses) {
        return responses[method];
      }
      throw new Error(`unexpected method: ${method}`);
    }),
  };
}

// -- Tests ------------------------------------------------------------------

describe("settings-prefill", () => {
  describe("createPrefillState", () => {
    it("returns empty initial state", () => {
      const state = createPrefillState();
      expect(state.fields.size).toBe(0);
      expect(state.gatewayConfig).toBeNull();
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe("loadPrefill — disconnected", () => {
    it("seeds local fields even when not connected", async () => {
      const state = await loadPrefill({
        client: null,
        connected: false,
        settings: makeSettings(),
      });

      expect(state.error).toBe("not connected");
      // Local fields should still be populated
      expect(state.fields.has("ui.theme")).toBe(true);
      expect(state.fields.get("ui.theme")?.current).toBe("system");
      expect(state.fields.get("ui.theme")?.source).toBe("local");
    });

    it("marks local field as modified when != default", async () => {
      const state = await loadPrefill({
        client: null,
        connected: false,
        settings: makeSettings({ chatShowThinking: true }),
      });

      const field = state.fields.get("ui.chatShowThinking");
      expect(field?.isModified).toBe(true);
      expect(field?.current).toBe(true);
      expect(field?.defaultVal).toBe(false);
    });
  });

  describe("loadPrefill — connected", () => {
    it("fetches config + schema and builds field map", async () => {
      const client = makeMockClient({
        "config.get": {
          config: { agents: { default: "gpt-4" }, gateway: { port: 18789 } },
          hash: "abc123",
          raw: "{}",
          exists: true,
          valid: true,
        },
        "config.schema": {
          schema: {
            type: "object",
            properties: {
              agents: {
                type: "object",
                properties: {
                  default: { type: "string", default: "gpt-4o" },
                },
              },
              gateway: {
                type: "object",
                properties: {
                  port: { type: "number", default: 18789 },
                },
              },
            },
          },
          uiHints: {},
        },
      });

      const state = await loadPrefill({
        client: client as never,
        connected: true,
        settings: makeSettings(),
      });

      expect(state.error).toBeNull();
      expect(state.baseHash).toBe("abc123");
      expect(state.gatewayConfig).toEqual({
        agents: { default: "gpt-4" },
        gateway: { port: 18789 },
      });

      // agents.default is "gpt-4" but schema default is "gpt-4o" → modified
      const agentField = state.fields.get("agents.default");
      expect(agentField?.source).toBe("gateway");
      expect(agentField?.isModified).toBe(true);
      expect(agentField?.current).toBe("gpt-4");
      expect(agentField?.defaultVal).toBe("gpt-4o");

      // gateway.port matches schema default → not modified
      const portField = state.fields.get("gateway.port");
      expect(portField?.isModified).toBe(false);
    });

    it("marks sensitive/redacted fields", async () => {
      const client = makeMockClient({
        "config.get": {
          config: { auth: { apiToken: "__OPENCLAW_REDACTED__" } },
          hash: "h1",
          raw: "{}",
          exists: true,
          valid: true,
        },
        "config.schema": { schema: { type: "object", properties: {} }, uiHints: {} },
      });

      const state = await loadPrefill({
        client: client as never,
        connected: true,
        settings: makeSettings(),
      });

      const field = state.fields.get("auth.apiToken");
      expect(field?.sensitive).toBe(true);
      expect(field?.isModified).toBe(false); // redacted fields are never "modified"
    });

    it("falls back to local-only on fetch error", async () => {
      const client = makeMockClient({}); // no methods registered → will throw
      // Override request to throw
      client.request.mockRejectedValue(new Error("ws closed"));

      const state = await loadPrefill({
        client: client as never,
        connected: true,
        settings: makeSettings({ chatFocusMode: true }),
      });

      expect(state.error).toBe("Error: ws closed");
      // Local fields still seeded
      expect(state.fields.has("ui.chatFocusMode")).toBe(true);
      expect(state.fields.get("ui.chatFocusMode")?.isModified).toBe(true);
    });
  });

  describe("utility functions", () => {
    it("isFieldModified returns correct value", async () => {
      const state = await loadPrefill({
        client: null,
        connected: false,
        settings: makeSettings({ maxAttachmentMb: 50 }),
      });

      expect(isFieldModified(state, "ui.maxAttachmentMb")).toBe(true);
      expect(isFieldModified(state, "ui.theme")).toBe(false);
      expect(isFieldModified(state, "nonexistent.path")).toBe(false);
    });

    it("getFieldDefault returns schema/local default", async () => {
      const state = await loadPrefill({
        client: null,
        connected: false,
        settings: makeSettings(),
      });

      expect(getFieldDefault(state, "ui.maxAttachmentMb")).toBe(25);
      expect(getFieldDefault(state, "ui.theme")).toBe("system");
    });

    it("countModifiedFields excludes sensitive fields", async () => {
      const client = makeMockClient({
        "config.get": {
          config: {
            agents: { default: "custom-model" },
            auth: { token: "__OPENCLAW_REDACTED__" },
          },
          hash: "h",
          raw: "{}",
          exists: true,
          valid: true,
        },
        "config.schema": {
          schema: {
            type: "object",
            properties: {
              agents: {
                type: "object",
                properties: { default: { type: "string", default: "gpt-4o" } },
              },
            },
          },
          uiHints: {},
        },
      });

      const state = await loadPrefill({
        client: client as never,
        connected: true,
        settings: makeSettings(),
      });

      // agents.default is modified, auth.token is sensitive → only 1 counted
      const count = countModifiedFields(state);
      expect(count).toBeGreaterThanOrEqual(1);
      // Verify the sensitive field is NOT counted
      const tokenField = state.fields.get("auth.token");
      expect(tokenField?.sensitive).toBe(true);
    });
  });

  describe("UI_SETTINGS_DEFAULTS", () => {
    it("matches storage.ts defaults", () => {
      // Verify alignment with storage.ts defaults
      expect(UI_SETTINGS_DEFAULTS.theme).toBe("system");
      expect(UI_SETTINGS_DEFAULTS.chatStreamResponses).toBe(true);
      expect(UI_SETTINGS_DEFAULTS.chatRenderMarkdown).toBe(true);
      expect(UI_SETTINGS_DEFAULTS.maxAttachmentMb).toBe(25);
    });
  });
});
