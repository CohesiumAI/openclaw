import type { OpenClawApp } from "./app.ts";
import type { GatewayHelloOk } from "./gateway.ts";
import type { UiSettings } from "./storage.ts";
import type { ChatAttachment, ChatQueueItem } from "./ui-types.ts";
import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.js";
import { scheduleChatScroll } from "./app-scroll.ts";
import { setLastActiveSessionKey } from "./app-settings.ts";
import { resetToolStream } from "./app-tool-stream.ts";
import { abortChatRun, loadChatHistory, sendChatMessage } from "./controllers/chat.ts";
import { handleProjectCommand } from "./controllers/project-commands.ts";
import { loadSessionPreviews, loadSessions } from "./controllers/sessions.ts";
import { normalizeBasePath } from "./navigation.ts";
import { generateUUID } from "./uuid.ts";

export type ChatHost = {
  connected: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatQueue: ChatQueueItem[];
  chatRunId: string | null;
  chatSending: boolean;
  sessionKey: string;
  basePath: string;
  hello: GatewayHelloOk | null;
  chatAvatarUrl: string | null;
  refreshSessionsAfterChat: Set<string>;
  sessionsPreview: Map<string, string>;
  sessionSkillOverrides: Map<string, Set<string>>;
};

/** Resolve sidebar session filter from user settings (0 = no filter). */
export function getSessionsActiveMinutes(settings: UiSettings): number {
  const v = settings.sessionsActiveMinutes;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

export function isChatBusy(host: ChatHost) {
  return host.chatSending || Boolean(host.chatRunId);
}

export function isChatStopCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/stop") {
    return true;
  }
  return (
    normalized === "stop" ||
    normalized === "esc" ||
    normalized === "abort" ||
    normalized === "wait" ||
    normalized === "exit"
  );
}

function isChatResetCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/new" || normalized === "/reset") {
    return true;
  }
  return normalized.startsWith("/new ") || normalized.startsWith("/reset ");
}

export async function handleAbortChat(host: ChatHost) {
  if (!host.connected) {
    return;
  }
  host.chatMessage = "";
  await abortChatRun(host as unknown as OpenClawApp);
}

function enqueueChatMessage(
  host: ChatHost,
  text: string,
  attachments?: ChatAttachment[],
  refreshSessions?: boolean,
) {
  const trimmed = text.trim();
  const hasAttachments = Boolean(attachments && attachments.length > 0);
  if (!trimmed && !hasAttachments) {
    return;
  }
  host.chatQueue = [
    ...host.chatQueue,
    {
      id: generateUUID(),
      text: trimmed,
      createdAt: Date.now(),
      attachments: hasAttachments ? attachments?.map((att) => ({ ...att })) : undefined,
      refreshSessions,
    },
  ];
}

async function sendChatMessageNow(
  host: ChatHost,
  message: string,
  opts?: {
    previousDraft?: string;
    restoreDraft?: boolean;
    attachments?: ChatAttachment[];
    previousAttachments?: ChatAttachment[];
    restoreAttachments?: boolean;
    refreshSessions?: boolean;
  },
) {
  resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
  // Capture session key BEFORE any async work — immune to session switches
  const capturedKey = host.sessionKey;
  const app = host as unknown as OpenClawApp;

  // ── Immediate rename (synchronous) ──────────────────────────────────
  // Must happen BEFORE the await so it completes even if user switches sessions
  const session = app.sessionsResult?.sessions?.find((s) => s.key === capturedKey);
  const currentLabel = session?.label ?? "";
  const isPlaceholder = !currentLabel || NEW_CHAT_RE.test(currentLabel);
  if (isPlaceholder && message.trim()) {
    const newTitle = deriveTitle(message);
    // Optimistic UI: update sessionsResult + register in pendingLabels so
    // concurrent loadSessions calls can't overwrite with stale data
    if (session) {
      session.label = newTitle;
      app.sessionsResult = { ...app.sessionsResult! };
    }
    app.pendingLabels.set(capturedKey, newTitle);
    // Fire-and-forget — runs independently of session switches
    void patchSessionLabel(app, capturedKey, newTitle);
  }

  // ── Send message (async — may yield to session switch) ──────────────
  const overrides = host.sessionSkillOverrides.get(capturedKey);
  const skillFilter = overrides ? Array.from(overrides) : undefined;
  const runId = await sendChatMessage(
    host as unknown as OpenClawApp,
    message,
    opts?.attachments,
    skillFilter,
  );
  const ok = Boolean(runId);
  if (!ok && opts?.previousDraft != null) {
    host.chatMessage = opts.previousDraft;
  }
  if (!ok && opts?.previousAttachments) {
    host.chatAttachments = opts.previousAttachments;
  }
  if (ok) {
    setLastActiveSessionKey(
      host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
      capturedKey,
    );
  }
  if (ok && opts?.restoreDraft && opts.previousDraft?.trim()) {
    host.chatMessage = opts.previousDraft;
  }
  if (ok && opts?.restoreAttachments && opts.previousAttachments?.length) {
    host.chatAttachments = opts.previousAttachments;
  }
  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
  if (ok && !host.chatRunId) {
    void flushChatQueue(host);
  }
  if (ok && opts?.refreshSessions && runId) {
    host.refreshSessionsAfterChat.add(runId);
  }
  return ok;
}

async function flushChatQueue(host: ChatHost) {
  if (!host.connected || isChatBusy(host)) {
    return;
  }
  const [next, ...rest] = host.chatQueue;
  if (!next) {
    return;
  }
  host.chatQueue = rest;
  const ok = await sendChatMessageNow(host, next.text, {
    attachments: next.attachments,
    refreshSessions: next.refreshSessions,
  });
  if (!ok) {
    host.chatQueue = [next, ...host.chatQueue];
  }
}

export function removeQueuedMessage(host: ChatHost, id: string) {
  host.chatQueue = host.chatQueue.filter((item) => item.id !== id);
}

const NEW_CHAT_RE = /^New chat( \d+)?$/;

/** Derive a short title (≤50 chars, word-boundary trimmed) from text. */
function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 50) return clean;
  const cut = clean.slice(0, 50);
  const last = cut.lastIndexOf(" ");
  return (last > 20 ? cut.slice(0, last) : cut) + "…";
}

/** Patch a session label, skipping locally-known duplicates then retrying on server conflict. */
export async function patchSessionLabel(app: OpenClawApp, sessionKey: string, label: string) {
  if (!app.client || !app.connected) {
    app.pendingLabels.delete(sessionKey);
    return;
  }
  // Pre-check existing labels locally to skip known duplicates without round-trips
  const existing = new Set(
    (app.sessionsResult?.sessions ?? [])
      .filter((s) => s.key !== sessionKey)
      .map((s) => s.label)
      .filter(Boolean),
  );
  let candidate = label;
  let counter = 2;
  while (existing.has(candidate) && counter <= 50) {
    candidate = `${label} (${counter++})`;
  }

  // Try the pre-checked candidate, then retry once on server-side conflict
  const MAX_SERVER_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_SERVER_RETRIES; attempt++) {
    try {
      await app.client.request("sessions.patch", { key: sessionKey, label: candidate });
      app.pendingLabels.delete(sessionKey);
      // Update optimistic label if suffix was added
      if (candidate !== label) {
        const s = app.sessionsResult?.sessions?.find((x) => x.key === sessionKey);
        if (s) {
          s.label = candidate;
          app.sessionsResult = { ...app.sessionsResult! };
        }
      }
      await loadSessions(app, { activeMinutes: getSessionsActiveMinutes(app.settings) });
      const keys = app.sessionsResult?.sessions?.map((s) => s.key) ?? [];
      if (keys.length > 0) {
        void loadSessionPreviews(app, keys);
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already in use") && attempt < MAX_SERVER_RETRIES - 1) {
        candidate = `${label} (${counter++})`;
        app.pendingLabels.set(sessionKey, candidate);
        continue;
      }
      app.pendingLabels.delete(sessionKey);
      return;
    }
  }
  app.pendingLabels.delete(sessionKey);
}

/**
 * Start a new chat session: generate a fresh session key and switch to it.
 * The UI clears instantly — no /new greeting is sent so the conversation
 * starts empty. The session is persisted on the backend so it appears in
 * the sidebar immediately.
 */
export async function handleNewSession(host: ChatHost) {
  if (!host.connected) return;

  const app = host as unknown as OpenClawApp;
  if (!app.client) return;

  // Build key with the same agent prefix the gateway uses
  const defaults = (
    app.hello?.snapshot as { sessionDefaults?: { defaultAgentId?: string } } | undefined
  )?.sessionDefaults;
  const agentId = defaults?.defaultAgentId?.trim() || "main";
  const newKey = `agent:${agentId}:web-${generateUUID()}`;

  // Pick a unique "New chat" label to avoid duplicate-label rejection
  const existingLabels = new Set(
    (app.sessionsResult?.sessions ?? []).map((s) => s.label).filter(Boolean),
  );
  let label = "New chat";
  let counter = 2;
  while (existingLabels.has(label)) {
    label = `New chat ${counter++}`;
  }

  // Inherit model from current session so new chats keep the last-used model
  const currentSession = app.sessionsResult?.sessions?.find((s) => s.key === app.sessionKey);
  const inheritModel =
    currentSession?.modelProvider && currentSession?.model
      ? `${currentSession.modelProvider}/${currentSession.model}`
      : undefined;

  // Persist FIRST — so the session exists on the gateway before any
  // loadSessions triggered by setSessionKey / setTab can run
  try {
    await app.client.request("sessions.patch", {
      key: newKey,
      label,
      verboseLevel: "on",
      ...(inheritModel ? { model: inheritModel } : {}),
    });
  } catch {
    // Non-critical — session will be created on first message send
  }

  // If launched from within a project, auto-add the new session to that project
  const activeProjectId = (app as unknown as { activeProjectId?: string | null }).activeProjectId;
  if (activeProjectId && activeProjectId !== "__list__") {
    const updated = app.settings.projects.map((p) =>
      p.id === activeProjectId ? { ...p, sessionKeys: [...p.sessionKeys, newKey] } : p,
    );
    app.applySettings({ ...app.settings, projects: updated });
  }

  // Switch to the new key — clears chat UI, updates settings, loads (empty) history
  (app as unknown as { activeProjectId: string | null }).activeProjectId = null;
  app.setSessionKey(newKey);

  // Refresh sidebar so the new session appears immediately
  try {
    await loadSessions(app, { activeMinutes: getSessionsActiveMinutes(app.settings) });
  } catch {
    // Non-critical
  }
}

export async function handleSendChat(
  host: ChatHost,
  messageOverride?: string,
  opts?: { restoreDraft?: boolean; attachments?: ChatAttachment[] },
) {
  if (!host.connected) {
    return;
  }
  const previousDraft = host.chatMessage;
  const message = (messageOverride ?? host.chatMessage).trim();
  const attachments = host.chatAttachments ?? [];
  // When messageOverride is set (edit/resend), use opts.attachments if provided
  const attachmentsToSend = messageOverride == null ? attachments : (opts?.attachments ?? []);
  const hasAttachments = attachmentsToSend.length > 0;

  // Allow sending with just attachments (no message text required)
  if (!message && !hasAttachments) {
    return;
  }

  if (isChatStopCommand(message)) {
    await handleAbortChat(host);
    return;
  }

  // Handle /project commands locally (projects live in UI settings)
  const projectReply = handleProjectCommand(
    host as unknown as Parameters<typeof handleProjectCommand>[0],
    message,
  );
  if (projectReply) {
    if (messageOverride == null) {
      host.chatMessage = "";
    }
    const now = Date.now();
    const app = host as unknown as OpenClawApp;
    app.chatMessages = [
      ...app.chatMessages,
      { role: "user", content: [{ type: "text", text: message }], timestamp: now },
      { role: "assistant", content: [{ type: "text", text: projectReply }], timestamp: now },
    ];
    return;
  }

  const refreshSessions = isChatResetCommand(message);
  if (messageOverride == null) {
    host.chatMessage = "";
    // Clear attachments when sending
    host.chatAttachments = [];
  }

  if (isChatBusy(host)) {
    enqueueChatMessage(host, message, attachmentsToSend, refreshSessions);
    return;
  }

  // Capture files for the project if this chat belongs to one
  if (hasAttachments) {
    void captureProjectFiles(host, attachmentsToSend);
  }

  await sendChatMessageNow(host, message, {
    previousDraft: messageOverride == null ? previousDraft : undefined,
    restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
    attachments: hasAttachments ? attachmentsToSend : undefined,
    previousAttachments: messageOverride == null ? attachments : undefined,
    restoreAttachments: Boolean(messageOverride && opts?.restoreDraft),
    refreshSessions,
  });
}

/** Store attachment metadata + binary data when sending files in a project chat */
async function captureProjectFiles(host: ChatHost, attachments: ChatAttachment[]) {
  const app = host as unknown as OpenClawApp;
  const sessionKey = app.sessionKey;
  const project = app.settings.projects.find((p) => p.sessionKeys.includes(sessionKey));
  if (!project) {
    return;
  }
  const { putProjectFile } = await import("./controllers/project-files.ts");
  const newFiles: import("./storage.ts").ProjectFile[] = [];
  for (const att of attachments) {
    const fileId = att.id || generateUUID();
    const sizeBytes = Math.round((att.dataUrl.length * 3) / 4); // approximate base64→bytes
    newFiles.push({
      id: fileId,
      fileName: att.fileName || "attachment",
      mimeType: att.mimeType,
      sizeBytes,
      sessionKey,
      addedAt: Date.now(),
    });
    void putProjectFile(project.id, fileId, att.dataUrl, att.fileName || "attachment");
  }
  if (newFiles.length > 0) {
    const updated = app.settings.projects.map((p) =>
      p.id === project.id ? { ...p, files: [...p.files, ...newFiles] } : p,
    );
    app.applySettings({ ...app.settings, projects: updated });
  }
}

export async function refreshChat(host: ChatHost, opts?: { scheduleScroll?: boolean }) {
  await Promise.all([
    loadChatHistory(host as unknown as OpenClawApp),
    loadSessions(host as unknown as OpenClawApp, {
      activeMinutes: getSessionsActiveMinutes((host as unknown as OpenClawApp).settings),
    }),
    refreshChatAvatar(host),
  ]);
  if (opts?.scheduleScroll !== false) {
    scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
  }
  // Fetch conversation previews for sidebar after sessions are loaded
  const app = host as unknown as OpenClawApp;
  const keys = app.sessionsResult?.sessions?.map((s) => s.key) ?? [];
  if (keys.length > 0) {
    void loadSessionPreviews(app, keys);
  }
}

export const flushChatQueueForEvent = flushChatQueue;

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
};

function resolveAgentIdForSession(host: ChatHost): string | null {
  const parsed = parseAgentSessionKey(host.sessionKey);
  if (parsed?.agentId) {
    return parsed.agentId;
  }
  const snapshot = host.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const fallback = snapshot?.sessionDefaults?.defaultAgentId?.trim();
  return fallback || "main";
}

function buildAvatarMetaUrl(basePath: string, agentId: string): string {
  const base = normalizeBasePath(basePath);
  const encoded = encodeURIComponent(agentId);
  return base ? `${base}/avatar/${encoded}?meta=1` : `/avatar/${encoded}?meta=1`;
}

export async function refreshChatAvatar(host: ChatHost) {
  if (!host.connected) {
    host.chatAvatarUrl = null;
    return;
  }
  const agentId = resolveAgentIdForSession(host);
  if (!agentId) {
    host.chatAvatarUrl = null;
    return;
  }
  host.chatAvatarUrl = null;
  const url = buildAvatarMetaUrl(host.basePath, agentId);
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      host.chatAvatarUrl = null;
      return;
    }
    const data = (await res.json()) as { avatarUrl?: unknown };
    const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl.trim() : "";
    host.chatAvatarUrl = avatarUrl || null;
  } catch {
    host.chatAvatarUrl = null;
  }
}
