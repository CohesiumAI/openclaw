/**
 * Migration banner - Encourage users in token mode to upgrade to secure mode
 */

import { html, type TemplateResult } from "lit";

export type MigrationBannerProps = {
  onDismiss: () => void;
  onLearnMore: () => void;
  onUpgrade: () => void;
};

export function renderMigrationBanner(props: MigrationBannerProps): TemplateResult {
  const { onDismiss, onLearnMore, onUpgrade } = props;

  return html`
    <div class="migration-banner">
      <div class="migration-banner-icon">ℹ️</div>
      <div class="migration-banner-content">
        <strong>Upgrade to Secure Mode</strong>
        <p>Enable multi-user authentication, 2FA, and cross-browser sync</p>
      </div>
      <div class="migration-banner-actions">
        <button class="btn-link" @click=${onLearnMore}>
          Learn More
        </button>
        <button class="btn-primary-small" @click=${onUpgrade}>
          Upgrade Now
        </button>
        <button class="btn-icon" @click=${onDismiss} title="Dismiss">
          ✕
        </button>
      </div>
    </div>

    <style>
      .migration-banner {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      }

      .migration-banner-icon {
        font-size: 24px;
        flex-shrink: 0;
      }

      .migration-banner-content {
        flex: 1;
      }

      .migration-banner-content strong {
        display: block;
        font-size: 16px;
        margin-bottom: 4px;
      }

      .migration-banner-content p {
        margin: 0;
        font-size: 14px;
        opacity: 0.95;
      }

      .migration-banner-actions {
        display: flex;
        gap: 12px;
        align-items: center;
      }

      .btn-primary-small {
        background: white;
        color: #667eea;
        padding: 8px 16px;
        border-radius: 6px;
        font-weight: 600;
        border: none;
        cursor: pointer;
        transition: background 0.2s;
      }

      .btn-primary-small:hover {
        background: rgba(255, 255, 255, 0.9);
      }

      .btn-link {
        background: none;
        border: none;
        color: white;
        text-decoration: underline;
        cursor: pointer;
        font-size: 14px;
        padding: 4px 8px;
      }

      .btn-link:hover {
        opacity: 0.9;
      }

      .btn-icon {
        background: none;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        padding: 4px 8px;
        opacity: 0.8;
        transition: opacity 0.2s;
      }

      .btn-icon:hover {
        opacity: 1;
      }
    </style>
  `;
}
