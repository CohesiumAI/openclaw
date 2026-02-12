/**
 * Auth API client for the Control UI.
 * Talks to /auth/* endpoints on the gateway.
 */

export type AuthUser = {
  username: string;
  role: string;
  scopes: string[];
};

export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser; csrfToken: string }
  | { status: "unauthenticated" }
  | { status: "no-auth" }
  | { status: "totp-required"; challengeSessionId: string }
  | { status: "error"; message: string };

let csrfToken: string | null = null;

/** Get the current CSRF token (set after login or /auth/me). */
export function getCsrfToken(): string | null {
  return csrfToken;
}

/** Check current auth status via /auth/me. */
export async function checkAuth(basePath = ""): Promise<AuthState> {
  try {
    const res = await fetch(`${basePath}/auth/me`, {
      credentials: "same-origin",
    });
    if (res.ok) {
      const data = (await res.json()) as {
        ok: boolean;
        user: AuthUser;
        csrfToken: string;
      };
      csrfToken = data.csrfToken;
      return { status: "authenticated", user: data.user, csrfToken: data.csrfToken };
    }
    // 401 = auth configured, user not logged in
    if (res.status === 401) {
      return { status: "unauthenticated" };
    }
    // 404 or other = no auth endpoints on this gateway
    return { status: "no-auth" };
  } catch {
    // Network error — gateway may not have auth configured
    return { status: "no-auth" };
  }
}

/** Login with username/password. */
export async function login(username: string, password: string, basePath = ""): Promise<AuthState> {
  try {
    const res = await fetch(`${basePath}/auth/login`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      user?: AuthUser;
      csrfToken?: string;
      totpRequired?: boolean;
      challengeSessionId?: string;
      error?: { message: string; type: string };
    };
    if (res.ok && data.ok && data.user) {
      csrfToken = data.csrfToken ?? null;
      return {
        status: "authenticated",
        user: data.user,
        csrfToken: data.csrfToken ?? "",
      };
    }
    // TOTP challenge required — partial session created server-side
    if (data.totpRequired && data.challengeSessionId) {
      return {
        status: "totp-required",
        challengeSessionId: data.challengeSessionId,
      };
    }
    return {
      status: "error",
      message: data.error?.message ?? "Login failed",
    };
  } catch {
    return { status: "error", message: "Network error" };
  }
}

/** Logout — clears session cookie. */
export async function logout(basePath = ""): Promise<void> {
  try {
    await fetch(`${basePath}/auth/logout`, {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    // Best effort
  }
  csrfToken = null;
}

/** Revoke all sessions for the current user (forces re-login on all devices). */
export async function revokeAllSessions(
  basePath = "",
): Promise<{ ok: boolean; revokedCount?: number }> {
  try {
    const res = await fetch(`${basePath}/auth/revoke-all`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (res.ok) {
      const data = (await res.json()) as { ok: boolean; revokedCount: number };
      csrfToken = null;
      return data;
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Submit a TOTP code to complete 2FA login. */
export async function submitTotpChallenge(
  challengeSessionId: string,
  code: string,
  basePath = "",
): Promise<AuthState> {
  try {
    const res = await fetch(`${basePath}/auth/totp/challenge`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeSessionId, code }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      user?: AuthUser;
      csrfToken?: string;
      error?: { message: string; type: string };
    };
    if (res.ok && data.ok && data.user) {
      csrfToken = data.csrfToken ?? null;
      return {
        status: "authenticated",
        user: data.user,
        csrfToken: data.csrfToken ?? "",
      };
    }
    return {
      status: "error",
      message: data.error?.message ?? "Invalid code",
    };
  } catch {
    return { status: "error", message: "Network error" };
  }
}

/** Submit a backup code to complete 2FA login. */
export async function submitTotpBackup(
  challengeSessionId: string,
  backupCode: string,
  basePath = "",
): Promise<AuthState> {
  try {
    const res = await fetch(`${basePath}/auth/totp/backup`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeSessionId, backupCode }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      user?: AuthUser;
      csrfToken?: string;
      error?: { message: string; type: string };
    };
    if (res.ok && data.ok && data.user) {
      csrfToken = data.csrfToken ?? null;
      return {
        status: "authenticated",
        user: data.user,
        csrfToken: data.csrfToken ?? "",
      };
    }
    return {
      status: "error",
      message: data.error?.message ?? "Invalid backup code",
    };
  } catch {
    return { status: "error", message: "Network error" };
  }
}

/** Fetch gateway capabilities (feature flags). */
export async function fetchCapabilities(
  basePath = "",
): Promise<{ needsSetup?: boolean; hasUserManagement?: boolean; has2fa?: boolean }> {
  try {
    const res = await fetch(`${basePath}/auth/capabilities`, {
      credentials: "same-origin",
    });
    if (res.ok) {
      return (await res.json()) as {
        needsSetup?: boolean;
        hasUserManagement?: boolean;
        has2fa?: boolean;
      };
    }
    return {};
  } catch {
    return {};
  }
}

/** First-time setup: create the initial admin user. */
export async function setupFirstUser(
  params: { username: string; password: string; recoveryCode?: string },
  basePath = "",
): Promise<AuthState> {
  try {
    const res = await fetch(`${basePath}/auth/setup`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      user?: AuthUser;
      csrfToken?: string;
      error?: { message: string; type: string };
    };
    if (res.ok && data.ok && data.user) {
      csrfToken = data.csrfToken ?? null;
      return { status: "authenticated", user: data.user, csrfToken: data.csrfToken ?? "" };
    }
    return { status: "error", message: data.error?.message ?? "Setup failed" };
  } catch {
    return { status: "error", message: "Network error" };
  }
}

/** Change password for the current authenticated user. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  basePath = "",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = getCsrfToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers["x-csrf-token"] = token;
    }
    const res = await fetch(`${basePath}/auth/change-password`, {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (res.ok) {
      return { ok: true };
    }
    const data = (await res.json()) as { error?: { message: string } };
    return { ok: false, error: data.error?.message ?? "Password change failed" };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

/** Refresh session (sliding window). */
export async function refreshSession(basePath = ""): Promise<boolean> {
  try {
    const res = await fetch(`${basePath}/auth/refresh`, {
      method: "POST",
      credentials: "same-origin",
    });
    return res.ok;
  } catch {
    return false;
  }
}
