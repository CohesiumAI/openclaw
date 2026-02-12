/**
 * Login view — displayed when user is not authenticated.
 */

import { html, type TemplateResult } from "lit";

export type LoginProps = {
  username: string;
  password: string;
  error: string | null;
  loading: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
};

export type TotpChallengeProps = {
  code: string;
  error: string | null;
  loading: boolean;
  backupMode: boolean;
  onCodeChange: (value: string) => void;
  onSubmit: () => void;
  onToggleBackupMode: () => void;
  onBack: () => void;
};

export function renderTotpChallengeView(props: TotpChallengeProps): TemplateResult {
  const { code, error, loading, backupMode, onCodeChange, onSubmit, onToggleBackupMode, onBack } =
    props;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    onSubmit();
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  };

  return html`
    <div class="login-overlay">
      <div class="login-card">
        <div class="login-header">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            <circle cx="12" cy="16" r="1"></circle>
          </svg>
          <h1>Two-factor authentication</h1>
        </div>
        <form @submit=${handleSubmit}>
          ${error ? html`<div class="login-error">${error}</div>` : ""}
          <label class="login-field">
            <span>${backupMode ? "Backup code" : "6-digit code"}</span>
            <input
              type="text"
              inputmode="${backupMode ? "text" : "numeric"}"
              autocomplete="one-time-code"
              maxlength="${backupMode ? 20 : 6}"
              placeholder="${backupMode ? "Enter backup code" : "000000"}"
              .value=${code}
              @input=${(e: Event) => onCodeChange((e.target as HTMLInputElement).value)}
              @keydown=${handleKeydown}
              ?disabled=${loading}
              autofocus
            />
          </label>
          <button class="login-submit" type="submit" ?disabled=${loading || !code.trim()}>
            ${loading ? "Verifying\u2026" : "Verify"}
          </button>
        </form>
        <div class="totp-links">
          <button class="totp-link-btn" @click=${onToggleBackupMode} ?disabled=${loading}>
            ${backupMode ? "Use authenticator code" : "Use a backup code instead"}
          </button>
          <button class="totp-link-btn" @click=${onBack} ?disabled=${loading}>
            \u2190 Back to login
          </button>
        </div>
      </div>
    </div>
    <style>
      .totp-links {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        margin-top: 1rem;
      }
      .totp-link-btn {
        background: none;
        border: none;
        color: var(--accent-color, #3b82f6);
        font-size: 0.8125rem;
        cursor: pointer;
        padding: 0.25rem 0;
        text-decoration: underline;
        text-decoration-color: transparent;
        transition: text-decoration-color 0.15s;
      }
      .totp-link-btn:hover:not(:disabled) {
        text-decoration-color: currentColor;
      }
      .totp-link-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    </style>
  `;
}

export type SetupProps = {
  username: string;
  password: string;
  passwordConfirm: string;
  recoveryCode: string;
  error: string | null;
  loading: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onPasswordConfirmChange: (value: string) => void;
  onRecoveryCodeChange: (value: string) => void;
  onSubmit: () => void;
};

export function renderSetupView(props: SetupProps): TemplateResult {
  const {
    username,
    password,
    passwordConfirm,
    recoveryCode,
    error,
    loading,
    onUsernameChange,
    onPasswordChange,
    onPasswordConfirmChange,
    onRecoveryCodeChange,
    onSubmit,
  } = props;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    onSubmit();
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  };

  const canSubmit =
    !loading && username.trim().length > 0 && password.length >= 8 && password === passwordConfirm;

  return html`
    <div class="login-overlay">
      <div class="login-card">
        <div class="login-header">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="20" y1="8" x2="20" y2="14" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
          <h1>Welcome to OpenClaw</h1>
        </div>
        <p class="setup-subtitle">Create your admin account to get started.</p>
        <form @submit=${handleSubmit}>
          ${error ? html`<div class="login-error">${error}</div>` : ""}
          <label class="login-field">
            <span>Username</span>
            <input
              type="text"
              autocomplete="username"
              .value=${username}
              @input=${(e: Event) => onUsernameChange((e.target as HTMLInputElement).value)}
              @keydown=${handleKeydown}
              ?disabled=${loading}
              autofocus
            />
          </label>
          <label class="login-field">
            <span>Password <small class="field-hint">(min. 8 characters)</small></span>
            <input
              type="password"
              autocomplete="new-password"
              .value=${password}
              @input=${(e: Event) => onPasswordChange((e.target as HTMLInputElement).value)}
              @keydown=${handleKeydown}
              ?disabled=${loading}
            />
          </label>
          <label class="login-field">
            <span>Confirm password</span>
            <input
              type="password"
              autocomplete="new-password"
              .value=${passwordConfirm}
              @input=${(e: Event) => onPasswordConfirmChange((e.target as HTMLInputElement).value)}
              @keydown=${handleKeydown}
              ?disabled=${loading}
            />
          </label>
          <label class="login-field">
            <span>Recovery code <small class="field-hint">(optional, 8-16 digits)</small></span>
            <input
              type="text"
              inputmode="numeric"
              maxlength="16"
              placeholder="e.g. 12345678"
              .value=${recoveryCode}
              @input=${(e: Event) => onRecoveryCodeChange((e.target as HTMLInputElement).value)}
              @keydown=${handleKeydown}
              ?disabled=${loading}
            />
          </label>
          <button class="login-submit" type="submit" ?disabled=${!canSubmit}>
            ${loading ? "Creating account\u2026" : "Create account"}
          </button>
        </form>
      </div>
    </div>
    <style>
      .setup-subtitle {
        margin: -0.5rem 0 1.25rem;
        color: var(--text-secondary, #aaa);
        font-size: 0.875rem;
      }
      .field-hint {
        font-weight: 400;
        color: var(--text-tertiary, #777);
      }
    </style>
  `;
}

export function renderLoginView(props: LoginProps): TemplateResult {
  const { username, password, error, loading, onUsernameChange, onPasswordChange, onSubmit } =
    props;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    onSubmit();
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit();
    }
  };

  return html`
    <div class="login-overlay">
      <div class="login-card">
        <div class="login-header">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          <h1>OpenClaw</h1>
        </div>
        <form @submit=${handleSubmit}>
          ${error ? html`<div class="login-error">${error}</div>` : ""}
          <label class="login-field">
            <span>Username</span>
            <input
              type="text"
              autocomplete="username"
              .value=${username}
              @input=${(e: Event) => onUsernameChange((e.target as HTMLInputElement).value)}
              @keydown=${handleKeydown}
              ?disabled=${loading}
              autofocus
            />
          </label>
          <label class="login-field">
            <span>Password</span>
            <input
              type="password"
              autocomplete="current-password"
              .value=${password}
              @input=${(e: Event) => onPasswordChange((e.target as HTMLInputElement).value)}
              @keydown=${handleKeydown}
              ?disabled=${loading}
            />
          </label>
          <button class="login-submit" type="submit" ?disabled=${loading || !username || !password}>
            ${loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
    <style>
      .login-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-primary, #0a0a0a);
        z-index: 9999;
      }
      .login-card {
        width: 100%;
        max-width: 380px;
        padding: 2rem;
        border-radius: 12px;
        background: var(--bg-secondary, #1a1a1a);
        border: 1px solid var(--border-color, #333);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      }
      .login-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1.5rem;
        color: var(--text-primary, #fff);
      }
      .login-header h1 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
      }
      .login-error {
        padding: 0.625rem 0.875rem;
        margin-bottom: 1rem;
        border-radius: 8px;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        color: #ef4444;
        font-size: 0.875rem;
      }
      .login-field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        margin-bottom: 1rem;
      }
      .login-field span {
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--text-secondary, #aaa);
      }
      .login-field input {
        padding: 0.625rem 0.75rem;
        border-radius: 8px;
        border: 1px solid var(--border-color, #333);
        background: var(--bg-primary, #0a0a0a);
        color: var(--text-primary, #fff);
        font-size: 0.9375rem;
        outline: none;
        transition: border-color 0.15s;
      }
      .login-field input:focus {
        border-color: var(--accent-color, #3b82f6);
      }
      .login-field input:disabled {
        opacity: 0.5;
      }
      .login-submit {
        width: 100%;
        padding: 0.625rem;
        border-radius: 8px;
        border: none;
        background: var(--accent-color, #3b82f6);
        color: #fff;
        font-size: 0.9375rem;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.15s;
      }
      .login-submit:hover:not(:disabled) {
        opacity: 0.9;
      }
      .login-submit:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    </style>
  `;
}
