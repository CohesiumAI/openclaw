/**
 * Automatic session refresh (sliding window) for the Control UI.
 * Calls /auth/refresh periodically while the user is active.
 * Pauses when the tab is hidden (Page Visibility API).
 * On refresh failure (401), redirects to login screen.
 */

import { refreshSession } from "./auth.ts";

/** Refresh interval: 5 minutes — well before the 30 min session TTL. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** After returning from a hidden tab, refresh immediately if hidden > 10 min. */
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

type SessionRefreshHost = {
  basePath: string;
  authStatus: string;
  handleLogout: () => Promise<void>;
};

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;
let lastRefreshAt = 0;
let currentHost: SessionRefreshHost | null = null;

async function doRefresh(): Promise<void> {
  if (!currentHost || currentHost.authStatus !== "authenticated") {
    return;
  }
  const ok = await refreshSession(currentHost.basePath);
  if (ok) {
    lastRefreshAt = Date.now();
  } else {
    // Session expired server-side — force logout to show login screen
    void currentHost.handleLogout();
  }
}

function handleVisibilityChange(): void {
  if (document.hidden) {
    // Tab hidden — pause the timer to save resources
    stopTimer();
  } else {
    // Tab visible again — check if session may be stale
    const elapsed = Date.now() - lastRefreshAt;
    if (elapsed >= STALE_THRESHOLD_MS) {
      void doRefresh();
    }
    startTimer();
  }
}

function startTimer(): void {
  if (refreshTimer) {
    return;
  }
  refreshTimer = setInterval(() => {
    void doRefresh();
  }, REFRESH_INTERVAL_MS);
}

function stopTimer(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/** Start automatic session refresh. Call after successful login or auth check. */
export function startSessionRefresh(host: SessionRefreshHost): void {
  stopSessionRefresh();
  currentHost = host;
  lastRefreshAt = Date.now();
  startTimer();
  visibilityHandler = handleVisibilityChange;
  document.addEventListener("visibilitychange", visibilityHandler);
}

/** Stop automatic session refresh. Call on logout or disconnect. */
export function stopSessionRefresh(): void {
  stopTimer();
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  currentHost = null;
}
