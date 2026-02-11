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
    return { status: "unauthenticated" };
  } catch {
    return { status: "unauthenticated" };
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
