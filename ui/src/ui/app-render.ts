import { html, nothing } from "lit";
import type { AppViewState } from "./app-view-state.ts";
import type { UsageState } from "./controllers/usage.ts";
import type { ChatAttachment } from "./ui-types.ts";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { getSessionsActiveMinutes, refreshChatAvatar } from "./app-chat.ts";
import { renderSimpleThemeToggle } from "./app-render.helpers.ts";
import { readAloud } from "./app-tts.ts";
import { extractFileBlocks } from "./chat/grouped-render.ts";
import { loadAgentFileContent, loadAgentFiles, saveAgentFile } from "./controllers/agent-files.ts";
import { loadAgentIdentities, loadAgentIdentity } from "./controllers/agent-identity.ts";
import { loadAgentSkills } from "./controllers/agent-skills.ts";
import { loadAgents } from "./controllers/agents.ts";
import { loadChannels } from "./controllers/channels.ts";
import { abortChatRun, loadChatHistory } from "./controllers/chat.ts";
import {
  applyConfig,
  loadConfig,
  runUpdate,
  saveConfig,
  updateConfigFormValue,
  removeConfigFormValue,
} from "./controllers/config.ts";
import {
  loadCronRuns,
  toggleCronJob,
  runCronJob,
  removeCronJob,
  addCronJob,
} from "./controllers/cron.ts";
import { loadDebug, callDebugMethod } from "./controllers/debug.ts";
import {
  approveDevicePairing,
  loadDevices,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
} from "./controllers/devices.ts";
import {
  loadExecApprovals,
  removeExecApprovalsFormValue,
  saveExecApprovals,
  updateExecApprovalsFormValue,
} from "./controllers/exec-approvals.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadPresence } from "./controllers/presence.ts";
import {
  deleteSession as deleteSessionApi,
  loadSessions,
  patchSession,
} from "./controllers/sessions.ts";
import { loadPrefill } from "./controllers/settings-prefill.ts";
import {
  installSkill,
  loadSkills,
  saveSkillApiKey,
  updateSkillEdit,
  updateSkillEnabled,
} from "./controllers/skills.ts";
import { loadUsage, loadSessionTimeSeries, loadSessionLogs } from "./controllers/usage.ts";
import { icons } from "./icons.ts";
import { normalizeBasePath, subtitleForTab, titleForTab } from "./navigation.ts";
import { renderUnifiedSettings } from "./views/settings-unified.ts";

// Module-scope debounce for usage date changes (avoids type-unsafe hacks on state object)
let usageDateDebounceTimeout: number | null = null;
const debouncedLoadUsage = (state: UsageState) => {
  if (usageDateDebounceTimeout) {
    clearTimeout(usageDateDebounceTimeout);
  }
  usageDateDebounceTimeout = window.setTimeout(() => void loadUsage(state), 400);
};
import { renderAgents } from "./views/agents.ts";
import { renderChannels } from "./views/channels.ts";
import { renderChat } from "./views/chat.ts";
import { renderConfig } from "./views/config.ts";
import { renderCron } from "./views/cron.ts";
import { renderDebug } from "./views/debug.ts";
import { renderExecApprovalPrompt } from "./views/exec-approval.ts";
import { renderGatewayUrlConfirmation } from "./views/gateway-url-confirmation.ts";
import { renderInstances } from "./views/instances.ts";
import { renderLoginView } from "./views/login.ts";
import { renderLogs } from "./views/logs.ts";
import { renderNodes } from "./views/nodes.ts";
import { renderOverview } from "./views/overview.ts";
import { renderSessions } from "./views/sessions.ts";
import { renderSkills } from "./views/skills.ts";
import { renderUsage } from "./views/usage.ts";

const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;

function resolveAssistantAvatarUrl(state: AppViewState): string | undefined {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) {
    return undefined;
  }
  if (AVATAR_DATA_RE.test(candidate) || AVATAR_HTTP_RE.test(candidate)) {
    return candidate;
  }
  return identity?.avatarUrl;
}

/** Friendly fallback for session keys without a label/displayName */
function sessionTitle(key: string, displayName?: string, label?: string): string {
  // System sessions always keep their canonical name
  if (key.endsWith(":main")) return "Agent-Main";
  if (displayName) return displayName;
  if (label) return label;
  if (/^agent:.*:web-/.test(key)) return "New chat";
  return key;
}

/** Whether a session represents a system/permanent agent (pinned in sidebar) */
function isSystemSession(key: string): boolean {
  return key.endsWith(":main");
}

/** Default web session created at gateway startup — hidden unless setting enabled */
function isDefaultWebSession(key: string, label?: string, displayName?: string): boolean {
  if (!/^agent:.*:web-/.test(key)) return false;
  return !label && !displayName;
}

/** Resolve display title for the current session */
function resolveSessionTitle(state: AppViewState): string {
  const sessions = state.sessionsResult?.sessions;
  if (!sessions) return sessionTitle(state.sessionKey || "main");
  const session = sessions.find((s) => s.key === state.sessionKey);
  return session
    ? sessionTitle(session.key, session.displayName, session.label)
    : sessionTitle(state.sessionKey || "main");
}

/** Resolve model badge for the current session (provider/model format) */
function resolveSessionModel(state: AppViewState): string {
  const sessions = state.sessionsResult?.sessions;
  if (!sessions) return "";
  const session = sessions.find((s) => s.key === state.sessionKey);
  if (!session?.model) return "";
  return session.modelProvider ? `${session.modelProvider}/${session.model}` : session.model;
}

/** Extract preserved ChatAttachment[] from an optimistic user message.
 *  Falls back to extractFileBlocks when _attachments is absent (cold load).
 */
function extractMessageAttachments(msg: unknown): ChatAttachment[] | undefined {
  const m = msg as Record<string, unknown> | undefined;
  if (!m) {
    return undefined;
  }
  // Optimistic path: _attachments carries full data (dataUrl, mimeType, fileName)
  if (Array.isArray(m._attachments) && m._attachments.length > 0) {
    return m._attachments as ChatAttachment[];
  }
  // Cold-load fallback: reconstruct display-only attachments from file blocks
  const fileBlocks = extractFileBlocks(msg);
  if (fileBlocks.length === 0) {
    return undefined;
  }
  return fileBlocks.map((fb, i) => ({
    id: `cold-${i}-${fb.fileName}`,
    dataUrl: "",
    mimeType: fb.mimeType ?? guessMimeFromFileName(fb.fileName),
    fileName: fb.fileName,
  }));
}

/** Best-effort MIME type from file extension (display-only, not used for upload) */
function guessMimeFromFileName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    json: "application/json",
    csv: "text/csv",
    txt: "text/plain",
    zip: "application/zip",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Truncate chat history at afterIndex, then send a new message */
async function truncateAndSend(
  state: AppViewState,
  afterIndex: number,
  text: string,
  attachments?: ChatAttachment[],
) {
  // Abort current run if the agent is working
  if (state.chatRunId) {
    await abortChatRun(state as Parameters<typeof abortChatRun>[0]);
    // Clear local run state immediately so handleSendChat doesn't enqueue
    state.chatRunId = null;
    state.chatStream = null;
    state.chatStreamStartedAt = null;
  }
  // Optimistic local truncation
  state.chatMessages = state.chatMessages.slice(0, afterIndex);
  // Persist truncation on the backend
  try {
    await state.client?.request("chat.truncate", {
      sessionKey: state.sessionKey,
      afterIndex,
    });
  } catch {
    // Best-effort — loadChatHistory will reconcile
  }
  await state.handleSendChat(text, { attachments });
}

/** Truncate from the start of an assistant group, then resend the preceding user message */
async function truncateAndResend(state: AppViewState, assistantStartIndex: number) {
  // Walk backwards to find the last user message before this assistant group
  let userText = "";
  let truncateAt = assistantStartIndex;
  let attachments: ChatAttachment[] | undefined;
  for (let i = assistantStartIndex - 1; i >= 0; i--) {
    const msg = state.chatMessages[i] as Record<string, unknown> | undefined;
    if (!msg) {
      continue;
    }
    const role = typeof msg.role === "string" ? msg.role.toLowerCase() : "";
    if (role === "user") {
      const content = msg.content;
      if (Array.isArray(content)) {
        userText = content
          .filter((b: Record<string, unknown>) => b.type === "text" && typeof b.text === "string")
          .map((b: Record<string, unknown>) => b.text as string)
          .join("\n")
          .trim();
      } else if (typeof content === "string") {
        userText = content.trim();
      }
      attachments = extractMessageAttachments(msg);
      truncateAt = i;
      break;
    }
  }
  if (!userText) {
    return;
  }
  await truncateAndSend(state, truncateAt, userText, attachments);
}

export function renderApp(state: AppViewState) {
  // Auth gate: loading spinner
  if (state.authStatus === "loading") {
    return html`
      <div class="auth-loading"><div class="auth-loading-spinner"></div></div>
      <style>
        .auth-loading {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-primary, #0a0a0a);
          z-index: 9999;
        }
        .auth-loading-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid var(--border-color, #333);
          border-top-color: var(--accent-color, #3b82f6);
          border-radius: 50%;
          animation: auth-spin 0.6s linear infinite;
        }
        @keyframes auth-spin {
          to {
            transform: rotate(360deg);
          }
        }
      </style>
    `;
  }
  // Auth gate: login screen
  if (state.authStatus === "unauthenticated") {
    return renderLoginView({
      username: state.loginUsername,
      password: state.loginPassword,
      error: state.loginError,
      loading: state.loginLoading,
      onUsernameChange: (v) => {
        state.loginUsername = v;
      },
      onPasswordChange: (v) => {
        state.loginPassword = v;
      },
      onSubmit: () => {
        void state.handleLogin();
      },
    });
  }

  const presenceCount = state.presenceEntries.length;
  const sessionsCount = state.sessionsResult?.count ?? null;
  const cronNext = state.cronStatus?.nextWakeAtMs ?? null;
  const chatDisabledReason = state.connected ? null : "Disconnected from gateway.";
  const isChat = state.tab === "chat";
  const chatFocus = isChat && (state.settings.chatFocusMode || state.onboarding);
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;
  const configValue =
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const basePath = normalizeBasePath(state.basePath ?? "");
  const resolvedAgentId =
    state.agentsSelectedId ??
    state.agentsList?.defaultId ??
    state.agentsList?.agents?.[0]?.id ??
    null;

  const sidebarHidden = state.settings.navCollapsed;

  return html`
    <div class="shell ${isChat ? "shell--chat" : ""} ${chatFocus ? "shell--chat-focus" : ""} ${state.onboarding ? "shell--onboarding" : ""}">
      <header class="topbar"></header>

      <!-- Conversations Sidebar -->
      <aside class="chat-conversations ${sidebarHidden ? "hidden" : ""}">
        <div class="conversations-header">
          <div class="sidebar-brand-row">
            <span class="sidebar-logo">🦞</span>
            <span class="sidebar-brand-name">OpenClaw</span>
            <span class="sidebar-health-dot ${state.connected ? "ok" : ""}" title="${state.connected ? "Connected" : "Offline"}"></span>
            ${
              state.authStatus === "authenticated"
                ? html`
              <button
                class="btn-icon sidebar-logout-btn"
                @click=${() => {
                  void state.handleLogout();
                }}
                title="Sign out (${state.authUser?.username ?? ""})"
                aria-label="Sign out"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              </button>
            `
                : ""
            }
          </div>
          <button
            class="btn-icon sidebar-toggle-btn"
            @click=${() => state.applySettings({ ...state.settings, navCollapsed: true })}
            title="Hide sidebar"
            aria-label="Hide sidebar"
          >
            ${icons.sidebarLeft}
          </button>
        </div>
        <div class="sidebar-nav-items">
          <button
            class="sidebar-nav-btn"
            @click=${() => {
              state.setTab("chat");
              void state.handleNewSession();
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            New chat
          </button>
          <button
            class="sidebar-nav-btn"
            @click=${() => {
              state.searchModalOpen = true;
              state.searchQuery = "";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Search
          </button>
          <div class="sidebar-projects-section">
            <div class="sidebar-nav-row">
              <button
                class="sidebar-nav-btn sidebar-accordion-toggle"
                @click=${() => {
                  _projectsExpanded = !_projectsExpanded;
                  // Force re-render via reactive property toggle
                  const q = state.searchQuery;
                  state.searchQuery = q + " ";
                  state.searchQuery = q;
                }}
              >
                <svg class="sidebar-accordion-chevron ${_projectsExpanded ? "expanded" : ""}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                Projects
              </button>
              <button
                class="sidebar-nav-plus"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  _projectFormName = "";
                  _projectFormColor = PROJECT_COLORS[0];
                  _projectFormEditId = null;
                  _projectFormError = "";
                  state.projectModalOpen = true;
                }}
                title="New project"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
            ${
              _projectsExpanded && state.settings.projects.length > 0
                ? html`
              <div class="sidebar-projects-list">
                ${state.settings.projects.map((proj) => {
                  const count = proj.sessionKeys.length;
                  const isActive = state.activeProjectId === proj.id;
                  return html`
                    <button
                      class="sidebar-project-item ${isActive ? "active" : ""}"
                      @click=${() => {
                        state.activeProjectId = proj.id;
                        state.setTab("chat");
                      }}
                    >
                      <span class="sidebar-project-dot" style="background:${proj.color}"></span>
                      <span class="sidebar-project-name">${proj.name}</span>
                      <span class="sidebar-project-count">${count}</span>
                    </button>
                  `;
                })}
              </div>
            `
                : nothing
            }
          </div>
        </div>
        ${(() => {
          const conv = renderConversationsList(state, isChat);
          return html`${conv.pinned}<div class="conversations-list">${conv.chat}</div>`;
        })()}
      </aside>

      <!-- Main Area -->
      <div class="chat-main">

        <!-- Chat Header Bar -->
        ${
          isChat
            ? html`
          <div class="chat-header-bar">
            <div class="chat-header-left">
              ${
                sidebarHidden
                  ? html`
                <button
                  class="btn-icon sidebar-open-btn"
                  @click=${() => state.applySettings({ ...state.settings, navCollapsed: false })}
                  title="Open sidebar"
                  aria-label="Open sidebar"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
              `
                  : nothing
              }
              <div class="chat-header-title">
                <span class="chat-title-text">${resolveSessionTitle(state)}</span>
                <span class="chat-session-badge">${resolveSessionModel(state)}</span>
                ${(() => {
                  const proj = state.settings.projects.find((p) =>
                    p.sessionKeys.includes(state.sessionKey),
                  );
                  return proj
                    ? html`<button class="chat-project-badge" style="background:${proj.color}" @click=${() => {
                        state.activeProjectId = proj.id;
                        state.setTab("chat");
                      }}>${proj.name}</button>`
                    : nothing;
                })()}
              </div>
            </div>
            <div class="chat-header-actions">
              ${state.lastError ? html`<div class="pill danger">${state.lastError}</div>` : nothing}
              ${renderSimpleThemeToggle(state)}
              <button
                class="btn-icon"
                @click=${() => {
                  const opening = !state.settingsModalOpen;
                  state.settingsModalOpen = opening;
                  if (opening) {
                    void loadPrefill({
                      client: state.client,
                      connected: state.connected,
                      settings: state.settings,
                    }).then((result) => {
                      state.settingsPrefill = result;
                    });
                  }
                }}
                title="Settings"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
            </div>
          </div>
        `
            : nothing
        }

        <!-- Non-chat page header -->
        ${
          !isChat
            ? html`
          <div class="page-header">
            <button
              class="back-to-menu"
              @click=${() => state.setTab("chat")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
              Back to Chat
            </button>
            <h1 class="page-title">${titleForTab(state.tab)}</h1>
            <p class="page-desc">${subtitleForTab(state.tab)}</p>
          </div>
        `
            : nothing
        }

        <main class="content ${isChat ? "content--chat" : ""}">

        ${
          state.tab === "overview"
            ? renderOverview({
                connected: state.connected,
                hello: state.hello,
                settings: state.settings,
                password: state.password,
                lastError: state.lastError,
                presenceCount,
                sessionsCount,
                cronEnabled: state.cronStatus?.enabled ?? null,
                cronNext,
                lastChannelsRefresh: state.channelsLastSuccess,
                onSettingsChange: (next) => state.applySettings(next),
                onPasswordChange: (next) => (state.password = next),
                onSessionKeyChange: (next) => {
                  state.sessionKey = next;
                  state.chatMessage = "";
                  state.resetToolStream();
                  state.applySettings({
                    ...state.settings,
                    sessionKey: next,
                    lastActiveSessionKey: next,
                  });
                  void state.loadAssistantIdentity();
                },
                onConnect: () => state.connect(),
                onRefresh: () => state.loadOverview(),
              })
            : nothing
        }

        ${
          state.tab === "channels"
            ? renderChannels({
                connected: state.connected,
                loading: state.channelsLoading,
                snapshot: state.channelsSnapshot,
                lastError: state.channelsError,
                lastSuccessAt: state.channelsLastSuccess,
                whatsappMessage: state.whatsappLoginMessage,
                whatsappQrDataUrl: state.whatsappLoginQrDataUrl,
                whatsappConnected: state.whatsappLoginConnected,
                whatsappBusy: state.whatsappBusy,
                configSchema: state.configSchema,
                configSchemaLoading: state.configSchemaLoading,
                configForm: state.configForm,
                configUiHints: state.configUiHints,
                configSaving: state.configSaving,
                configFormDirty: state.configFormDirty,
                nostrProfileFormState: state.nostrProfileFormState,
                nostrProfileAccountId: state.nostrProfileAccountId,
                onRefresh: (probe) => loadChannels(state, probe),
                onWhatsAppStart: (force) => state.handleWhatsAppStart(force),
                onWhatsAppWait: () => state.handleWhatsAppWait(),
                onWhatsAppLogout: () => state.handleWhatsAppLogout(),
                onConfigPatch: (path, value) => updateConfigFormValue(state, path, value),
                onConfigSave: () => state.handleChannelConfigSave(),
                onConfigReload: () => state.handleChannelConfigReload(),
                onNostrProfileEdit: (accountId, profile) =>
                  state.handleNostrProfileEdit(accountId, profile),
                onNostrProfileCancel: () => state.handleNostrProfileCancel(),
                onNostrProfileFieldChange: (field, value) =>
                  state.handleNostrProfileFieldChange(field, value),
                onNostrProfileSave: () => state.handleNostrProfileSave(),
                onNostrProfileImport: () => state.handleNostrProfileImport(),
                onNostrProfileToggleAdvanced: () => state.handleNostrProfileToggleAdvanced(),
              })
            : nothing
        }

        ${
          state.tab === "instances"
            ? renderInstances({
                loading: state.presenceLoading,
                entries: state.presenceEntries,
                lastError: state.presenceError,
                statusMessage: state.presenceStatus,
                onRefresh: () => loadPresence(state),
              })
            : nothing
        }

        ${
          state.tab === "sessions"
            ? renderSessions({
                loading: state.sessionsLoading,
                result: state.sessionsResult,
                error: state.sessionsError,
                activeMinutes: state.sessionsFilterActive,
                limit: state.sessionsFilterLimit,
                includeGlobal: state.sessionsIncludeGlobal,
                includeUnknown: state.sessionsIncludeUnknown,
                basePath: state.basePath,
                onFiltersChange: (next) => {
                  state.sessionsFilterActive = next.activeMinutes;
                  state.sessionsFilterLimit = next.limit;
                  state.sessionsIncludeGlobal = next.includeGlobal;
                  state.sessionsIncludeUnknown = next.includeUnknown;
                },
                onRefresh: () => loadSessions(state),
                onPatch: (key, patch) => patchSession(state, key, patch),
                onDelete: (key) => deleteSessionApi(state, key),
              })
            : nothing
        }

        ${
          state.tab === "usage"
            ? renderUsage({
                loading: state.usageLoading,
                error: state.usageError,
                startDate: state.usageStartDate,
                endDate: state.usageEndDate,
                sessions: state.usageResult?.sessions ?? [],
                sessionsLimitReached: (state.usageResult?.sessions?.length ?? 0) >= 1000,
                totals: state.usageResult?.totals ?? null,
                aggregates: state.usageResult?.aggregates ?? null,
                costDaily: state.usageCostSummary?.daily ?? [],
                selectedSessions: state.usageSelectedSessions,
                selectedDays: state.usageSelectedDays,
                selectedHours: state.usageSelectedHours,
                chartMode: state.usageChartMode,
                dailyChartMode: state.usageDailyChartMode,
                timeSeriesMode: state.usageTimeSeriesMode,
                timeSeriesBreakdownMode: state.usageTimeSeriesBreakdownMode,
                timeSeries: state.usageTimeSeries,
                timeSeriesLoading: state.usageTimeSeriesLoading,
                sessionLogs: state.usageSessionLogs,
                sessionLogsLoading: state.usageSessionLogsLoading,
                sessionLogsExpanded: state.usageSessionLogsExpanded,
                logFilterRoles: state.usageLogFilterRoles,
                logFilterTools: state.usageLogFilterTools,
                logFilterHasTools: state.usageLogFilterHasTools,
                logFilterQuery: state.usageLogFilterQuery,
                query: state.usageQuery,
                queryDraft: state.usageQueryDraft,
                sessionSort: state.usageSessionSort,
                sessionSortDir: state.usageSessionSortDir,
                recentSessions: state.usageRecentSessions,
                sessionsTab: state.usageSessionsTab,
                visibleColumns:
                  state.usageVisibleColumns as import("./views/usage.ts").UsageColumnId[],
                timeZone: state.usageTimeZone,
                contextExpanded: state.usageContextExpanded,
                headerPinned: state.usageHeaderPinned,
                onStartDateChange: (date) => {
                  state.usageStartDate = date;
                  state.usageSelectedDays = [];
                  state.usageSelectedHours = [];
                  state.usageSelectedSessions = [];
                  debouncedLoadUsage(state);
                },
                onEndDateChange: (date) => {
                  state.usageEndDate = date;
                  state.usageSelectedDays = [];
                  state.usageSelectedHours = [];
                  state.usageSelectedSessions = [];
                  debouncedLoadUsage(state);
                },
                onRefresh: () => loadUsage(state),
                onTimeZoneChange: (zone) => {
                  state.usageTimeZone = zone;
                },
                onToggleContextExpanded: () => {
                  state.usageContextExpanded = !state.usageContextExpanded;
                },
                onToggleSessionLogsExpanded: () => {
                  state.usageSessionLogsExpanded = !state.usageSessionLogsExpanded;
                },
                onLogFilterRolesChange: (next) => {
                  state.usageLogFilterRoles = next;
                },
                onLogFilterToolsChange: (next) => {
                  state.usageLogFilterTools = next;
                },
                onLogFilterHasToolsChange: (next) => {
                  state.usageLogFilterHasTools = next;
                },
                onLogFilterQueryChange: (next) => {
                  state.usageLogFilterQuery = next;
                },
                onLogFilterClear: () => {
                  state.usageLogFilterRoles = [];
                  state.usageLogFilterTools = [];
                  state.usageLogFilterHasTools = false;
                  state.usageLogFilterQuery = "";
                },
                onToggleHeaderPinned: () => {
                  state.usageHeaderPinned = !state.usageHeaderPinned;
                },
                onSelectHour: (hour, shiftKey) => {
                  if (shiftKey && state.usageSelectedHours.length > 0) {
                    const allHours = Array.from({ length: 24 }, (_, i) => i);
                    const lastSelected =
                      state.usageSelectedHours[state.usageSelectedHours.length - 1];
                    const lastIdx = allHours.indexOf(lastSelected);
                    const thisIdx = allHours.indexOf(hour);
                    if (lastIdx !== -1 && thisIdx !== -1) {
                      const [start, end] =
                        lastIdx < thisIdx ? [lastIdx, thisIdx] : [thisIdx, lastIdx];
                      const range = allHours.slice(start, end + 1);
                      state.usageSelectedHours = [
                        ...new Set([...state.usageSelectedHours, ...range]),
                      ];
                    }
                  } else {
                    if (state.usageSelectedHours.includes(hour)) {
                      state.usageSelectedHours = state.usageSelectedHours.filter((h) => h !== hour);
                    } else {
                      state.usageSelectedHours = [...state.usageSelectedHours, hour];
                    }
                  }
                },
                onQueryDraftChange: (query) => {
                  state.usageQueryDraft = query;
                  if (state.usageQueryDebounceTimer) {
                    window.clearTimeout(state.usageQueryDebounceTimer);
                  }
                  state.usageQueryDebounceTimer = window.setTimeout(() => {
                    state.usageQuery = state.usageQueryDraft;
                    state.usageQueryDebounceTimer = null;
                  }, 250);
                },
                onApplyQuery: () => {
                  if (state.usageQueryDebounceTimer) {
                    window.clearTimeout(state.usageQueryDebounceTimer);
                    state.usageQueryDebounceTimer = null;
                  }
                  state.usageQuery = state.usageQueryDraft;
                },
                onClearQuery: () => {
                  if (state.usageQueryDebounceTimer) {
                    window.clearTimeout(state.usageQueryDebounceTimer);
                    state.usageQueryDebounceTimer = null;
                  }
                  state.usageQueryDraft = "";
                  state.usageQuery = "";
                },
                onSessionSortChange: (sort) => {
                  state.usageSessionSort = sort;
                },
                onSessionSortDirChange: (dir) => {
                  state.usageSessionSortDir = dir;
                },
                onSessionsTabChange: (tab) => {
                  state.usageSessionsTab = tab;
                },
                onToggleColumn: (column) => {
                  if (state.usageVisibleColumns.includes(column)) {
                    state.usageVisibleColumns = state.usageVisibleColumns.filter(
                      (entry) => entry !== column,
                    );
                  } else {
                    state.usageVisibleColumns = [...state.usageVisibleColumns, column];
                  }
                },
                onSelectSession: (key, shiftKey) => {
                  state.usageTimeSeries = null;
                  state.usageSessionLogs = null;
                  state.usageRecentSessions = [
                    key,
                    ...state.usageRecentSessions.filter((entry) => entry !== key),
                  ].slice(0, 8);

                  if (shiftKey && state.usageSelectedSessions.length > 0) {
                    // Shift-click: select range from last selected to this session
                    // Sort sessions same way as displayed (by tokens or cost descending)
                    const isTokenMode = state.usageChartMode === "tokens";
                    const sortedSessions = [...(state.usageResult?.sessions ?? [])].toSorted(
                      (a, b) => {
                        const valA = isTokenMode
                          ? (a.usage?.totalTokens ?? 0)
                          : (a.usage?.totalCost ?? 0);
                        const valB = isTokenMode
                          ? (b.usage?.totalTokens ?? 0)
                          : (b.usage?.totalCost ?? 0);
                        return valB - valA;
                      },
                    );
                    const allKeys = sortedSessions.map((s) => s.key);
                    const lastSelected =
                      state.usageSelectedSessions[state.usageSelectedSessions.length - 1];
                    const lastIdx = allKeys.indexOf(lastSelected);
                    const thisIdx = allKeys.indexOf(key);
                    if (lastIdx !== -1 && thisIdx !== -1) {
                      const [start, end] =
                        lastIdx < thisIdx ? [lastIdx, thisIdx] : [thisIdx, lastIdx];
                      const range = allKeys.slice(start, end + 1);
                      const newSelection = [...new Set([...state.usageSelectedSessions, ...range])];
                      state.usageSelectedSessions = newSelection;
                    }
                  } else {
                    // Regular click: focus a single session (so details always open).
                    // Click the focused session again to clear selection.
                    if (
                      state.usageSelectedSessions.length === 1 &&
                      state.usageSelectedSessions[0] === key
                    ) {
                      state.usageSelectedSessions = [];
                    } else {
                      state.usageSelectedSessions = [key];
                    }
                  }

                  // Load timeseries/logs only if exactly one session selected
                  if (state.usageSelectedSessions.length === 1) {
                    void loadSessionTimeSeries(state, state.usageSelectedSessions[0]);
                    void loadSessionLogs(state, state.usageSelectedSessions[0]);
                  }
                },
                onSelectDay: (day, shiftKey) => {
                  if (shiftKey && state.usageSelectedDays.length > 0) {
                    // Shift-click: select range from last selected to this day
                    const allDays = (state.usageCostSummary?.daily ?? []).map((d) => d.date);
                    const lastSelected =
                      state.usageSelectedDays[state.usageSelectedDays.length - 1];
                    const lastIdx = allDays.indexOf(lastSelected);
                    const thisIdx = allDays.indexOf(day);
                    if (lastIdx !== -1 && thisIdx !== -1) {
                      const [start, end] =
                        lastIdx < thisIdx ? [lastIdx, thisIdx] : [thisIdx, lastIdx];
                      const range = allDays.slice(start, end + 1);
                      // Merge with existing selection
                      const newSelection = [...new Set([...state.usageSelectedDays, ...range])];
                      state.usageSelectedDays = newSelection;
                    }
                  } else {
                    // Regular click: toggle single day
                    if (state.usageSelectedDays.includes(day)) {
                      state.usageSelectedDays = state.usageSelectedDays.filter((d) => d !== day);
                    } else {
                      state.usageSelectedDays = [day];
                    }
                  }
                },
                onChartModeChange: (mode) => {
                  state.usageChartMode = mode;
                },
                onDailyChartModeChange: (mode) => {
                  state.usageDailyChartMode = mode;
                },
                onTimeSeriesModeChange: (mode) => {
                  state.usageTimeSeriesMode = mode;
                },
                onTimeSeriesBreakdownChange: (mode) => {
                  state.usageTimeSeriesBreakdownMode = mode;
                },
                onClearDays: () => {
                  state.usageSelectedDays = [];
                },
                onClearHours: () => {
                  state.usageSelectedHours = [];
                },
                onClearSessions: () => {
                  state.usageSelectedSessions = [];
                  state.usageTimeSeries = null;
                  state.usageSessionLogs = null;
                },
                onClearFilters: () => {
                  state.usageSelectedDays = [];
                  state.usageSelectedHours = [];
                  state.usageSelectedSessions = [];
                  state.usageTimeSeries = null;
                  state.usageSessionLogs = null;
                },
              })
            : nothing
        }

        ${
          state.tab === "cron"
            ? renderCron({
                basePath: state.basePath,
                loading: state.cronLoading,
                status: state.cronStatus,
                jobs: state.cronJobs,
                error: state.cronError,
                busy: state.cronBusy,
                form: state.cronForm,
                channels: state.channelsSnapshot?.channelMeta?.length
                  ? state.channelsSnapshot.channelMeta.map((entry) => entry.id)
                  : (state.channelsSnapshot?.channelOrder ?? []),
                channelLabels: state.channelsSnapshot?.channelLabels ?? {},
                channelMeta: state.channelsSnapshot?.channelMeta ?? [],
                runsJobId: state.cronRunsJobId,
                runs: state.cronRuns,
                onFormChange: (patch) => (state.cronForm = { ...state.cronForm, ...patch }),
                onRefresh: () => state.loadCron(),
                onAdd: () => addCronJob(state),
                onToggle: (job, enabled) => toggleCronJob(state, job, enabled),
                onRun: (job) => runCronJob(state, job),
                onRemove: (job) => removeCronJob(state, job),
                onLoadRuns: (jobId) => loadCronRuns(state, jobId),
              })
            : nothing
        }

        ${
          state.tab === "agents"
            ? renderAgents({
                loading: state.agentsLoading,
                error: state.agentsError,
                agentsList: state.agentsList,
                selectedAgentId: resolvedAgentId,
                activePanel: state.agentsPanel,
                configForm: configValue,
                configLoading: state.configLoading,
                configSaving: state.configSaving,
                configDirty: state.configFormDirty,
                channelsLoading: state.channelsLoading,
                channelsError: state.channelsError,
                channelsSnapshot: state.channelsSnapshot,
                channelsLastSuccess: state.channelsLastSuccess,
                cronLoading: state.cronLoading,
                cronStatus: state.cronStatus,
                cronJobs: state.cronJobs,
                cronError: state.cronError,
                agentFilesLoading: state.agentFilesLoading,
                agentFilesError: state.agentFilesError,
                agentFilesList: state.agentFilesList,
                agentFileActive: state.agentFileActive,
                agentFileContents: state.agentFileContents,
                agentFileDrafts: state.agentFileDrafts,
                agentFileSaving: state.agentFileSaving,
                agentIdentityLoading: state.agentIdentityLoading,
                agentIdentityError: state.agentIdentityError,
                agentIdentityById: state.agentIdentityById,
                agentSkillsLoading: state.agentSkillsLoading,
                agentSkillsReport: state.agentSkillsReport,
                agentSkillsError: state.agentSkillsError,
                agentSkillsAgentId: state.agentSkillsAgentId,
                skillsFilter: state.skillsFilter,
                onRefresh: async () => {
                  await loadAgents(state);
                  const agentIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
                  if (agentIds.length > 0) {
                    void loadAgentIdentities(state, agentIds);
                  }
                },
                onSelectAgent: (agentId) => {
                  if (state.agentsSelectedId === agentId) {
                    return;
                  }
                  state.agentsSelectedId = agentId;
                  state.agentFilesList = null;
                  state.agentFilesError = null;
                  state.agentFilesLoading = false;
                  state.agentFileActive = null;
                  state.agentFileContents = {};
                  state.agentFileDrafts = {};
                  state.agentSkillsReport = null;
                  state.agentSkillsError = null;
                  state.agentSkillsAgentId = null;
                  void loadAgentIdentity(state, agentId);
                  if (state.agentsPanel === "files") {
                    void loadAgentFiles(state, agentId);
                  }
                  if (state.agentsPanel === "skills") {
                    void loadAgentSkills(state, agentId);
                  }
                },
                onSelectPanel: (panel) => {
                  state.agentsPanel = panel;
                  if (panel === "files" && resolvedAgentId) {
                    if (state.agentFilesList?.agentId !== resolvedAgentId) {
                      state.agentFilesList = null;
                      state.agentFilesError = null;
                      state.agentFileActive = null;
                      state.agentFileContents = {};
                      state.agentFileDrafts = {};
                      void loadAgentFiles(state, resolvedAgentId);
                    }
                  }
                  if (panel === "skills") {
                    if (resolvedAgentId) {
                      void loadAgentSkills(state, resolvedAgentId);
                    }
                  }
                  if (panel === "channels") {
                    void loadChannels(state, false);
                  }
                  if (panel === "cron") {
                    void state.loadCron();
                  }
                },
                onLoadFiles: (agentId) => loadAgentFiles(state, agentId),
                onSelectFile: (name) => {
                  state.agentFileActive = name;
                  if (!resolvedAgentId) {
                    return;
                  }
                  void loadAgentFileContent(state, resolvedAgentId, name);
                },
                onFileDraftChange: (name, content) => {
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
                },
                onFileReset: (name) => {
                  const base = state.agentFileContents[name] ?? "";
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: base };
                },
                onFileSave: (name) => {
                  if (!resolvedAgentId) {
                    return;
                  }
                  const content =
                    state.agentFileDrafts[name] ?? state.agentFileContents[name] ?? "";
                  void saveAgentFile(state, resolvedAgentId, name, content);
                },
                onToolsProfileChange: (agentId, profile, clearAllow) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (profile) {
                    updateConfigFormValue(state, [...basePath, "profile"], profile);
                  } else {
                    removeConfigFormValue(state, [...basePath, "profile"]);
                  }
                  if (clearAllow) {
                    removeConfigFormValue(state, [...basePath, "allow"]);
                  }
                },
                onToolsOverridesChange: (agentId, alsoAllow, deny) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (alsoAllow.length > 0) {
                    updateConfigFormValue(state, [...basePath, "alsoAllow"], alsoAllow);
                  } else {
                    removeConfigFormValue(state, [...basePath, "alsoAllow"]);
                  }
                  if (deny.length > 0) {
                    updateConfigFormValue(state, [...basePath, "deny"], deny);
                  } else {
                    removeConfigFormValue(state, [...basePath, "deny"]);
                  }
                },
                onConfigReload: () => loadConfig(state),
                onConfigSave: () => saveConfig(state),
                onChannelsRefresh: () => loadChannels(state, false),
                onCronRefresh: () => state.loadCron(),
                onSkillsFilterChange: (next) => (state.skillsFilter = next),
                onSkillsRefresh: () => {
                  if (resolvedAgentId) {
                    void loadAgentSkills(state, resolvedAgentId);
                  }
                },
                onAgentSkillToggle: (agentId, skillName, enabled) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const entry = list[index] as { skills?: unknown };
                  const normalizedSkill = skillName.trim();
                  if (!normalizedSkill) {
                    return;
                  }
                  const allSkills =
                    state.agentSkillsReport?.skills?.map((skill) => skill.name).filter(Boolean) ??
                    [];
                  const existing = Array.isArray(entry.skills)
                    ? entry.skills.map((name) => String(name).trim()).filter(Boolean)
                    : undefined;
                  const base = existing ?? allSkills;
                  const next = new Set(base);
                  if (enabled) {
                    next.add(normalizedSkill);
                  } else {
                    next.delete(normalizedSkill);
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], [...next]);
                },
                onAgentSkillsClear: (agentId) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  removeConfigFormValue(state, ["agents", "list", index, "skills"]);
                },
                onAgentSkillsDisableAll: (agentId) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], []);
                },
                onModelChange: (agentId, modelId) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "model"];
                  if (!modelId) {
                    removeConfigFormValue(state, basePath);
                    return;
                  }
                  const entry = list[index] as { model?: unknown };
                  const existing = entry?.model;
                  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                    const fallbacks = (existing as { fallbacks?: unknown }).fallbacks;
                    const next = {
                      primary: modelId,
                      ...(Array.isArray(fallbacks) ? { fallbacks } : {}),
                    };
                    updateConfigFormValue(state, basePath, next);
                  } else {
                    updateConfigFormValue(state, basePath, modelId);
                  }
                },
                onModelFallbacksChange: (agentId, fallbacks) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "model"];
                  const entry = list[index] as { model?: unknown };
                  const normalized = fallbacks.map((name) => name.trim()).filter(Boolean);
                  const existing = entry.model;
                  const resolvePrimary = () => {
                    if (typeof existing === "string") {
                      return existing.trim() || null;
                    }
                    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                      const primary = (existing as { primary?: unknown }).primary;
                      if (typeof primary === "string") {
                        const trimmed = primary.trim();
                        return trimmed || null;
                      }
                    }
                    return null;
                  };
                  const primary = resolvePrimary();
                  if (normalized.length === 0) {
                    if (primary) {
                      updateConfigFormValue(state, basePath, primary);
                    } else {
                      removeConfigFormValue(state, basePath);
                    }
                    return;
                  }
                  const next = primary
                    ? { primary, fallbacks: normalized }
                    : { fallbacks: normalized };
                  updateConfigFormValue(state, basePath, next);
                },
              })
            : nothing
        }

        ${
          state.tab === "skills"
            ? renderSkills({
                loading: state.skillsLoading,
                report: state.skillsReport,
                error: state.skillsError,
                filter: state.skillsFilter,
                edits: state.skillEdits,
                messages: state.skillMessages,
                busyKey: state.skillsBusyKey,
                onFilterChange: (next) => (state.skillsFilter = next),
                onRefresh: () => loadSkills(state, { clearMessages: true }),
                onToggle: (key, enabled) => updateSkillEnabled(state, key, enabled),
                onEdit: (key, value) => updateSkillEdit(state, key, value),
                onSaveKey: (key) => saveSkillApiKey(state, key),
                onInstall: (skillKey, name, installId) =>
                  installSkill(state, skillKey, name, installId),
              })
            : nothing
        }

        ${
          state.tab === "nodes"
            ? renderNodes({
                loading: state.nodesLoading,
                nodes: state.nodes,
                devicesLoading: state.devicesLoading,
                devicesError: state.devicesError,
                devicesList: state.devicesList,
                configForm:
                  state.configForm ??
                  (state.configSnapshot?.config as Record<string, unknown> | null),
                configLoading: state.configLoading,
                configSaving: state.configSaving,
                configDirty: state.configFormDirty,
                configFormMode: state.configFormMode,
                execApprovalsLoading: state.execApprovalsLoading,
                execApprovalsSaving: state.execApprovalsSaving,
                execApprovalsDirty: state.execApprovalsDirty,
                execApprovalsSnapshot: state.execApprovalsSnapshot,
                execApprovalsForm: state.execApprovalsForm,
                execApprovalsSelectedAgent: state.execApprovalsSelectedAgent,
                execApprovalsTarget: state.execApprovalsTarget,
                execApprovalsTargetNodeId: state.execApprovalsTargetNodeId,
                onRefresh: () => loadNodes(state),
                onDevicesRefresh: () => loadDevices(state),
                onDeviceApprove: (requestId) => approveDevicePairing(state, requestId),
                onDeviceReject: (requestId) => rejectDevicePairing(state, requestId),
                onDeviceRotate: (deviceId, role, scopes) =>
                  rotateDeviceToken(state, { deviceId, role, scopes }),
                onDeviceRevoke: (deviceId, role) => revokeDeviceToken(state, { deviceId, role }),
                onLoadConfig: () => loadConfig(state),
                onLoadExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  return loadExecApprovals(state, target);
                },
                onBindDefault: (nodeId) => {
                  if (nodeId) {
                    updateConfigFormValue(state, ["tools", "exec", "node"], nodeId);
                  } else {
                    removeConfigFormValue(state, ["tools", "exec", "node"]);
                  }
                },
                onBindAgent: (agentIndex, nodeId) => {
                  const basePath = ["agents", "list", agentIndex, "tools", "exec", "node"];
                  if (nodeId) {
                    updateConfigFormValue(state, basePath, nodeId);
                  } else {
                    removeConfigFormValue(state, basePath);
                  }
                },
                onSaveBindings: () => saveConfig(state),
                onExecApprovalsTargetChange: (kind, nodeId) => {
                  state.execApprovalsTarget = kind;
                  state.execApprovalsTargetNodeId = nodeId;
                  state.execApprovalsSnapshot = null;
                  state.execApprovalsForm = null;
                  state.execApprovalsDirty = false;
                  state.execApprovalsSelectedAgent = null;
                },
                onExecApprovalsSelectAgent: (agentId) => {
                  state.execApprovalsSelectedAgent = agentId;
                },
                onExecApprovalsPatch: (path, value) =>
                  updateExecApprovalsFormValue(state, path, value),
                onExecApprovalsRemove: (path) => removeExecApprovalsFormValue(state, path),
                onSaveExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  return saveExecApprovals(state, target);
                },
              })
            : nothing
        }

        ${state.tab === "chat" && state.activeProjectId ? renderProjectView(state) : nothing}

        ${
          state.tab === "chat" && !state.activeProjectId
            ? renderChat({
                sessionKey: state.sessionKey,
                onSessionKeyChange: (next) => {
                  state.sessionKey = next;
                  state.chatMessages = [];
                  state.chatMessage = "";
                  state.chatAttachments = [];
                  state.chatStream = null;
                  state.chatStreamStartedAt = null;
                  state.chatRunId = null;
                  state.chatQueue = [];
                  state.resetToolStream();
                  state.resetChatScroll();
                  state.applySettings({
                    ...state.settings,
                    sessionKey: next,
                    lastActiveSessionKey: next,
                  });
                  void state.loadAssistantIdentity();
                  void loadChatHistory(state);
                  void refreshChatAvatar(state);
                },
                thinkingLevel: state.chatThinkingLevel,
                showThinking,
                loading: state.chatLoading,
                sending: state.chatSending,
                compactionStatus: state.compactionStatus,
                assistantAvatarUrl: chatAvatarUrl,
                messages: state.chatMessages,
                toolMessages: state.chatToolMessages,
                stream: state.chatStream,
                streamStartedAt: state.chatStreamStartedAt,
                activeToolName: state.chatActiveToolName,
                draft: state.chatMessage,
                queue: state.chatQueue,
                connected: state.connected,
                canSend: state.connected,
                disabledReason: chatDisabledReason,
                error: state.lastError,
                sessions: state.sessionsResult,
                focusMode: chatFocus,
                onRefresh: () => {
                  state.resetToolStream();
                  return Promise.all([loadChatHistory(state), refreshChatAvatar(state)]);
                },
                onToggleFocusMode: () => {
                  if (state.onboarding) {
                    return;
                  }
                  state.applySettings({
                    ...state.settings,
                    chatFocusMode: !state.settings.chatFocusMode,
                  });
                },
                onChatScroll: (event) => state.handleChatScroll(event),
                onDraftChange: (next) => (state.chatMessage = next),
                attachments: state.chatAttachments,
                onAttachmentsChange: (next) => (state.chatAttachments = next),
                onSend: () => state.handleSendChat(),
                canAbort: Boolean(state.chatRunId),
                onAbort: () => void state.handleAbortChat(),
                onQueueRemove: (id) => state.removeQueuedMessage(id),
                onNewSession: () => void state.handleNewSession(),
                showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
                onScrollToBottom: () => state.scrollToBottom(),
                // Sidebar props for tool output viewing
                sidebarOpen: state.sidebarOpen,
                sidebarContent: state.sidebarContent,
                sidebarError: state.sidebarError,
                splitRatio: state.splitRatio,
                onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
                onCloseSidebar: () => state.handleCloseSidebar(),
                onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
                assistantName: state.assistantName,
                assistantAvatar: state.assistantAvatar,
                // Model selector (native <select>)
                modelsCatalog: state.modelsCatalog,
                currentModel: resolveSessionModel(state),
                onModelChange: (modelId: string) => {
                  state.handleModelChange(modelId);
                },
                // Skills popover — only installed (workspace/managed) skills
                skills: (() => {
                  const installed = (state.skillsReport?.skills ?? []).filter(
                    (s) =>
                      !s.bundled &&
                      s.source !== "openclaw-bundled" &&
                      s.source !== "openclaw-extra",
                  );
                  const overrides = state.sessionSkillOverrides.get(state.sessionKey);
                  return installed.map((s) => ({
                    name: s.name,
                    emoji: s.emoji || undefined,
                    // No override → all eligible skills enabled; override → only those in the Set
                    enabled: overrides ? overrides.has(s.name) : s.eligible && !s.disabled,
                  }));
                })(),
                skillsPopoverOpen: state.skillsPopoverOpen,
                onToggleSkillsPopover: () => {
                  state.skillsPopoverOpen = !state.skillsPopoverOpen;
                  // Refresh skills every time the popover opens
                  if (state.skillsPopoverOpen && !state.skillsLoading) {
                    void state.handleLoadSkills();
                  }
                },
                onToggleSkill: (name: string) => {
                  const key = state.sessionKey;
                  let overrides = state.sessionSkillOverrides.get(key);
                  if (!overrides) {
                    // First toggle: snapshot current state — all eligible & non-disabled skills
                    const installed = (state.skillsReport?.skills ?? []).filter(
                      (s) =>
                        !s.bundled &&
                        s.source !== "openclaw-bundled" &&
                        s.source !== "openclaw-extra",
                    );
                    overrides = new Set(
                      installed.filter((s) => s.eligible && !s.disabled).map((s) => s.name),
                    );
                    state.sessionSkillOverrides.set(key, overrides);
                  }
                  if (overrides.has(name)) {
                    overrides.delete(name);
                  } else {
                    overrides.add(name);
                  }
                  // Trigger Lit re-render (Map mutation is not detected automatically)
                  state.sessionSkillOverrides = new Map(state.sessionSkillOverrides);
                },
                // Linked chats popover — list other sessions available for /joinchat
                linkedChats: (() => {
                  const sessions = state.sessionsResult?.sessions ?? [];
                  const currentKey = state.sessionKey;
                  const currentSession = sessions.find((s) => s.key === currentKey);
                  const linked = new Set<string>(
                    ((currentSession as Record<string, unknown>)?.linkedSessions as string[]) ?? [],
                  );
                  // If current chat is in a project, only show other chats from that project
                  const currentProject = state.settings.projects.find((p) =>
                    p.sessionKeys.includes(currentKey),
                  );
                  const projectFilter = currentProject ? new Set(currentProject.sessionKeys) : null;
                  return sessions
                    .filter((s) => s.key !== currentKey && !s.key.endsWith(":main"))
                    .filter((s) => !projectFilter || projectFilter.has(s.key))
                    .map((s) => ({
                      key: s.key,
                      title: s.displayName || s.label || s.key,
                      linked: linked.has(s.key),
                    }));
                })(),
                chatsPopoverOpen: state.chatsPopoverOpen,
                onToggleChatsPopover: () => {
                  state.chatsPopoverOpen = !state.chatsPopoverOpen;
                },
                onToggleChat: (targetKey: string) => {
                  if (!state.client || !state.connected) return;
                  const sessions = state.sessionsResult?.sessions ?? [];
                  const currentKey = state.sessionKey;
                  const currentSession = sessions.find((s) => s.key === currentKey);
                  const current: string[] =
                    ((currentSession as Record<string, unknown>)?.linkedSessions as string[]) ?? [];
                  const next = current.includes(targetKey)
                    ? current.filter((k) => k !== targetKey)
                    : [...current, targetKey];
                  void state.client
                    .request("sessions.patch", {
                      key: currentKey,
                      linkedSessions: next.length > 0 ? next : null,
                    })
                    .then(() => {
                      // Refresh sessions to pick up the updated linkedSessions
                      void loadSessions(state as unknown as Parameters<typeof loadSessions>[0], {
                        activeMinutes: getSessionsActiveMinutes(state.settings),
                      });
                    });
                },
                voiceListening: state.voiceListening,
                // Voice input — toggle on/off with interim results + auto-timeout
                onVoiceInput: () => {
                  // Toggle off if already listening
                  if ((state as unknown as Record<string, unknown>)._sttRecognition) {
                    const rec = (state as unknown as Record<string, unknown>)._sttRecognition as {
                      stop: () => void;
                    };
                    rec.stop();
                    (state as unknown as Record<string, unknown>)._sttRecognition = null;
                    state.voiceListening = false;
                    return;
                  }
                  const w = window as unknown as Record<string, unknown>;
                  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
                  if (!Ctor) {
                    return;
                  }
                  const recognition = new (Ctor as new () => {
                    lang: string;
                    interimResults: boolean;
                    continuous: boolean;
                    start: () => void;
                    stop: () => void;
                    addEventListener: (type: string, cb: (e: unknown) => void) => void;
                  })();
                  recognition.lang = navigator.language || "en-US";
                  recognition.interimResults = true;
                  recognition.continuous = true;
                  (state as unknown as Record<string, unknown>)._sttRecognition = recognition;
                  state.voiceListening = true;
                  // Base text before this STT session started
                  const baseText = state.chatMessage;
                  // Auto-stop after 8s of total silence
                  let silenceTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
                    recognition.stop();
                  }, 8000);
                  recognition.addEventListener("result", (event: unknown) => {
                    // Reset silence timer on each result
                    if (silenceTimer) {
                      clearTimeout(silenceTimer);
                    }
                    silenceTimer = setTimeout(() => {
                      recognition.stop();
                    }, 5000);
                    const e = event as {
                      results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
                      resultIndex: number;
                    };
                    let final = "";
                    let interim = "";
                    for (let i = 0; i < e.results.length; i++) {
                      const result = e.results[i];
                      const text = result[0]?.transcript ?? "";
                      if (result.isFinal) {
                        final += text;
                      } else {
                        interim += text;
                      }
                    }
                    const combined = (final + interim).trim();
                    if (combined) {
                      state.chatMessage = baseText ? `${baseText} ${combined}` : combined;
                    }
                  });
                  const cleanup = () => {
                    if (silenceTimer) {
                      clearTimeout(silenceTimer);
                      silenceTimer = null;
                    }
                    (state as unknown as Record<string, unknown>)._sttRecognition = null;
                    state.voiceListening = false;
                  };
                  recognition.addEventListener("end", cleanup);
                  recognition.addEventListener("error", cleanup);
                  recognition.start();
                },
                // Message actions — truncate then resend
                onRegenerate: (startIndex: number) => {
                  void truncateAndResend(state, startIndex);
                },
                onReadAloud: (text: string) => {
                  void readAloud(state, text);
                },
                ttsPlaying: state.ttsPlaying,
                onEditMessage: (_text: string, startIndex: number) => {
                  state.editingMessageIndex = startIndex;
                  state.editingMessageText = _text;
                  state.editingAttachments =
                    extractMessageAttachments(state.chatMessages[startIndex]) ?? [];
                },
                onResendMessage: (text: string, startIndex: number) => {
                  const atts = extractMessageAttachments(state.chatMessages[startIndex]);
                  void truncateAndSend(state, startIndex, text, atts);
                },
                onSaveEdit: (text: string, messageIndex: number) => {
                  state.editingMessageIndex = null;
                  const atts =
                    state.editingAttachments.length > 0 ? [...state.editingAttachments] : undefined;
                  state.editingAttachments = [];
                  void truncateAndSend(state, messageIndex, text, atts);
                },
                onCancelEdit: () => {
                  state.editingMessageIndex = null;
                  state.editingMessageText = "";
                  state.editingAttachments = [];
                },
                editingMessageIndex: state.editingMessageIndex,
                editingMessageText: state.editingMessageText,
                editingAttachments: state.editingAttachments,
                onEditingAttachmentsChange: (atts: ChatAttachment[]) => {
                  state.editingAttachments = atts;
                },
                onEditingTextChange: (text: string) => {
                  state.editingMessageText = text;
                },
                // Slash command autocomplete
                chatCommands: state.chatCommands,
                slashPopoverOpen: state.slashPopoverOpen,
                slashPopoverIndex: state.slashPopoverIndex,
                onSlashPopoverChange: (open: boolean, index?: number) => {
                  state.slashPopoverOpen = open;
                  if (typeof index === "number") {
                    state.slashPopoverIndex = index;
                  } else if (!open) {
                    state.slashPopoverIndex = 0;
                  }
                },
                onError: (msg: string) => {
                  state.lastError = msg;
                },
                maxAttachmentBytes: (state.settings.maxAttachmentMb ?? 25) * 1024 * 1024,
              })
            : nothing
        }

        ${
          state.tab === "config"
            ? renderConfig({
                raw: state.configRaw,
                originalRaw: state.configRawOriginal,
                valid: state.configValid,
                issues: state.configIssues,
                loading: state.configLoading,
                saving: state.configSaving,
                applying: state.configApplying,
                updating: state.updateRunning,
                connected: state.connected,
                schema: state.configSchema,
                schemaLoading: state.configSchemaLoading,
                uiHints: state.configUiHints,
                formMode: state.configFormMode,
                formValue: state.configForm,
                originalValue: state.configFormOriginal,
                searchQuery: state.configSearchQuery,
                activeSection: state.configActiveSection,
                activeSubsection: state.configActiveSubsection,
                onRawChange: (next) => {
                  state.configRaw = next;
                },
                onFormModeChange: (mode) => (state.configFormMode = mode),
                onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
                onSearchChange: (query) => (state.configSearchQuery = query),
                onSectionChange: (section) => {
                  state.configActiveSection = section;
                  state.configActiveSubsection = null;
                },
                onSubsectionChange: (section) => (state.configActiveSubsection = section),
                onReload: () => loadConfig(state),
                onSave: () => saveConfig(state),
                onApply: () => applyConfig(state),
                onUpdate: () => runUpdate(state),
              })
            : nothing
        }

        ${
          state.tab === "debug"
            ? renderDebug({
                loading: state.debugLoading,
                status: state.debugStatus,
                health: state.debugHealth,
                models: state.debugModels,
                heartbeat: state.debugHeartbeat,
                eventLog: state.eventLog,
                callMethod: state.debugCallMethod,
                callParams: state.debugCallParams,
                callResult: state.debugCallResult,
                callError: state.debugCallError,
                onCallMethodChange: (next) => (state.debugCallMethod = next),
                onCallParamsChange: (next) => (state.debugCallParams = next),
                onRefresh: () => loadDebug(state),
                onCall: () => callDebugMethod(state),
              })
            : nothing
        }

        ${
          state.tab === "logs"
            ? renderLogs({
                loading: state.logsLoading,
                error: state.logsError,
                file: state.logsFile,
                entries: state.logsEntries,
                filterText: state.logsFilterText,
                levelFilters: state.logsLevelFilters,
                autoFollow: state.logsAutoFollow,
                truncated: state.logsTruncated,
                onFilterTextChange: (next) => (state.logsFilterText = next),
                onLevelToggle: (level, enabled) => {
                  state.logsLevelFilters = { ...state.logsLevelFilters, [level]: enabled };
                },
                onToggleAutoFollow: (next) => (state.logsAutoFollow = next),
                onRefresh: () => loadLogs(state, { reset: true }),
                onExport: (lines, label) => state.exportLogs(lines, label),
                onScroll: (event) => state.handleLogsScroll(event),
              })
            : nothing
        }
      </main>
      </div>

      <!-- Context Menu -->
      ${renderContextMenu(state)}

      <!-- Confirmation Modal -->
      ${renderConfirmModal(state)}

      <!-- Search Modal (Cmd+K) -->
      ${renderSearchModal(state)}

      <!-- Settings & Navigation Modal (Unified) -->
      ${renderUnifiedSettings(state)}

      <!-- Archive Modal -->
      ${renderArchiveModal(state)}

      <!-- Project Modal (create/edit) -->
      ${renderProjectModal(state)}

      ${renderExecApprovalPrompt(state)}
      ${renderGatewayUrlConfirmation(state)}
    </div>
  `;
}

/** V2 context menu for conversation items */
function renderContextMenu(state: AppViewState) {
  if (!state.contextMenuOpen) return nothing;

  const closeMenu = () => {
    state.contextMenuOpen = false;
  };

  const handleDeleteSession = () => {
    closeMenu();
    const key = state.contextMenuTarget;
    if (!key) return;
    const session = state.sessionsResult?.sessions?.find((s) => s.key === key);
    const title = sessionTitle(key, session?.displayName, session?.label);
    state.confirmModalTitle = `Delete "${title}"?`;
    state.confirmModalDesc =
      "This action cannot be undone. The conversation and its messages will be permanently removed.";
    state.confirmModalOkLabel = "Delete";
    state.confirmModalAction = () => {
      // Switch away if deleting the active session
      if (state.sessionKey === key) {
        const other = state.sessionsResult?.sessions?.find((s) => s.key !== key);
        state.setSessionKey(other?.key || "main");
      }
      // Actually delete via gateway (bypass window.confirm by calling API directly)
      if (state.client && state.connected) {
        void state.client.request("sessions.delete", { key, deleteTranscript: true }).then(() => {
          void loadSessions(state as unknown as Parameters<typeof loadSessions>[0], {
            activeMinutes: getSessionsActiveMinutes(state.settings),
          });
        });
      }
    };
    state.confirmModalOpen = true;
  };

  const isPinned = state.settings.pinnedSessionKeys.includes(state.contextMenuTarget ?? "");
  const pinSession = () => {
    closeMenu();
    const key = state.contextMenuTarget;
    if (!key) return;
    const current = state.settings.pinnedSessionKeys;
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    state.applySettings({ ...state.settings, pinnedSessionKeys: next });
  };

  const isArchived = state.settings.archivedSessionKeys.includes(state.contextMenuTarget ?? "");
  const archiveSession = () => {
    closeMenu();
    const key = state.contextMenuTarget;
    if (!key) return;
    const current = state.settings.archivedSessionKeys;
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    state.applySettings({ ...state.settings, archivedSessionKeys: next });
  };

  // Project membership for context menu target
  const targetKey = state.contextMenuTarget ?? "";
  const currentProject = state.settings.projects.find((p) => p.sessionKeys.includes(targetKey));
  const availableProjects = state.settings.projects.filter(
    (p) => !p.sessionKeys.includes(targetKey),
  );

  const addToProject = (projectId: string) => {
    closeMenu();
    if (!targetKey) {
      return;
    }
    const updated = state.settings.projects.map((p) =>
      p.id === projectId ? { ...p, sessionKeys: [...p.sessionKeys, targetKey] } : p,
    );
    // Mutual exclusion: remove from pinned
    const pinnedNext = state.settings.pinnedSessionKeys.filter((k) => k !== targetKey);
    state.applySettings({ ...state.settings, projects: updated, pinnedSessionKeys: pinnedNext });

    // Import existing image files from the active session's loaded messages
    const app = state as unknown as {
      chatMessages: unknown[];
      sessionKey: string;
      settings: typeof state.settings;
      applySettings: typeof state.applySettings;
    };
    if (
      app.sessionKey === targetKey &&
      Array.isArray(app.chatMessages) &&
      app.chatMessages.length > 0
    ) {
      const proj = state.settings.projects.find((p) => p.id === projectId);
      const existingIds = new Set(proj?.files.map((f) => f.id) ?? []);
      void import("./controllers/project-files.ts").then((m) =>
        m
          .importChatFilesIntoProject(projectId, targetKey, app.chatMessages, existingIds)
          .then((imported) => {
            if (imported.length > 0) {
              const latest = state.settings.projects.map((p) =>
                p.id === projectId ? { ...p, files: [...p.files, ...imported] } : p,
              );
              state.applySettings({ ...state.settings, projects: latest });
            }
          }),
      );
    }
  };

  const removeFromProject = () => {
    closeMenu();
    if (!targetKey || !currentProject) {
      return;
    }
    const fileIdsToRemove = currentProject.files
      .filter((f) => f.sessionKey === targetKey)
      .map((f) => f.id);
    const updated = state.settings.projects.map((p) =>
      p.id === currentProject.id
        ? {
            ...p,
            sessionKeys: p.sessionKeys.filter((k) => k !== targetKey),
            files: p.files.filter((f) => f.sessionKey !== targetKey),
          }
        : p,
    );
    state.applySettings({ ...state.settings, projects: updated });
    if (fileIdsToRemove.length > 0) {
      void import("./controllers/project-files.ts").then((m) =>
        m.removeProjectFiles(currentProject.id, fileIdsToRemove),
      );
    }
  };

  return html`
    <div
      class="conv-context-menu open"
      style="top: ${state.contextMenuY}px; left: ${state.contextMenuX}px"
      @click=${(e: Event) => e.stopPropagation()}
    >
      ${
        currentProject
          ? nothing
          : html`
      <button class="ctx-item" @click=${pinSession}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${isPinned ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z"/></svg>
        ${isPinned ? "Unpin" : "Pin"}
      </button>
      `
      }
      <button class="ctx-item" @click=${archiveSession}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
        ${isArchived ? "Unarchive" : "Archive"}
      </button>
      ${
        currentProject
          ? html`
          <button class="ctx-item" @click=${removeFromProject}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
            Remove from ${currentProject.name}
          </button>`
          : availableProjects.length > 0
            ? html`
          <div class="ctx-submenu">
            <button class="ctx-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
              Add to project ▸
            </button>
            <div class="ctx-submenu-list">
              ${availableProjects.map(
                (p) => html`
                <button class="ctx-submenu-item" @click=${() => addToProject(p.id)}>
                  <span class="project-color-badge" style="background:${p.color}"></span>
                  ${p.name}
                </button>
              `,
              )}
            </div>
          </div>`
            : nothing
      }
      ${
        state.contextMenuTarget?.endsWith(":main")
          ? nothing
          : html`
      <div class="ctx-separator"></div>
      <button class="ctx-item ctx-danger" @click=${handleDeleteSession}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        Delete
      </button>`
      }
    </div>
  `;
}

/** V2 confirmation modal — generic confirm/cancel dialog */
function renderConfirmModal(state: AppViewState) {
  if (!state.confirmModalOpen) return nothing;

  const close = () => {
    state.confirmModalOpen = false;
    state.confirmModalAction = null;
  };

  const confirm = () => {
    if (state.confirmModalAction) state.confirmModalAction();
    close();
  };

  return html`
    <div class="confirm-modal open">
      <div class="confirm-modal-overlay" @click=${close}></div>
      <div class="confirm-modal-panel">
        <div class="confirm-modal-icon">⚠</div>
        <div class="confirm-modal-title">${state.confirmModalTitle}</div>
        <div class="confirm-modal-desc">${state.confirmModalDesc}</div>
        <div class="confirm-modal-actions">
          <button class="btn btn--sm" @click=${close}>Cancel</button>
          <button class="btn btn--sm btn-danger" @click=${confirm}>${state.confirmModalOkLabel || "Delete"}</button>
        </div>
      </div>
    </div>
  `;
}

/** Search modal (Cmd+K) — ChatGPT-style chat search with date-grouped sessions */
function renderSearchModal(state: AppViewState) {
  if (!state.searchModalOpen) {
    return nothing;
  }

  const query = state.searchQuery.toLowerCase().trim();
  const closeModal = () => {
    state.searchModalOpen = false;
    state.searchQuery = "";
  };

  const switchSession = (key: string) => {
    closeModal();
    state.setSessionKey(key);
    state.setTab("chat");
  };

  // Filter and sort sessions (exclude system sessions like :main)
  const allSessions = (state.sessionsResult?.sessions ?? [])
    .filter((s) => !s.key.endsWith(":main"))
    .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const filtered = query
    ? allSessions.filter((s) => {
        const title = sessionTitle(s.key, s.displayName, s.label).toLowerCase();
        return title.includes(query);
      })
    : allSessions;

  // Group by date
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);

  type DateGroup = { label: string; items: typeof filtered };
  const groups: DateGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const s of filtered) {
    const ts = s.updatedAt ?? 0;
    if (ts >= todayStart.getTime()) {
      groups[0].items.push(s);
    } else if (ts >= yesterdayStart.getTime()) {
      groups[1].items.push(s);
    } else if (ts >= weekStart.getTime()) {
      groups[2].items.push(s);
    } else {
      groups[3].items.push(s);
    }
  }

  const chatCircleIcon = html`
    <svg
      class="search-chat-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
    >
      <circle cx="12" cy="12" r="10" />
    </svg>
  `;

  const renderSessionItem = (s: (typeof filtered)[number]) => html`
    <button class="search-result-item" @click=${() => switchSession(s.key)}>
      ${chatCircleIcon}
      <span class="search-result-text">${sessionTitle(s.key, s.displayName, s.label)}</span>
    </button>
  `;

  const hasResults = filtered.length > 0;

  return html`
    <div class="search-modal open">
      <div class="search-modal-overlay" @click=${closeModal}></div>
      <div class="search-modal-panel">
        <div class="search-modal-input-row">
          <input
            type="text"
            class="search-modal-input"
            placeholder="Search chats..."
            .value=${state.searchQuery}
            @input=${(e: Event) => {
              state.searchQuery = (e.target as HTMLInputElement).value;
            }}
            autofocus
          />
          <button class="search-modal-close" @click=${closeModal} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="search-modal-results">
          <button class="search-result-item search-new-chat" @click=${() => {
            closeModal();
            void state.handleNewSession();
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            New chat
          </button>
          ${groups.map((g) =>
            g.items.length > 0
              ? html`
                <div class="search-results-label">${g.label}</div>
                ${g.items.map(renderSessionItem)}
              `
              : nothing,
          )}
          ${
            !hasResults && query
              ? html`<div class="search-no-results">No results for "${state.searchQuery}"</div>`
              : nothing
          }
        </div>
      </div>
    </div>
  `;
}

/** Format a timestamp for conversation meta display */
function formatConversationDate(ts: number): string {
  const now = new Date();
  const date = new Date(ts);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  if (ts >= todayStart.getTime()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  if (ts >= yesterdayStart.getTime()) {
    return "Yesterday";
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Resolve the canonical main session key from gateway snapshot or fallback */
function resolveMainKey(state: AppViewState): string {
  const snap = state.hello?.snapshot as
    | { sessionDefaults?: { mainSessionKey?: string; mainKey?: string } }
    | undefined;
  return (
    snap?.sessionDefaults?.mainSessionKey?.trim() ||
    snap?.sessionDefaults?.mainKey?.trim() ||
    `agent:${state.agentsList?.defaultId ?? "main"}:main`
  );
}

/** V2 conversations sidebar — groups sessions by date, 2-line items with preview */
function renderConversationsList(state: AppViewState, isChat: boolean) {
  const sessions = state.sessionsResult?.sessions ?? [];

  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);

  const hideDefaultWeb = !state.settings.showDefaultWebSession;
  const archivedKeys = new Set(state.settings.archivedSessionKeys);
  const sorted = [...sessions]
    .filter((s) => !hideDefaultWeb || !isDefaultWebSession(s.key, s.label, s.displayName))
    // Hide archived sessions unless it's the currently active session
    .filter((s) => !archivedKeys.has(s.key) || s.key === state.sessionKey)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  // Separate system sessions (agents) from regular conversations
  const agentSessions = sorted.filter((s) => isSystemSession(s.key));
  const regular = sorted.filter((s) => !isSystemSession(s.key));

  // Agent Main must ALWAYS appear — inject it if the activeMinutes filter excluded it
  if (!agentSessions.some((s) => s.key.endsWith(":main"))) {
    const mainKey = resolveMainKey(state);
    if (isSystemSession(mainKey)) {
      agentSessions.push({ key: mainKey, kind: "direct" as const, updatedAt: now });
    }
  }

  // User-pinned sessions: extract from regular so they appear in the Pinned section
  const pinnedKeys = new Set(state.settings.pinnedSessionKeys);
  const userPinned = regular.filter((s) => pinnedKeys.has(s.key));

  // Project sessions: collect all keys belonging to any project
  const projectSessionKeys = new Set<string>();
  for (const proj of state.settings.projects) {
    for (const k of proj.sessionKeys) {
      projectSessionKeys.add(k);
    }
  }
  const unpinned = regular.filter((s) => !pinnedKeys.has(s.key) && !projectSessionKeys.has(s.key));

  type DateGroup = { label: string; items: typeof sessions };
  const groups: DateGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "This week", items: [] },
    { label: "Older", items: [] },
  ];

  for (const s of unpinned) {
    const ts = s.updatedAt ?? 0;
    if (ts >= todayStart.getTime()) groups[0].items.push(s);
    else if (ts >= yesterdayStart.getTime()) groups[1].items.push(s);
    else if (ts >= weekStart.getTime()) groups[2].items.push(s);
    else groups[3].items.push(s);
  }

  const currentKey = state.sessionKey;
  // Ensure the active session appears somewhere
  const hasCurrentSession =
    sorted.some((s) => s.key === currentKey) ||
    agentSessions.some((s) => s.key === currentKey) ||
    userPinned.some((s) => s.key === currentKey);
  if (!hasCurrentSession && currentKey) {
    if (isSystemSession(currentKey)) {
      agentSessions.push({ key: currentKey, kind: "direct" as const, updatedAt: now });
    } else {
      groups[0].items.unshift({ key: currentKey, kind: "direct" as const, updatedAt: now });
    }
  }

  const renderItem = (s: (typeof sessions)[number], system = false) => {
    const title = sessionTitle(s.key, s.displayName, s.label);
    const isActive = isChat && s.key === currentKey;
    const preview = state.sessionsPreview.get(s.key) ?? "";
    const ts = s.updatedAt ?? null;
    return renderConversationItem(state, s.key, title, preview, ts, isChat, isActive, system);
  };

  // Agents section (always above everything)
  const agentsSection =
    agentSessions.length > 0
      ? html`
        <div class="sidebar-pinned-agents">
          <div class="conversations-group-label">Agents</div>
          ${agentSessions.map((s) => renderItem(s, true))}
        </div>
      `
      : nothing;

  // User-pinned accordion section
  const pinnedCollapsed = state.settings.navGroupsCollapsed["pinned"] ?? false;
  const togglePinned = () => {
    const next = { ...state.settings.navGroupsCollapsed, pinned: !pinnedCollapsed };
    state.applySettings({ ...state.settings, navGroupsCollapsed: next });
  };
  const userPinnedSection =
    userPinned.length > 0
      ? html`
        <div class="sidebar-pinned-chats">
          <button class="sidebar-pinned-header" @click=${togglePinned}>
            <svg class="pinned-chevron ${pinnedCollapsed ? "" : "open"}" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"/></svg>
            <span class="conversations-group-label" style="padding:0">Pinned</span>
            <span class="pinned-count">${userPinned.length}</span>
          </button>
          ${pinnedCollapsed ? nothing : html`<div class="sidebar-pinned-body">${userPinned.map((s) => renderItem(s))}</div>`}
        </div>
      `
      : nothing;

  // Date-grouped regular conversations
  const nonEmpty = groups.filter((g) => g.items.length > 0);
  const hasUpperSections =
    agentSessions.length > 0 || userPinned.length > 0 || state.settings.projects.length > 0;
  const chatLabel =
    nonEmpty.length > 0 && hasUpperSections
      ? html`
          <div class="conversations-group-label">Chat</div>
        `
      : nothing;
  const dateGroups = nonEmpty.map(
    (g) => html`
      <div class="conversations-group-label">${g.label}</div>
      ${g.items.map((s) => renderItem(s))}
    `,
  );

  return {
    pinned: agentsSection,
    chat: html`${userPinnedSection}${chatLabel}${dateGroups}`,
  };
}

/** Strip markup artifacts from preview text for clean sidebar display */
function stripPreviewMarkup(text: string): string {
  return text
    .replace(/\[\[[^\]]*\]\]/g, "") // [[reply_to_current]] etc.
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** → bold
    .replace(/\*([^*]+)\*/g, "$1") // *italic* → italic
    .replace(/__([^_]+)__/g, "$1") // __bold__ → bold
    .replace(/_([^_]+)_/g, "$1") // _italic_ → italic
    .replace(/`([^`]+)`/g, "$1") // `code` → code
    .replace(/^#+\s+/gm, "") // # heading → heading
    .replace(/\s{2,}/g, " ") // collapse whitespace
    .trim();
}

/** Render a single conversation item with 2-line layout */
function renderConversationItem(
  state: AppViewState,
  key: string,
  title: string,
  preview: string,
  ts: number | null,
  isChat: boolean,
  isActive: boolean,
  isSystem = false,
) {
  const dateStr = ts ? formatConversationDate(ts) : "";
  return html`
    <div
      class="conversation-item ${isActive ? "active" : ""}"
      @click=${() => {
        state.contextMenuOpen = false;
        state.activeProjectId = null;
        state.setSessionKey(key);
        state.setTab("chat");
      }}
    >
      <div class="conversation-info">
        <div class="conversation-title">${title}</div>
        ${preview ? html`<div class="conversation-preview">${stripPreviewMarkup(preview)}</div>` : nothing}
      </div>
      ${dateStr ? html`<div class="conversation-meta">${dateStr}</div>` : nothing}
      ${
        isSystem
          ? nothing
          : html`<button
        class="conv-menu-btn"
        title="More"
        @click=${(e: Event) => {
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          state.contextMenuTarget = key;
          state.contextMenuX = Math.min(rect.left, window.innerWidth - 200);
          // Clamp so the menu never overflows the viewport bottom
          const menuH = 140;
          const idealY = rect.bottom + 4;
          state.contextMenuY =
            idealY + menuH > window.innerHeight
              ? Math.max(4, window.innerHeight - menuH - 8)
              : idealY;
          state.contextMenuOpen = true;
        }}
      >⋯</button>`
      }
    </div>
  `;
}

/** @deprecated Old settings modal removed — now using renderUnifiedSettings from views/settings-unified.ts */

/** Archive modal — lists all archived conversations with unarchive action */
function renderArchiveModal(state: AppViewState) {
  if (!state.archiveModalOpen) {
    return nothing;
  }

  const sessions = state.sessionsResult?.sessions ?? [];
  const archivedKeys = state.settings.archivedSessionKeys;
  // Resolve archived sessions with metadata (title, date) from sessions list
  const archivedItems = archivedKeys.map((key) => {
    const session = sessions.find((s) => s.key === key);
    return {
      key,
      title: session ? sessionTitle(key, session.displayName, session.label) : key,
      updatedAt: session?.updatedAt ?? null,
    };
  });

  const unarchive = (key: string) => {
    const next = state.settings.archivedSessionKeys.filter((k) => k !== key);
    state.applySettings({ ...state.settings, archivedSessionKeys: next });
  };

  return html`
    <div class="chat-settings-modal open">
      <div class="chat-settings-overlay" @click=${() => {
        state.archiveModalOpen = false;
      }}></div>
      <div class="chat-settings-panel" style="max-width: 480px">
        <div class="chat-settings-header">
          <div class="settings-brand">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            <strong>Archived Chats</strong>
          </div>
          <button class="btn-icon" @click=${() => {
            state.archiveModalOpen = false;
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="chat-settings-body">
          ${
            archivedItems.length === 0
              ? html`
                  <div class="muted" style="text-align: center; padding: 24px 0">No archived conversations.</div>
                `
              : html`
                <div class="archive-list">
                  ${archivedItems.map(
                    (item) => html`
                      <div class="archive-item">
                        <div class="archive-item-info">
                          <div class="archive-item-title">${item.title}</div>
                          ${item.updatedAt ? html`<div class="archive-item-date">${formatConversationDate(item.updatedAt)}</div>` : nothing}
                        </div>
                        <button class="btn archive-unarchive-btn" @click=${() => unarchive(item.key)}>Unarchive</button>
                      </div>
                    `,
                  )}
                </div>
              `
          }
        </div>
      </div>
    </div>
  `;
}

// ── Project Views ────────────────────────────────────────────────────

const PROJECT_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#6366f1",
];

// Module-scope sidebar accordion state
let _projectsExpanded = true;

// Module-scope form state for project modal (avoids reset on each render)
let _projectFormName = "";
let _projectFormColor = "#22c55e";
let _projectFormEditId: string | null = null;
let _projectFormError = "";

/** Router: renders project detail view when a specific project is active */
function renderProjectView(state: AppViewState) {
  // __list__ is no longer used — only specific project IDs trigger the detail view
  if (state.activeProjectId === "__list__") {
    state.activeProjectId = null;
    return nothing;
  }
  return renderProjectDetailView(state);
}

/** Project detail view — ChatGPT-style layout */
function renderProjectDetailView(state: AppViewState) {
  const proj = state.settings.projects.find((p) => p.id === state.activeProjectId);
  if (!proj) {
    state.activeProjectId = null;
    return nothing;
  }

  const sessions = state.sessionsResult?.sessions ?? [];
  const projSessions = proj.sessionKeys
    .map((k) => sessions.find((s) => s.key === k))
    .filter((s): s is NonNullable<typeof s> => s != null)
    .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const downloadFile = async (fileId: string) => {
    const { getProjectFile } = await import("./controllers/project-files.ts");
    const file = await getProjectFile(proj.id, fileId);
    if (!file) {
      return;
    }
    const a = document.createElement("a");
    a.href = file.dataUrl;
    a.download = file.fileName;
    a.click();
  };

  return html`
    <div class="project-detail">
      <!-- Header: color dot + name + edit | files badge -->
      <div class="project-detail-header">
        <div class="project-detail-title-row">
          <span class="project-color-badge project-color-badge--lg" style="background:${proj.color}"></span>
          <h2 class="project-detail-name">${proj.name}</h2>
          <button class="project-detail-edit-btn" @click=${() => {
            _projectFormName = proj.name;
            _projectFormColor = proj.color;
            _projectFormEditId = proj.id;
            _projectFormError = "";
            state.projectModalOpen = true;
          }} title="Edit project">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
        </div>
        ${
          proj.files.length > 0
            ? html`
          <button class="project-detail-files-badge" @click=${() => {
            const el = document.querySelector(".project-detail-files-panel");
            if (el) {
              el.classList.toggle("open");
            }
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            ${proj.files.length} file${proj.files.length !== 1 ? "s" : ""}
          </button>
          `
            : nothing
        }
      </div>

      <!-- Files dropdown panel (hidden by default, toggled by badge) -->
      ${
        proj.files.length > 0
          ? html`
        <div class="project-detail-files-panel">
          ${proj.files.map(
            (f) => html`
            <button class="project-detail-file-item" @click=${() => void downloadFile(f.id)} title="Download ${f.fileName}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span class="project-detail-file-name">${f.fileName}</span>
              <span class="project-detail-file-size">${projectFormatFileSize(f.sizeBytes)}</span>
            </button>
          `,
          )}
        </div>
        `
          : nothing
      }

      <!-- New chat button -->
      <button class="project-detail-new-chat" @click=${() => {
        void state.handleNewSession();
      }}>
        New chat in ${proj.name}
      </button>

      <!-- Chats list: 2-line items with title, preview, date -->
      <div class="project-detail-chats">
        ${
          projSessions.length === 0
            ? html`
                <div class="project-detail-empty">No chats in this project yet. Start one above.</div>
              `
            : projSessions.map((s) => {
                const title = sessionTitle(s.key, s.displayName, s.label);
                const preview = state.sessionsPreview.get(s.key) ?? "";
                const dateStr = s.updatedAt ? formatConversationDate(s.updatedAt) : "";
                return html`
                <div class="project-detail-chat-item">
                  <button class="project-detail-chat-link" @click=${() => {
                    state.activeProjectId = null;
                    if (state.sessionKey !== s.key) {
                      state.setSessionKey(s.key);
                    }
                    state.setTab("chat");
                  }}>
                    <div class="project-detail-chat-info">
                      <div class="project-detail-chat-title">${title}</div>
                      ${preview ? html`<div class="project-detail-chat-preview">${preview}</div>` : nothing}
                    </div>
                    ${dateStr ? html`<div class="project-detail-chat-date">${dateStr}</div>` : nothing}
                  </button>
                  <button class="project-detail-chat-menu" title="More" @click=${(e: Event) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    state.contextMenuTarget = s.key;
                    state.contextMenuX = Math.min(rect.left, window.innerWidth - 200);
                    const menuH = 180;
                    const idealY = rect.bottom + 4;
                    state.contextMenuY =
                      idealY + menuH > window.innerHeight
                        ? Math.max(4, window.innerHeight - menuH - 8)
                        : idealY;
                    state.contextMenuOpen = true;
                  }}>⋯</button>
                </div>
              `;
              })
        }
      </div>
    </div>
  `;
}

/** Readable file size for project files */
function projectFormatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Project create/edit modal — ChatGPT-style */
function renderProjectModal(state: AppViewState) {
  if (!state.projectModalOpen) {
    return nothing;
  }

  const editId = _projectFormEditId;
  const existing = editId ? state.settings.projects.find((p) => p.id === editId) : null;
  const isEdit = Boolean(existing);

  const save = () => {
    const name = _projectFormName.trim();
    if (!name) {
      _projectFormError = "Name is required.";
      state.projectModalOpen = false;
      state.projectModalOpen = true;
      return;
    }
    if (isEdit && existing) {
      const updated = state.settings.projects.map((p) =>
        p.id === existing.id ? { ...p, name, color: _projectFormColor } : p,
      );
      state.applySettings({ ...state.settings, projects: updated });
    } else {
      const id = `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const newProj: import("./storage.ts").Project = {
        id,
        name,
        color: _projectFormColor,
        sessionKeys: [],
        files: [],
        createdAt: Date.now(),
      };
      state.applySettings({ ...state.settings, projects: [...state.settings.projects, newProj] });
    }
    _projectFormName = "";
    _projectFormColor = PROJECT_COLORS[0];
    _projectFormEditId = null;
    _projectFormError = "";
    state.projectModalOpen = false;
  };

  const deleteProject = () => {
    if (!existing) {
      return;
    }
    if (existing.sessionKeys.length > 0) {
      _projectFormError = "Remove all chats from this project first.";
      state.projectModalOpen = false;
      state.projectModalOpen = true;
      return;
    }
    const updated = state.settings.projects.filter((p) => p.id !== existing.id);
    state.applySettings({ ...state.settings, projects: updated });
    _projectFormName = "";
    _projectFormError = "";
    state.projectModalOpen = false;
    if (state.activeProjectId === existing.id) {
      state.activeProjectId = "__list__";
    }
    void import("./controllers/project-files.ts").then((m) => m.removeAllProjectFiles(existing.id));
  };

  const close = () => {
    _projectFormName = "";
    _projectFormColor = PROJECT_COLORS[0];
    _projectFormEditId = null;
    _projectFormError = "";
    state.projectModalOpen = false;
  };

  return html`
    <div class="project-modal-overlay-wrap open">
      <div class="project-modal-backdrop" @click=${close}></div>
      <div class="project-modal-panel">
        <div class="project-modal-header">
          <h2 class="project-modal-title">${isEdit ? "Edit Project" : "Create a Project"}</h2>
          <div class="project-modal-header-actions">
            ${
              isEdit
                ? html`
              <button class="project-modal-icon-btn project-modal-delete-btn" @click=${deleteProject} title="Delete">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            `
                : nothing
            }
            <button class="project-modal-icon-btn" @click=${close} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div class="project-modal-body">
          <div class="project-modal-input-row">
            <svg class="project-modal-input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
            <input
              class="project-modal-input"
              type="text"
              placeholder="Project name"
              .value=${_projectFormName}
              @input=${(e: Event) => {
                _projectFormName = (e.target as HTMLInputElement).value;
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  save();
                }
              }}
              autofocus
            />
          </div>

          <div class="project-modal-colors">
            ${PROJECT_COLORS.map(
              (c) => html`
              <button
                class="project-modal-color-pill ${c === _projectFormColor ? "active" : ""}"
                style="--pill-color:${c}"
                @click=${() => {
                  _projectFormColor = c;
                  state.projectModalOpen = false;
                  state.projectModalOpen = true;
                }}
              ></button>
            `,
            )}
          </div>

          <div class="project-modal-info">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <p>Projects group chats and files in one place. All documents shared in a project's chats are accessible across every chat in the project. Linked chats are restricted to other chats within the same project.</p>
          </div>

          ${_projectFormError ? html`<div class="project-form-error">${_projectFormError}</div>` : nothing}
        </div>

        <div class="project-modal-footer">
          <button class="project-modal-submit" @click=${save}>
            ${isEdit ? "Save" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  `;
}
