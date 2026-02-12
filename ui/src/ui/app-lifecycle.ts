import type { AuthStatus } from "./app-view-state.ts";
import type { Tab } from "./navigation.ts";
import { connectGateway } from "./app-gateway.ts";
import {
  startLogsPolling,
  startNodesPolling,
  stopLogsPolling,
  stopNodesPolling,
  startDebugPolling,
  stopDebugPolling,
} from "./app-polling.ts";
import { observeTopbar, scheduleChatScroll, scheduleLogsScroll } from "./app-scroll.ts";
import {
  applySettingsFromUrl,
  attachThemeListener,
  detachThemeListener,
  inferBasePath,
  syncTabWithLocation,
  syncThemeWithSettings,
} from "./app-settings.ts";
import { onTtsPlayingChange } from "./app-tts.ts";
import { startSessionRefresh, stopSessionRefresh } from "./auth-refresh.ts";
import { checkAuth, fetchCapabilities } from "./auth.ts";

type LifecycleHost = {
  basePath: string;
  tab: Tab;
  chatHasAutoScrolled: boolean;
  chatManualRefreshInFlight: boolean;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatStream: string;
  logsAutoFollow: boolean;
  logsAtBottom: boolean;
  logsEntries: unknown[];
  popStateHandler: () => void;
  topbarObserver: ResizeObserver | null;
  // Auth gate
  authStatus: AuthStatus;
  authUser: { username: string; role: string } | null;
  handleLogout: () => Promise<void>;
  // V2 modal state
  searchModalOpen: boolean;
  searchQuery: string;
  settingsModalOpen: boolean;
  modelSelectorOpen: boolean;
  skillsPopoverOpen: boolean;
  contextMenuOpen: boolean;
  settings: { navCollapsed: boolean; [k: string]: unknown };
  applySettings: (next: Record<string, unknown>) => void;
  _keydownHandler?: (e: KeyboardEvent) => void;
  _clickHandler?: (e: MouseEvent) => void;
};

export function handleConnected(host: LifecycleHost) {
  host.basePath = inferBasePath();
  applySettingsFromUrl(host as unknown as Parameters<typeof applySettingsFromUrl>[0]);
  syncTabWithLocation(host as unknown as Parameters<typeof syncTabWithLocation>[0], true);
  syncThemeWithSettings(host as unknown as Parameters<typeof syncThemeWithSettings>[0]);
  attachThemeListener(host as unknown as Parameters<typeof attachThemeListener>[0]);
  window.addEventListener("popstate", host.popStateHandler);

  // Auto-collapse sidebar on narrow viewports (tablet/mobile)
  if (window.innerWidth <= 1100 && !host.settings.navCollapsed) {
    host.applySettings({ ...host.settings, navCollapsed: true });
  }

  // Cmd+K / Ctrl+K to open search, Escape to close modals
  host._keydownHandler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      host.searchModalOpen = !host.searchModalOpen;
      host.searchQuery = "";
    }
    if (e.key === "Escape") {
      if (host.searchModalOpen) {
        host.searchModalOpen = false;
        e.preventDefault();
      } else if (host.settingsModalOpen) {
        host.settingsModalOpen = false;
        e.preventDefault();
      } else if (host.modelSelectorOpen) {
        host.modelSelectorOpen = false;
        e.preventDefault();
      } else if (host.skillsPopoverOpen) {
        host.skillsPopoverOpen = false;
        e.preventDefault();
      }
    }
  };
  window.addEventListener("keydown", host._keydownHandler);

  // Close context menu on outside click
  host._clickHandler = () => {
    if (host.contextMenuOpen) {
      host.contextMenuOpen = false;
    }
  };
  window.addEventListener("click", host._clickHandler);
  // Wire TTS playing state to the host for visual feedback
  onTtsPlayingChange((playing) => {
    (host as unknown as { ttsPlaying: boolean }).ttsPlaying = playing;
  });
  void checkAuthAndConnect(host);
  startNodesPolling(host as unknown as Parameters<typeof startNodesPolling>[0]);
  if (host.tab === "logs") {
    startLogsPolling(host as unknown as Parameters<typeof startLogsPolling>[0]);
  }
  if (host.tab === "debug") {
    startDebugPolling(host as unknown as Parameters<typeof startDebugPolling>[0]);
  }
}

/** Check /auth/me before connecting the gateway WS. */
async function checkAuthAndConnect(host: LifecycleHost) {
  host.authStatus = "loading";
  const result = await checkAuth(host.basePath);
  if (result.status === "authenticated") {
    host.authStatus = "authenticated";
    host.authUser = { username: result.user.username, role: result.user.role };
    startSessionRefresh(host);
    connectGateway(host as unknown as Parameters<typeof connectGateway>[0]);
  } else if (result.status === "unauthenticated") {
    // Check if first-time setup is needed (no users created yet)
    const caps = await fetchCapabilities(host.basePath);
    host.authStatus = caps.needsSetup ? "needs-setup" : "unauthenticated";
  } else {
    // Network error or 404 — no auth configured, connect directly
    host.authStatus = "no-auth";
    connectGateway(host as unknown as Parameters<typeof connectGateway>[0]);
  }
}

export function handleFirstUpdated(host: LifecycleHost) {
  observeTopbar(host as unknown as Parameters<typeof observeTopbar>[0]);
}

export function handleDisconnected(host: LifecycleHost) {
  stopSessionRefresh();
  window.removeEventListener("popstate", host.popStateHandler);
  if (host._keydownHandler) {
    window.removeEventListener("keydown", host._keydownHandler);
  }
  if (host._clickHandler) {
    window.removeEventListener("click", host._clickHandler);
  }
  stopNodesPolling(host as unknown as Parameters<typeof stopNodesPolling>[0]);
  stopLogsPolling(host as unknown as Parameters<typeof stopLogsPolling>[0]);
  stopDebugPolling(host as unknown as Parameters<typeof stopDebugPolling>[0]);
  detachThemeListener(host as unknown as Parameters<typeof detachThemeListener>[0]);
  host.topbarObserver?.disconnect();
  host.topbarObserver = null;
}

export function handleUpdated(host: LifecycleHost, changed: Map<PropertyKey, unknown>) {
  if (host.tab === "chat" && host.chatManualRefreshInFlight) {
    return;
  }
  if (
    host.tab === "chat" &&
    (changed.has("chatMessages") ||
      changed.has("chatToolMessages") ||
      changed.has("chatStream") ||
      changed.has("chatLoading") ||
      changed.has("tab"))
  ) {
    const forcedByTab = changed.has("tab");
    const forcedByLoad =
      changed.has("chatLoading") && changed.get("chatLoading") === true && !host.chatLoading;
    scheduleChatScroll(
      host as unknown as Parameters<typeof scheduleChatScroll>[0],
      forcedByTab || forcedByLoad || !host.chatHasAutoScrolled,
    );
  }
  if (
    host.tab === "logs" &&
    (changed.has("logsEntries") || changed.has("logsAutoFollow") || changed.has("tab"))
  ) {
    if (host.logsAutoFollow && host.logsAtBottom) {
      scheduleLogsScroll(
        host as unknown as Parameters<typeof scheduleLogsScroll>[0],
        changed.has("tab") || changed.has("logsAutoFollow"),
      );
    }
  }
}
