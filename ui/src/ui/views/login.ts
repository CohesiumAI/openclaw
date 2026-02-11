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
