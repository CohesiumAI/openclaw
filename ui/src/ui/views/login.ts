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

// Shared styles for login-overlay, login-card, login-field, login-submit, login-error
const loginBaseStyles = html`
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
    ${loginBaseStyles}
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
    ${loginBaseStyles}
  `;
}

// --- 2FA onboarding views (post-setup "secure by default") ---

export type SetupTotpPromptProps = {
  loading: boolean;
  onSetup: () => void;
  onSkip: () => void;
};

export type SetupTotpQrProps = {
  uri: string;
  secret: string;
  code: string;
  error: string | null;
  loading: boolean;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  onSkip: () => void;
};

export type SetupTotpBackupCodesProps = {
  backupCodes: string[];
  onContinue: () => void;
};

/** Initial prompt encouraging the user to enable 2FA. */
export function renderSetupTotpPromptView(props: SetupTotpPromptProps): TemplateResult {
  const { loading, onSetup, onSkip } = props;
  return html`
    <div class="login-overlay">
      <div class="login-card">
        <div class="login-header">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <h1>Secure your account</h1>
        </div>
        <div class="totp-prompt-warning">
          Your account has no two-factor authentication. We strongly recommend
          enabling 2FA to protect your gateway from unauthorized access.
        </div>
        <button class="login-submit" @click=${onSetup} ?disabled=${loading}>
          ${loading ? "Setting up\u2026" : "Set up 2FA now"}
        </button>
        <div class="totp-links">
          <button class="totp-link-btn totp-skip-btn" @click=${onSkip} ?disabled=${loading}>
            I understand the risks, skip for now
          </button>
        </div>
      </div>
    </div>
    <style>
      .totp-prompt-warning {
        padding: 0.75rem 1rem;
        margin-bottom: 1.25rem;
        border-radius: 8px;
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgba(245, 158, 11, 0.3);
        color: #f59e0b;
        font-size: 0.875rem;
        line-height: 1.5;
      }
      .totp-skip-btn {
        color: var(--text-secondary, #aaa) !important;
      }
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
    ${loginBaseStyles}
  `;
}

/** QR code / manual entry + verify code screen. */
export function renderSetupTotpQrView(props: SetupTotpQrProps): TemplateResult {
  const { uri, secret, code, error, loading, onCodeChange, onVerify, onSkip } = props;

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onVerify();
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
          <h1>Set up 2FA</h1>
        </div>
        <p class="totp-instructions">
          Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):
        </p>
        <div class="totp-qr-container">
          <img
            class="totp-qr-img"
            src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}"
            alt="TOTP QR Code"
            width="200"
            height="200"
          />
        </div>
        <details class="totp-manual-entry">
          <summary>Can't scan? Enter manually</summary>
          <code class="totp-secret-code">${secret}</code>
        </details>
        ${error ? html`<div class="login-error">${error}</div>` : ""}
        <label class="login-field">
          <span>Enter the 6-digit code from your app</span>
          <input
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="000000"
            .value=${code}
            @input=${(e: Event) => onCodeChange((e.target as HTMLInputElement).value)}
            @keydown=${handleKeydown}
            ?disabled=${loading}
            autofocus
          />
        </label>
        <button class="login-submit" @click=${onVerify} ?disabled=${loading || code.trim().length !== 6}>
          ${loading ? "Verifying\u2026" : "Verify & enable 2FA"}
        </button>
        <div class="totp-links">
          <button class="totp-link-btn totp-skip-btn" @click=${onSkip} ?disabled=${loading}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
    <style>
      .totp-instructions {
        font-size: 0.875rem;
        color: var(--text-secondary, #aaa);
        margin: 0 0 1rem 0;
        line-height: 1.5;
      }
      .totp-qr-container {
        display: flex;
        justify-content: center;
        margin-bottom: 1rem;
        padding: 1rem;
        background: #fff;
        border-radius: 8px;
      }
      .totp-qr-img {
        display: block;
      }
      .totp-manual-entry {
        margin-bottom: 1rem;
        font-size: 0.8125rem;
        color: var(--text-secondary, #aaa);
      }
      .totp-manual-entry summary {
        cursor: pointer;
        margin-bottom: 0.5rem;
      }
      .totp-secret-code {
        display: block;
        padding: 0.5rem 0.75rem;
        border-radius: 6px;
        background: var(--bg-primary, #0a0a0a);
        border: 1px solid var(--border-color, #333);
        color: var(--text-primary, #fff);
        font-family: monospace;
        font-size: 0.875rem;
        word-break: break-all;
        user-select: all;
      }
      .totp-skip-btn {
        color: var(--text-secondary, #aaa) !important;
      }
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
    ${loginBaseStyles}
  `;
}

/** Backup codes display after successful TOTP verification. */
export function renderSetupTotpBackupCodesView(props: SetupTotpBackupCodesProps): TemplateResult {
  const { backupCodes, onContinue } = props;
  return html`
    <div class="login-overlay">
      <div class="login-card">
        <div class="login-header">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <h1>2FA enabled</h1>
        </div>
        <div class="totp-success-msg">
          Two-factor authentication is now active. Save these backup codes in a secure place.
          Each code can only be used once.
        </div>
        <div class="totp-backup-codes">
          ${backupCodes.map((c) => html`<code class="totp-backup-code">${c}</code>`)}
        </div>
        <button class="login-submit" @click=${onContinue}>
          I've saved my codes \u2014 continue
        </button>
      </div>
    </div>
    <style>
      .totp-success-msg {
        padding: 0.75rem 1rem;
        margin-bottom: 1rem;
        border-radius: 8px;
        background: rgba(34, 197, 94, 0.1);
        border: 1px solid rgba(34, 197, 94, 0.3);
        color: #22c55e;
        font-size: 0.875rem;
        line-height: 1.5;
      }
      .totp-backup-codes {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
        margin-bottom: 1.25rem;
      }
      .totp-backup-code {
        padding: 0.5rem 0.75rem;
        border-radius: 6px;
        background: var(--bg-primary, #0a0a0a);
        border: 1px solid var(--border-color, #333);
        color: var(--text-primary, #fff);
        font-family: monospace;
        font-size: 0.875rem;
        text-align: center;
        user-select: all;
      }
    </style>
    ${loginBaseStyles}
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
    ${loginBaseStyles}
  `;
}
