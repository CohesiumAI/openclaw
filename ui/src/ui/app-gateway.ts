import type { EventLogEntry } from "./app-events.ts";
import type { OpenClawApp } from "./app.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { GatewayEventFrame, GatewayHelloOk } from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import type { UiSettings } from "./storage.ts";
import type { AgentsListResult, PresenceEntry, HealthSnapshot, StatusSummary } from "./types.ts";
import { getSessionsActiveMinutes, flushChatQueueForEvent, patchSessionLabel } from "./app-chat.ts";
import {
  applySettings,
  loadCron,
  refreshActiveTab,
  setLastActiveSessionKey,
} from "./app-settings.ts";
import { handleAgentEvent, resetToolStream, type AgentEventPayload } from "./app-tool-stream.ts";
import { readAloud } from "./app-tts.ts";
import { extractText } from "./chat/message-extract.ts";
import { loadAgents } from "./controllers/agents.ts";
import { loadAssistantIdentity } from "./controllers/assistant-identity.ts";
import { loadChatCommands } from "./controllers/chat-commands.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import { handleChatEvent, type ChatEventPayload } from "./controllers/chat.ts";
import { loadDevices } from "./controllers/devices.ts";
import {
  addExecApproval,
  parseExecApprovalRequested,
  parseExecApprovalResolved,
  removeExecApproval,
} from "./controllers/exec-approval.ts";
import { loadModels } from "./controllers/models.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadSessions } from "./controllers/sessions.ts";
import { loadSkills } from "./controllers/skills.ts";
import { GatewayBrowserClient } from "./gateway.ts";
import { syncPreferencesOnConnect } from "./preferences-sync.ts";
import { syncProjectsOnConnect } from "./projects-sync.ts";

type GatewayHost = {
  settings: UiSettings;
  password: string;
  client: GatewayBrowserClient | null;
  connected: boolean;
  hello: GatewayHelloOk | null;
  lastError: string | null;
  onboarding?: boolean;
  eventLogBuffer: EventLogEntry[];
  eventLog: EventLogEntry[];
  tab: Tab;
  presenceEntries: PresenceEntry[];
  presenceError: string | null;
  presenceStatus: StatusSummary | null;
  agentsLoading: boolean;
  agentsList: AgentsListResult | null;
  agentsError: string | null;
  debugHealth: HealthSnapshot | null;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  sessionKey: string;
  chatRunId: string | null;
  refreshSessionsAfterChat: Set<string>;
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalError: string | null;
};

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
  mainKey?: string;
  mainSessionKey?: string;
  scope?: string;
};

function normalizeSessionKeyForDefaults(
  value: string | undefined,
  defaults: SessionDefaultsSnapshot,
): string {
  const raw = (value ?? "").trim();
  const mainSessionKey = defaults.mainSessionKey?.trim();
  if (!mainSessionKey) {
    return raw;
  }
  if (!raw) {
    return mainSessionKey;
  }
  const mainKey = defaults.mainKey?.trim() || "main";
  const defaultAgentId = defaults.defaultAgentId?.trim();
  const isAlias =
    raw === "main" ||
    raw === mainKey ||
    (defaultAgentId &&
      (raw === `agent:${defaultAgentId}:main` || raw === `agent:${defaultAgentId}:${mainKey}`));
  return isAlias ? mainSessionKey : raw;
}

function applySessionDefaults(host: GatewayHost, defaults?: SessionDefaultsSnapshot) {
  if (!defaults?.mainSessionKey) {
    return;
  }
  const resolvedSessionKey = normalizeSessionKeyForDefaults(host.sessionKey, defaults);
  const resolvedSettingsSessionKey = normalizeSessionKeyForDefaults(
    host.settings.sessionKey,
    defaults,
  );
  const resolvedLastActiveSessionKey = normalizeSessionKeyForDefaults(
    host.settings.lastActiveSessionKey,
    defaults,
  );
  const nextSessionKey = resolvedSessionKey || resolvedSettingsSessionKey || host.sessionKey;
  const nextSettings = {
    ...host.settings,
    sessionKey: resolvedSettingsSessionKey || nextSessionKey,
    lastActiveSessionKey: resolvedLastActiveSessionKey || nextSessionKey,
  };
  const shouldUpdateSettings =
    nextSettings.sessionKey !== host.settings.sessionKey ||
    nextSettings.lastActiveSessionKey !== host.settings.lastActiveSessionKey;
  if (nextSessionKey !== host.sessionKey) {
    host.sessionKey = nextSessionKey;
  }
  if (shouldUpdateSettings) {
    applySettings(host as unknown as Parameters<typeof applySettings>[0], nextSettings);
  }
}

export function connectGateway(host: GatewayHost) {
  host.lastError = null;
  host.hello = null;
  host.connected = false;
  host.execApprovalQueue = [];
  host.execApprovalError = null;

  host.client?.stop();
  host.client = new GatewayBrowserClient({
    url: host.settings.gatewayUrl,
    token: host.settings.token.trim() ? host.settings.token : undefined,
    password: host.password.trim() ? host.password : undefined,
    clientName: "openclaw-control-ui",
    mode: "webchat",
    onHello: (hello) => {
      host.connected = true;
      host.lastError = null;
      host.hello = hello;
      applySnapshot(host, hello);
      // Reset orphaned chat run state from before disconnect.
      // Any in-flight run's final event was lost during the disconnect window.
      host.chatRunId = null;
      (host as unknown as { chatStream: string | null }).chatStream = null;
      (host as unknown as { chatStreamStartedAt: number | null }).chatStreamStartedAt = null;
      resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
      void loadAssistantIdentity(host as unknown as OpenClawApp);
      void loadAgents(host as unknown as OpenClawApp);
      void loadNodes(host as unknown as OpenClawApp, { quiet: true });
      void loadDevices(host as unknown as OpenClawApp, { quiet: true });
      void loadModels(host as unknown as OpenClawApp);
      void loadSkills(host as unknown as OpenClawApp);
      void loadChatCommands(host as unknown as OpenClawApp);
      void refreshActiveTab(host as unknown as Parameters<typeof refreshActiveTab>[0]);
      // Sync user data from server (merge server → local on connect)
      if (host.client) {
        const syncClient = host.client;
        const syncApply = (next: UiSettings) =>
          applySettings(host as unknown as Parameters<typeof applySettings>[0], next);
        void syncPreferencesOnConnect({
          client: syncClient,
          settings: host.settings,
          applySettings: syncApply,
        });
        void syncProjectsOnConnect({
          client: syncClient,
          settings: host.settings,
          applySettings: syncApply,
        });
      }
    },
    onClose: ({ code, reason }) => {
      host.connected = false;
      // Code 1012 = Service Restart (expected during config saves, don't show as error)
      if (code !== 1012) {
        host.lastError = `disconnected (${code}): ${reason || "no reason"}`;
      }
    },
    onEvent: (evt) => handleGatewayEvent(host, evt),
    onGap: ({ expected, received }) => {
      // Show gap as a transient warning, not a persistent error
      const msg = `event gap detected (expected seq ${expected}, got ${received}); refresh recommended`;
      console.warn(`[gateway] ${msg}`);
      host.lastError = msg;
      setTimeout(() => {
        if (host.lastError === msg) {
          host.lastError = null;
        }
      }, 5000);
    },
  });
  host.client.start();
}

export function handleGatewayEvent(host: GatewayHost, evt: GatewayEventFrame) {
  try {
    handleGatewayEventUnsafe(host, evt);
  } catch (err) {
    console.error("[gateway] handleGatewayEvent error:", evt.event, err);
  }
}

function handleGatewayEventUnsafe(host: GatewayHost, evt: GatewayEventFrame) {
  host.eventLogBuffer = [
    { ts: Date.now(), event: evt.event, payload: evt.payload },
    ...host.eventLogBuffer,
  ].slice(0, 250);
  if (host.tab === "debug") {
    host.eventLog = host.eventLogBuffer;
  }

  if (evt.event === "agent") {
    if (host.onboarding) {
      return;
    }
    handleAgentEvent(
      host as unknown as Parameters<typeof handleAgentEvent>[0],
      evt.payload as AgentEventPayload | undefined,
    );
    return;
  }

  if (evt.event === "chat") {
    const payload = evt.payload as ChatEventPayload | undefined;
    if (payload?.sessionKey) {
      setLastActiveSessionKey(
        host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
        payload.sessionKey,
      );
    }
    const app = host as unknown as OpenClawApp;
    const state = handleChatEvent(app, payload);
    // Live sidebar preview: update sessionsPreview from any delta (including cross-session)
    if (payload?.state === "delta" && payload.sessionKey && payload.message) {
      const deltaText = extractText(payload.message);
      if (deltaText) {
        const previewText = deltaText.slice(0, 80);
        const prev = app.sessionsPreview.get(payload.sessionKey);
        if (prev !== previewText) {
          const next = new Map(app.sessionsPreview);
          next.set(payload.sessionKey, previewText);
          app.sessionsPreview = next;
        }
      }
    }
    if (state === "final" || state === "error" || state === "aborted") {
      // Clear active tool name on terminal states
      app.chatActiveToolName = null;
      resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
      void flushChatQueueForEvent(host as unknown as Parameters<typeof flushChatQueueForEvent>[0]);
      const runId = payload?.runId;
      if (runId && host.refreshSessionsAfterChat.has(runId)) {
        host.refreshSessionsAfterChat.delete(runId);
      }
    }
    // Clean up active run tracking on terminal states
    const isTerminal =
      payload?.state === "final" || payload?.state === "error" || payload?.state === "aborted";
    if (isTerminal && payload?.sessionKey) {
      const app = host as unknown as OpenClawApp;
      if (payload.sessionKey === app.sessionKey) {
        // Active session: clean up fully (handleChatEvent already processed it)
        app.activeRunState.delete(payload.sessionKey);
      } else {
        // Cross-session: keep messages for merge on switch-back, but clear run info
        // so we don't restore a stale streaming indicator
        const saved = app.activeRunState.get(payload.sessionKey);
        if (saved) {
          saved.runId = "";
          saved.stream = null;
          saved.toolName = null;
        }
      }
    }
    // Cross-session final: event came from a session we're no longer viewing
    const isCrossSession = state === null && payload?.state === "final";
    // TTS auto-play: read aloud the final assistant response on the active session
    if (state === "final" && host.settings.ttsAutoPlay) {
      const messages = app.chatMessages;
      // Find last assistant message
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i] as Record<string, unknown> | undefined;
        if (msg && (msg.role === "assistant" || msg.role === "model")) {
          const text = extractText(msg);
          if (text) {
            void readAloud(app, text);
          }
          break;
        }
      }
    }
    if (state === "aborted") {
      // Delayed reload: give the backend time to persist the user message
      // before syncing. Immediate reload races with the async transcript write.
      const abortedApp = host as unknown as OpenClawApp;
      const abortedSession = abortedApp.sessionKey;
      setTimeout(() => {
        // Only reload if the user is still on the same session
        if (abortedApp.sessionKey === abortedSession) {
          void loadChatHistory(abortedApp);
        }
      }, 3000);
      void loadSessions(abortedApp, {
        activeMinutes: getSessionsActiveMinutes(host.settings),
      });
    }
    if (state === "error") {
      // Don't reload history immediately — handleChatEvent already added an
      // inline error message. Reloading would overwrite it before the user sees it.
      // Error state — handleChatEvent already added inline error, skip reload
    }
    if (state === "final" || isCrossSession) {
      // Always refresh session list so sidebar reflects updatedAt / new sessions
      void loadSessions(host as unknown as OpenClawApp, {
        activeMinutes: getSessionsActiveMinutes(host.settings),
      });
      if (isCrossSession && payload?.sessionKey) {
        // Auto-title the other session without touching current chatMessages
        void maybeAutoTitleSession(host as unknown as OpenClawApp, payload.sessionKey);
      } else {
        // Active session: reload history then auto-title
        void loadChatHistory(host as unknown as OpenClawApp).then(() =>
          maybeAutoTitleSession(host as unknown as OpenClawApp),
        );
      }
      // Refresh skills so the popover reflects any install/remove during chat
      void loadSkills(host as unknown as OpenClawApp);
    }
    return;
  }

  if (evt.event === "presence") {
    const payload = evt.payload as { presence?: PresenceEntry[] } | undefined;
    if (payload?.presence && Array.isArray(payload.presence)) {
      host.presenceEntries = payload.presence;
      host.presenceError = null;
      host.presenceStatus = null;
    }
    return;
  }

  if (evt.event === "cron" && host.tab === "cron") {
    void loadCron(host as unknown as Parameters<typeof loadCron>[0]);
  }

  if (evt.event === "device.pair.requested" || evt.event === "device.pair.resolved") {
    void loadDevices(host as unknown as OpenClawApp, { quiet: true });
  }

  if (evt.event === "exec.approval.requested") {
    const entry = parseExecApprovalRequested(evt.payload);
    if (entry) {
      host.execApprovalQueue = addExecApproval(host.execApprovalQueue, entry);
      host.execApprovalError = null;
      const delay = Math.max(0, entry.expiresAtMs - Date.now() + 500);
      window.setTimeout(() => {
        host.execApprovalQueue = removeExecApproval(host.execApprovalQueue, entry.id);
      }, delay);
    }
    return;
  }

  if (evt.event === "exec.approval.resolved") {
    const resolved = parseExecApprovalResolved(evt.payload);
    if (resolved) {
      host.execApprovalQueue = removeExecApproval(host.execApprovalQueue, resolved.id);
    }
  }
}

/** Derive a short title (≤50 chars, word-boundary trimmed) from text — fallback when LLM is unavailable */
export function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 50) return clean;
  const cut = clean.slice(0, 50);
  const last = cut.lastIndexOf(" ");
  return (last > 20 ? cut.slice(0, last) : cut) + "…";
}

const NEW_CONVERSATION_LABEL = "New conversation";
const NEW_CHAT_LABEL = "New chat";

/** /new system prompt prefix — skip these when looking for the first real user message */
const NEW_SESSION_PREFIX = "A new session was started via /new";

type ChatContentPart = { type?: string; text?: string };
type ChatMessage = { role?: string; content?: ChatContentPart[] };

/**
 * After a chat exchange completes, auto-title sessions that have no label
 * or still carry the default "New conversation" label.
 * - No real user message yet → set "New conversation"
 * - Real user message exists → derive short title from it
 */
async function maybeAutoTitleSession(app: OpenClawApp, targetSessionKey?: string) {
  if (!app.client || !app.connected) return;

  const sessionKey = targetSessionKey ?? app.sessionKey;
  const session = app.sessionsResult?.sessions?.find((s) => s.key === sessionKey);
  const currentLabel = session?.label ?? "";
  const currentDisplayName = session?.displayName ?? "";
  // Quick check: "New chat", "New chat N", "New conversation", or empty
  const isStockPlaceholder = (v: string) =>
    !v || v === NEW_CONVERSATION_LABEL || v === NEW_CHAT_LABEL || /^New chat \d+$/.test(v);
  // Skip sessions that clearly aren't web-created (e.g. "main")
  if (!sessionKey.includes(":web-") && currentLabel) return;

  // For cross-session titling, fetch history from gateway instead of using app.chatMessages
  let msgs: ChatMessage[];
  if (targetSessionKey && targetSessionKey !== app.sessionKey) {
    try {
      const res = await app.client.request<{ messages?: unknown[] }>("chat.history", {
        sessionKey: targetSessionKey,
        limit: 200,
      });
      msgs = (Array.isArray(res.messages) ? res.messages : []) as ChatMessage[];
    } catch {
      return; // Can't load history — skip auto-titling
    }
  } else {
    msgs = (app.chatMessages ?? []) as ChatMessage[];
  }

  // Find first user message that isn't the /new system prompt
  const firstUserMsg = msgs.find((m) => {
    if (m.role !== "user") return false;
    const text = m.content?.find((p) => p.type === "text")?.text ?? "";
    return !text.startsWith(NEW_SESSION_PREFIX);
  });

  // Already has a non-placeholder title (e.g. immediate rename via patchSessionLabel) → skip
  if (currentLabel && !isStockPlaceholder(currentLabel)) {
    return;
  }
  if (currentDisplayName && !isStockPlaceholder(currentDisplayName)) {
    return;
  }

  let newLabel: string;
  if (!firstUserMsg) {
    if (isStockPlaceholder(currentLabel) && currentLabel) {
      return;
    }
    newLabel = NEW_CONVERSATION_LABEL;
  } else {
    const text = firstUserMsg.content?.find((p) => p.type === "text")?.text ?? "";
    if (!text.trim()) {
      return;
    }
    newLabel = deriveTitle(text);
    if (newLabel === currentLabel) {
      return;
    }
  }

  // Delegate to patchSessionLabel which handles dedup + pendingLabels + loadSessions
  await patchSessionLabel(app, sessionKey, newLabel);
}

export function applySnapshot(host: GatewayHost, hello: GatewayHelloOk) {
  const snapshot = hello.snapshot as
    | {
        presence?: PresenceEntry[];
        health?: HealthSnapshot;
        sessionDefaults?: SessionDefaultsSnapshot;
      }
    | undefined;
  if (snapshot?.presence && Array.isArray(snapshot.presence)) {
    host.presenceEntries = snapshot.presence;
  }
  if (snapshot?.health) {
    host.debugHealth = snapshot.health;
  }
  if (snapshot?.sessionDefaults) {
    applySessionDefaults(host, snapshot.sessionDefaults);
  }
}
