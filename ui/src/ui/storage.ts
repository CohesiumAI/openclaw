const KEY = "openclaw.control.settings.v1";

import type { ThemeMode } from "./theme.ts";

export type ProjectFile = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sessionKey: string; // Chat that contributed this file
  addedAt: number;
};

export type Project = {
  id: string; // "proj-<uuid>"
  name: string;
  color: string; // CSS color for sidebar badge
  sessionKeys: string[]; // Chat session keys in this project
  files: ProjectFile[]; // File metadata (binary data in IndexedDB)
  createdAt: number;
};

export type UiSettings = {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  lastActiveSessionKey: string;
  theme: ThemeMode;
  chatFocusMode: boolean;
  chatShowThinking: boolean;
  chatStreamResponses: boolean;
  chatRenderMarkdown: boolean;
  splitRatio: number; // Sidebar split ratio (0.4 to 0.7, default 0.6)
  navCollapsed: boolean; // Collapsible sidebar state
  navGroupsCollapsed: Record<string, boolean>; // Which nav groups are collapsed
  showDefaultWebSession: boolean; // Show the default Agent-Main-Web session in sidebar
  sessionsActiveMinutes: number; // Sidebar filter: 0 = show all, >0 = only sessions updated within N minutes
  ttsAutoPlay: boolean; // Auto-play TTS on assistant responses
  maxAttachmentMb: number; // Max file attachment size in MB
  pinnedSessionKeys: string[]; // User-pinned chat sessions shown above date groups
  archivedSessionKeys: string[]; // Archived chats hidden from sidebar
  projects: Project[]; // User-created project groups
};

export function loadSettings(): UiSettings {
  const defaultUrl = (() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}`;
  })();

  const defaults: UiSettings = {
    gatewayUrl: defaultUrl,
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
  };

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      gatewayUrl:
        typeof parsed.gatewayUrl === "string" && parsed.gatewayUrl.trim()
          ? parsed.gatewayUrl.trim()
          : defaults.gatewayUrl,
      token: "", // Never load token from localStorage — auth uses HttpOnly cookies
      sessionKey:
        typeof parsed.sessionKey === "string" && parsed.sessionKey.trim()
          ? parsed.sessionKey.trim()
          : defaults.sessionKey,
      lastActiveSessionKey:
        typeof parsed.lastActiveSessionKey === "string" && parsed.lastActiveSessionKey.trim()
          ? parsed.lastActiveSessionKey.trim()
          : (typeof parsed.sessionKey === "string" && parsed.sessionKey.trim()) ||
            defaults.lastActiveSessionKey,
      theme:
        parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system"
          ? parsed.theme
          : defaults.theme,
      chatFocusMode:
        typeof parsed.chatFocusMode === "boolean" ? parsed.chatFocusMode : defaults.chatFocusMode,
      chatShowThinking:
        typeof parsed.chatShowThinking === "boolean"
          ? parsed.chatShowThinking
          : defaults.chatShowThinking,
      chatStreamResponses:
        typeof parsed.chatStreamResponses === "boolean"
          ? parsed.chatStreamResponses
          : defaults.chatStreamResponses,
      chatRenderMarkdown:
        typeof parsed.chatRenderMarkdown === "boolean"
          ? parsed.chatRenderMarkdown
          : defaults.chatRenderMarkdown,
      splitRatio:
        typeof parsed.splitRatio === "number" &&
        parsed.splitRatio >= 0.4 &&
        parsed.splitRatio <= 0.7
          ? parsed.splitRatio
          : defaults.splitRatio,
      navCollapsed:
        typeof parsed.navCollapsed === "boolean" ? parsed.navCollapsed : defaults.navCollapsed,
      navGroupsCollapsed:
        typeof parsed.navGroupsCollapsed === "object" && parsed.navGroupsCollapsed !== null
          ? parsed.navGroupsCollapsed
          : defaults.navGroupsCollapsed,
      showDefaultWebSession:
        typeof parsed.showDefaultWebSession === "boolean"
          ? parsed.showDefaultWebSession
          : defaults.showDefaultWebSession,
      sessionsActiveMinutes:
        typeof parsed.sessionsActiveMinutes === "number" &&
        Number.isFinite(parsed.sessionsActiveMinutes) &&
        parsed.sessionsActiveMinutes >= 0
          ? parsed.sessionsActiveMinutes
          : defaults.sessionsActiveMinutes,
      ttsAutoPlay:
        typeof parsed.ttsAutoPlay === "boolean" ? parsed.ttsAutoPlay : defaults.ttsAutoPlay,
      maxAttachmentMb:
        typeof parsed.maxAttachmentMb === "number" &&
        Number.isFinite(parsed.maxAttachmentMb) &&
        parsed.maxAttachmentMb > 0
          ? parsed.maxAttachmentMb
          : defaults.maxAttachmentMb,
      pinnedSessionKeys:
        Array.isArray(parsed.pinnedSessionKeys) &&
        parsed.pinnedSessionKeys.every((k) => typeof k === "string")
          ? parsed.pinnedSessionKeys
          : defaults.pinnedSessionKeys,
      archivedSessionKeys:
        Array.isArray(parsed.archivedSessionKeys) &&
        parsed.archivedSessionKeys.every((k) => typeof k === "string")
          ? parsed.archivedSessionKeys
          : defaults.archivedSessionKeys,
      projects:
        Array.isArray(parsed.projects) &&
        parsed.projects.every(
          (p) =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as Record<string, unknown>).id === "string" &&
            typeof (p as Record<string, unknown>).name === "string",
        )
          ? (parsed.projects as Project[])
          : defaults.projects,
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(next: UiSettings) {
  // Strip sensitive fields before persisting — token must never be in localStorage
  const { token: _token, ...safe } = next;
  localStorage.setItem(KEY, JSON.stringify({ ...safe, token: "" }));
}

const MIGRATION_THINKING_KEY = "openclaw.migration.thinking-default-off";

/** One-shot migration: flip chatShowThinking to false for existing users. */
export function migrateSettings(settings: UiSettings): UiSettings {
  if (!localStorage.getItem(MIGRATION_THINKING_KEY)) {
    localStorage.setItem(MIGRATION_THINKING_KEY, "1");
    if (settings.chatShowThinking) {
      const next = { ...settings, chatShowThinking: false };
      saveSettings(next);
      return next;
    }
  }
  return settings;
}
