import { html, nothing, type TemplateResult } from "lit";
import type { AppViewState } from "../app-view-state.ts";
import type { Tab } from "../navigation.ts";
import type { JsonSchema } from "./config-form.shared.ts";
import {
  isFieldModified,
  UI_SETTINGS_DEFAULTS,
  countModifiedFields,
} from "../controllers/settings-prefill.ts";
import { analyzeConfigSchema } from "./config-form.analyze.ts";
import { renderConfigForm, SECTION_META } from "./config-form.ts";

// -- Types ------------------------------------------------------------------

type SettingsCategory = "quick" | "gateway-section";

type SidebarEntry = {
  id: string;
  label: string;
  icon: TemplateResult;
  category: SettingsCategory;
  /** Gateway config section key (only for category="gateway-section") */
  sectionKey?: string;
};

// -- Icons ------------------------------------------------------------------

const icons = {
  bolt: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  `,
  reset: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  `,
  search: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  `,
  close: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  `,
  home: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  `,
  channels: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  `,
  sessions: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </svg>
  `,
  usage: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 20V10" />
      <path d="M12 20V4" />
      <path d="M6 20v-6" />
    </svg>
  `,
  agents: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6m-6 4h6m-6 4h4" />
    </svg>
  `,
  skills: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon
        points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
      />
    </svg>
  `,
  nodes: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
    </svg>
  `,
  config: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  `,
  logs: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  `,
  archive: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  `,
  docs: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  `,
  gateway: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  `,
  auth: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  `,
  tools: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
      />
    </svg>
  `,
  hooks: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  `,
  plugins: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v3" />
    </svg>
  `,
  models: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path
        d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
      />
    </svg>
  `,
};

// Map gateway section keys to icons
const sectionIconMap: Record<string, TemplateResult> = {
  agents: icons.agents,
  auth: icons.auth,
  channels: icons.channels,
  gateway: icons.gateway,
  tools: icons.tools,
  skills: icons.skills,
  hooks: icons.hooks,
  plugins: icons.plugins,
  models: icons.models,
};

// -- Helpers ----------------------------------------------------------------

/** Build sidebar entries from schema sections */
function buildSidebarEntries(schema: JsonSchema | null): SidebarEntry[] {
  const entries: SidebarEntry[] = [
    { id: "quick", label: "Quick Settings", icon: icons.bolt, category: "quick" },
  ];

  if (!schema || !schema.properties) {
    return entries;
  }

  // Add gateway config sections from schema
  const sectionKeys = Object.keys(schema.properties).toSorted((a, b) => {
    const metaA = SECTION_META[a];
    const metaB = SECTION_META[b];
    if (metaA && !metaB) {
      return -1;
    }
    if (!metaA && metaB) {
      return 1;
    }
    return a.localeCompare(b);
  });

  for (const key of sectionKeys) {
    const meta = SECTION_META[key];
    entries.push({
      id: `gw-${key}`,
      label: meta?.label ?? key.charAt(0).toUpperCase() + key.slice(1),
      icon: sectionIconMap[key] ?? icons.config,
      category: "gateway-section",
      sectionKey: key,
    });
  }

  return entries;
}

// -- Render: Quick Settings -------------------------------------------------

/** Case-insensitive search match helper */
function matchesQuery(label: string, query: string): boolean {
  if (!query) {
    return true;
  }
  return label.toLowerCase().includes(query.toLowerCase());
}

/** Render the Quick Settings section (local-only chat toggles) */
function renderQuickSettings(state: AppViewState) {
  const prefill = state.settingsPrefill;
  const q = state.settingsSearchQuery;

  let visibleCount = 0;

  const toggleRow = (opts: {
    key: string;
    label: string;
    icon: TemplateResult;
    checked: boolean;
    defaultVal: boolean;
    onChange: (v: boolean) => void;
  }) => {
    if (!matchesQuery(opts.label, q)) {
      return nothing;
    }
    visibleCount++;
    const modified = isFieldModified(prefill, opts.key);
    return html`
      <div class="settings-row">
        <div class="settings-row-label">
          ${opts.icon}
          ${opts.label}
          ${modified ? html`<span class="modified-dot" title="Modified from default (${String(opts.defaultVal)})"></span>` : nothing}
        </div>
        <div class="settings-row-actions">
          ${
            modified
              ? html`<button
                class="settings-reset-btn"
                title="Reset to default (${String(opts.defaultVal)})"
                @click=${() => opts.onChange(opts.defaultVal)}
              >${icons.reset}</button>`
              : nothing
          }
          <label class="toggle">
            <input type="checkbox" .checked=${opts.checked} @change=${(e: Event) => {
              opts.onChange((e.target as HTMLInputElement).checked);
            }}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `;
  };

  /** Render a non-toggle row only if it matches search */
  const optionRow = (label: string, content: TemplateResult) => {
    if (!matchesQuery(label, q)) {
      return nothing;
    }
    visibleCount++;
    return content;
  };

  return html`
    <div class="settings-unified__quick">
      <div class="settings-section">
        <div class="settings-section-header">Chat Display</div>
        ${toggleRow({
          key: "ui.chatShowThinking",
          label: "Show thinking",
          icon: html`
            <svg viewBox="0 0 24 24">
              <path
                d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z"
              />
              <line x1="9" y1="21" x2="15" y2="21" />
            </svg>
          `,
          checked: state.settings.chatShowThinking,
          defaultVal: UI_SETTINGS_DEFAULTS.chatShowThinking,
          onChange: (v) => state.applySettings({ ...state.settings, chatShowThinking: v }),
        })}
        ${toggleRow({
          key: "ui.chatFocusMode",
          label: "Focus mode",
          icon: html`
            <svg viewBox="0 0 24 24">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          `,
          checked: state.settings.chatFocusMode,
          defaultVal: UI_SETTINGS_DEFAULTS.chatFocusMode,
          onChange: (v) => state.applySettings({ ...state.settings, chatFocusMode: v }),
        })}
        ${toggleRow({
          key: "ui.chatStreamResponses",
          label: "Stream responses",
          icon: html`
            <svg viewBox="0 0 24 24">
              <path d="M4 17l6-6-6-6" />
              <path d="M12 19h8" />
            </svg>
          `,
          checked: state.settings.chatStreamResponses !== false,
          defaultVal: UI_SETTINGS_DEFAULTS.chatStreamResponses,
          onChange: (v) => state.applySettings({ ...state.settings, chatStreamResponses: v }),
        })}
        ${toggleRow({
          key: "ui.chatRenderMarkdown",
          label: "Render Markdown",
          icon: html`
            <svg viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          `,
          checked: state.settings.chatRenderMarkdown !== false,
          defaultVal: UI_SETTINGS_DEFAULTS.chatRenderMarkdown,
          onChange: (v) => state.applySettings({ ...state.settings, chatRenderMarkdown: v }),
        })}
        ${toggleRow({
          key: "ui.showDefaultWebSession",
          label: "Show default web session",
          icon: html`
            <svg viewBox="0 0 24 24">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          `,
          checked: state.settings.showDefaultWebSession,
          defaultVal: UI_SETTINGS_DEFAULTS.showDefaultWebSession,
          onChange: (v) => state.applySettings({ ...state.settings, showDefaultWebSession: v }),
        })}
      </div>

      <div class="settings-section">
        <div class="settings-section-header">Chat Options</div>
        ${optionRow(
          "Thinking budget",
          html`
          <div class="settings-row">
            <div class="settings-row-label">Thinking budget</div>
            <select class="form-select form-select-sm" .value=${state.chatThinkingLevel || "low"} @change=${(
              e: Event,
            ) => {
              state.chatThinkingLevel = (e.target as HTMLSelectElement).value;
            }}>
              <option value="off">off</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>
        `,
        )}
        ${optionRow(
          "Max attachment size",
          html`
          <div class="settings-row">
            <div class="settings-row-label">
              Max attachment size (MB)
              ${
                isFieldModified(prefill, "ui.maxAttachmentMb")
                  ? html`
                      <span class="modified-dot"></span>
                    `
                  : nothing
              }
            </div>
            <div class="settings-row-actions">
              ${
                isFieldModified(prefill, "ui.maxAttachmentMb")
                  ? html`<button class="settings-reset-btn" title="Reset to default (${UI_SETTINGS_DEFAULTS.maxAttachmentMb})" @click=${() => {
                      state.applySettings({
                        ...state.settings,
                        maxAttachmentMb: UI_SETTINGS_DEFAULTS.maxAttachmentMb,
                      });
                    }}>${icons.reset}</button>`
                  : nothing
              }
              <input type="number" class="form-select form-select-sm" style="width: 80px" min="1" max="100" step="1"
                .value=${String(state.settings.maxAttachmentMb ?? 25)}
                @change=${(e: Event) => {
                  const val = Number((e.target as HTMLInputElement).value);
                  if (Number.isFinite(val) && val > 0) {
                    state.applySettings({ ...state.settings, maxAttachmentMb: val });
                  }
                }} />
            </div>
          </div>
        `,
        )}
        ${optionRow(
          "Chat history",
          html`
          <div class="settings-row">
            <div class="settings-row-label">Chat history</div>
            <select class="form-select form-select-sm" .value=${String(state.settings.sessionsActiveMinutes ?? 0)} @change=${(
              e: Event,
            ) => {
              const val = Number((e.target as HTMLSelectElement).value);
              state.applySettings({ ...state.settings, sessionsActiveMinutes: val });
            }}>
              <option value="0">All conversations</option>
              <option value="120">Last 2 hours</option>
              <option value="360">Last 6 hours</option>
              <option value="720">Last 12 hours</option>
              <option value="1440">Last 24 hours</option>
              <option value="4320">Last 3 days</option>
              <option value="10080">Last 7 days</option>
            </select>
          </div>
        `,
        )}
        ${optionRow(
          "Session",
          html`
          <div class="settings-row">
            <div class="settings-row-label">Session</div>
            <select class="form-select form-select-sm" .value=${state.sessionKey} @change=${(
              e: Event,
            ) => {
              const val = (e.target as HTMLSelectElement).value;
              if (val !== state.sessionKey) {
                state.sessionKey = val;
              }
            }}>
              ${(state.sessionsResult?.sessions ?? []).map(
                (s: Record<string, unknown>) => html`
                <option value=${String(s.key)} ?selected=${String(s.key) === state.sessionKey}>
                  ${String(s.key)}
                </option>
              `,
              )}
            </select>
          </div>
        `,
        )}
      </div>
      ${
        q && visibleCount === 0
          ? html`<div class="settings-empty-search">No settings match "<strong>${q}</strong>"</div>`
          : nothing
      }
    </div>
  `;
}

// -- Render: Gateway Config Section -----------------------------------------

/** Render a single gateway config section using the existing config form renderer */
function renderGatewaySection(state: AppViewState, sectionKey: string) {
  const prefill = state.settingsPrefill;
  if (!prefill.schema || !prefill.gatewayConfig) {
    return html`<div class="muted" style="padding: 24px">
      ${
        prefill.loading
          ? html`
              <div class="settings-prefill-status">
                <span class="dot-pulse"></span> Loading gateway configuration...
              </div>
            `
          : html`<p>Gateway configuration unavailable. ${prefill.error ? html`<br><span class="text-danger">${prefill.error}</span>` : nothing}</p>`
      }
    </div>`;
  }

  const analysis = analyzeConfigSchema(prefill.schema);
  if (!analysis.schema) {
    return html`
      <div class="muted" style="padding: 24px">Schema unavailable for this section.</div>
    `;
  }

  return html`
    <div class="settings-unified__gateway-section">
      ${renderConfigForm({
        schema: analysis.schema,
        value: prefill.gatewayConfig,
        uiHints: prefill.uiHints,
        unsupportedPaths: analysis.unsupportedPaths,
        disabled: true,
        searchQuery: state.settingsSearchQuery,
        activeSection: sectionKey,
        activeSubsection: null,
        onPatch: () => {},
      })}
      <div class="settings-unified__gateway-hint">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        To edit gateway settings, use the <button class="link-btn" @click=${() => {
          state.settingsModalOpen = false;
          state.setTab("config" as Tab);
        }}>Config editor</button>
      </div>
    </div>
  `;
}

// -- Render: Main -----------------------------------------------------------

/** Unified settings panel — sidebar + content area */
export function renderUnifiedSettings(state: AppViewState) {
  if (!state.settingsModalOpen) {
    return nothing;
  }

  const prefill = state.settingsPrefill;
  const schema = prefill.schema as JsonSchema | null;
  const sidebarEntries = buildSidebarEntries(schema);
  const modifiedCount = countModifiedFields(prefill);

  const navigateTo = (tab: Tab) => {
    state.settingsModalOpen = false;
    state.setTab(tab);
  };

  // Determine active entry
  const activeEntry =
    sidebarEntries.find((e) => e.id === state.settingsActiveCategory) ?? sidebarEntries[0];

  // Render content based on active category
  const renderContent = () => {
    if (activeEntry.category === "quick") {
      return renderQuickSettings(state);
    }
    if (activeEntry.category === "gateway-section" && activeEntry.sectionKey) {
      return renderGatewaySection(state, activeEntry.sectionKey);
    }
    return html`
      <div class="muted">Select a category</div>
    `;
  };

  return html`
    <div class="chat-settings-modal open" @keydown=${(e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        state.settingsModalOpen = false;
      }
    }}>
      <div class="chat-settings-overlay" @click=${() => {
        state.settingsModalOpen = false;
      }}></div>
      <div class="settings-unified-panel">
        <!-- Header -->
        <div class="settings-unified__header">
          <div class="settings-brand">
            <span class="brand-logo">🦞</span>
            <strong>OpenClaw</strong>
            <span class="health-dot-sm ${state.connected ? "" : "offline"}"></span>
            ${
              modifiedCount > 0
                ? html`<span class="pill pill--sm">${modifiedCount} modified</span>`
                : nothing
            }
          </div>
          <button class="btn-icon" @click=${() => {
            state.settingsModalOpen = false;
          }}>${icons.close}</button>
        </div>

        <div class="settings-unified__body">
          <!-- Sidebar -->
          <aside class="settings-unified__sidebar">
            <!-- Navigation shortcuts -->
            <div class="settings-unified__nav-section">
              <div class="settings-unified__nav-label">NAVIGATION</div>
              <div class="settings-unified__nav-grid">
                <button class="settings-unified__nav-item" @click=${() => navigateTo("overview")}>${icons.home} Overview</button>
                <button class="settings-unified__nav-item" @click=${() => navigateTo("channels")}>${icons.channels} Channels</button>
                <button class="settings-unified__nav-item" @click=${() => navigateTo("sessions")}>${icons.sessions} Sessions</button>
                <button class="settings-unified__nav-item" @click=${() => navigateTo("agents")}>${icons.agents} Agents</button>
                <button class="settings-unified__nav-item" @click=${() => navigateTo("skills")}>${icons.skills} Skills</button>
                <button class="settings-unified__nav-item" @click=${() => navigateTo("logs")}>${icons.logs} Logs</button>
              </div>
            </div>

            <div class="settings-unified__divider"></div>

            <!-- Search -->
            <div class="settings-unified__search">
              ${icons.search}
              <input
                type="text"
                placeholder="Search settings..."
                .value=${state.settingsSearchQuery}
                @input=${(e: Event) => {
                  state.settingsSearchQuery = (e.target as HTMLInputElement).value;
                }}
              />
              ${
                state.settingsSearchQuery
                  ? html`<button class="settings-unified__search-clear" @click=${() => {
                      state.settingsSearchQuery = "";
                    }}>×</button>`
                  : nothing
              }
            </div>

            <!-- Settings categories -->
            <nav class="settings-unified__cat-nav">
              ${sidebarEntries.map(
                (entry) => html`
                <button
                  class="settings-unified__cat-item ${state.settingsActiveCategory === entry.id ? "active" : ""}"
                  @click=${() => {
                    state.settingsActiveCategory = entry.id;
                  }}
                >
                  <span class="settings-unified__cat-icon">${entry.icon}</span>
                  <span class="settings-unified__cat-label">${entry.label}</span>
                </button>
              `,
              )}
            </nav>
          </aside>

          <!-- Content -->
          <main class="settings-unified__content">
            <div class="settings-unified__content-header">
              <h2>${activeEntry.label}</h2>
              ${
                prefill.loading
                  ? html`
                      <div class="settings-prefill-status"><span class="dot-pulse"></span> Syncing...</div>
                    `
                  : nothing
              }
            </div>
            <div class="settings-unified__content-body">
              ${renderContent()}
            </div>
          </main>
        </div>

        <!-- Footer -->
        <div class="settings-footer">
          UI V2 made with <span class="settings-footer-heart">&hearts;</span> by <a href="https://github.com/CohesiumAI/openclaw" target="_blank" rel="noreferrer">Cohesium AI</a>
        </div>
      </div>
    </div>
  `;
}
