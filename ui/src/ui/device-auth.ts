/**
 * Device auth token storage — DISABLED.
 *
 * Auth tokens are now handled exclusively via HttpOnly session cookies
 * set by /auth/login. No secrets are stored in localStorage.
 *
 * These stubs preserve the call-site API so callers don't break,
 * and the module eagerly purges any legacy tokens on import.
 */

export type DeviceAuthEntry = {
  token: string;
  role: string;
  scopes: string[];
  updatedAtMs: number;
};

const LEGACY_STORAGE_KEY = "openclaw.device.auth.v1";

// Purge any legacy tokens left in localStorage from older versions
try {
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
} catch {
  // best-effort — may fail in non-browser environments
}

/** @deprecated Auth tokens are no longer stored client-side. Always returns null. */
export function loadDeviceAuthToken(_params: {
  deviceId: string;
  role: string;
}): DeviceAuthEntry | null {
  return null;
}

/** @deprecated Auth tokens are no longer stored client-side. No-op. */
export function storeDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  token: string;
  scopes?: string[];
}): DeviceAuthEntry {
  return {
    token: "",
    role: params.role,
    scopes: params.scopes ?? [],
    updatedAtMs: Date.now(),
  };
}

/** @deprecated Auth tokens are no longer stored client-side. No-op + purge. */
export function clearDeviceAuthToken(_params: { deviceId: string; role: string }) {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // best-effort
  }
}
