import type { GatewayAuthChoice } from "../commands/onboard-types.js";
import type { GatewayBindMode, GatewayTailscaleMode, OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type {
  GatewayWizardSettings,
  QuickstartGatewayDefaults,
  WizardFlow,
} from "./onboarding.types.js";
import type { WizardPrompter } from "./prompts.js";
import { normalizeGatewayTokenInput, randomToken } from "../commands/onboard-helpers.js";
import { hashPassword } from "../gateway/auth-password.js";
import {
  buildTotpUri,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  verifyTotp,
} from "../gateway/auth-totp.js";
import { createGatewayUser } from "../infra/auth-credentials.js";
import { findTailscaleBinary } from "../infra/tailscale.js";

// These commands are "high risk" (privacy writes/recording) and should be
// explicitly armed by the user when they want to use them.
//
// This only affects what the gateway will accept via node.invoke; the iOS app
// still prompts for OS permissions (camera/photos/contacts/etc) on first use.
const DEFAULT_DANGEROUS_NODE_DENY_COMMANDS = [
  "camera.snap",
  "camera.clip",
  "screen.record",
  "calendar.add",
  "contacts.add",
  "reminders.add",
];

type ConfigureGatewayOptions = {
  flow: WizardFlow;
  baseConfig: OpenClawConfig;
  nextConfig: OpenClawConfig;
  localPort: number;
  quickstartGateway: QuickstartGatewayDefaults;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
};

type ConfigureGatewayResult = {
  nextConfig: OpenClawConfig;
  settings: GatewayWizardSettings;
};

export async function configureGatewayForOnboarding(
  opts: ConfigureGatewayOptions,
): Promise<ConfigureGatewayResult> {
  const { flow, localPort, quickstartGateway, prompter } = opts;
  let { nextConfig } = opts;

  const port =
    flow === "quickstart"
      ? quickstartGateway.port
      : Number.parseInt(
          String(
            await prompter.text({
              message: "Gateway port",
              initialValue: String(localPort),
              validate: (value) => (Number.isFinite(Number(value)) ? undefined : "Invalid port"),
            }),
          ),
          10,
        );

  let bind: GatewayWizardSettings["bind"] =
    flow === "quickstart"
      ? quickstartGateway.bind
      : await prompter.select<GatewayWizardSettings["bind"]>({
          message: "Gateway bind",
          options: [
            { value: "loopback", label: "Loopback (127.0.0.1)" },
            { value: "lan", label: "LAN (0.0.0.0)" },
            { value: "tailnet", label: "Tailnet (Tailscale IP)" },
            { value: "auto", label: "Auto (Loopback → LAN)" },
            { value: "custom", label: "Custom IP" },
          ],
        });

  let customBindHost = quickstartGateway.customBindHost;
  if (bind === "custom") {
    const needsPrompt = flow !== "quickstart" || !customBindHost;
    if (needsPrompt) {
      const input = await prompter.text({
        message: "Custom IP address",
        placeholder: "192.168.1.100",
        initialValue: customBindHost ?? "",
        validate: (value) => {
          if (!value) {
            return "IP address is required for custom bind mode";
          }
          const trimmed = value.trim();
          const parts = trimmed.split(".");
          if (parts.length !== 4) {
            return "Invalid IPv4 address (e.g., 192.168.1.100)";
          }
          if (
            parts.every((part) => {
              const n = parseInt(part, 10);
              return !Number.isNaN(n) && n >= 0 && n <= 255 && part === String(n);
            })
          ) {
            return undefined;
          }
          return "Invalid IPv4 address (each octet must be 0-255)";
        },
      });
      customBindHost = typeof input === "string" ? input.trim() : undefined;
    }
  }

  let authMode =
    flow === "quickstart"
      ? quickstartGateway.authMode
      : ((await prompter.select({
          message: "Gateway auth",
          options: [
            {
              value: "token",
              label: "Token",
              hint: "Recommended default (local + remote)",
            },
            { value: "password", label: "Password" },
          ],
          initialValue: "token",
        })) as GatewayAuthChoice);

  const tailscaleMode: GatewayWizardSettings["tailscaleMode"] =
    flow === "quickstart"
      ? quickstartGateway.tailscaleMode
      : await prompter.select<GatewayWizardSettings["tailscaleMode"]>({
          message: "Tailscale exposure",
          options: [
            { value: "off", label: "Off", hint: "No Tailscale exposure" },
            {
              value: "serve",
              label: "Serve",
              hint: "Private HTTPS for your tailnet (devices on Tailscale)",
            },
            {
              value: "funnel",
              label: "Funnel",
              hint: "Public HTTPS via Tailscale Funnel (internet)",
            },
          ],
        });

  // Detect Tailscale binary before proceeding with serve/funnel setup.
  if (tailscaleMode !== "off") {
    const tailscaleBin = await findTailscaleBinary();
    if (!tailscaleBin) {
      await prompter.note(
        [
          "Tailscale binary not found in PATH or /Applications.",
          "Ensure Tailscale is installed from:",
          "  https://tailscale.com/download/mac",
          "",
          "You can continue setup, but serve/funnel will fail at runtime.",
        ].join("\n"),
        "Tailscale Warning",
      );
    }
  }

  let tailscaleResetOnExit = flow === "quickstart" ? quickstartGateway.tailscaleResetOnExit : false;
  if (tailscaleMode !== "off" && flow !== "quickstart") {
    await prompter.note(
      ["Docs:", "https://docs.openclaw.ai/gateway/tailscale", "https://docs.openclaw.ai/web"].join(
        "\n",
      ),
      "Tailscale",
    );
    tailscaleResetOnExit = Boolean(
      await prompter.confirm({
        message: "Reset Tailscale serve/funnel on exit?",
        initialValue: false,
      }),
    );
  }

  // Safety + constraints:
  // - Tailscale wants bind=loopback so we never expose a non-loopback server + tailscale serve/funnel at once.
  // - Funnel requires password auth.
  if (tailscaleMode !== "off" && bind !== "loopback") {
    await prompter.note("Tailscale requires bind=loopback. Adjusting bind to loopback.", "Note");
    bind = "loopback";
    customBindHost = undefined;
  }

  if (tailscaleMode === "funnel" && authMode !== "password") {
    await prompter.note("Tailscale funnel requires password auth.", "Note");
    authMode = "password";
  }

  let gatewayToken: string | undefined;
  if (authMode === "token") {
    if (flow === "quickstart") {
      gatewayToken = quickstartGateway.token ?? randomToken();
    } else {
      const tokenInput = await prompter.text({
        message: "Gateway token (blank to generate)",
        placeholder: "Needed for multi-machine or non-loopback access",
        initialValue: quickstartGateway.token ?? "",
      });
      gatewayToken = normalizeGatewayTokenInput(tokenInput) || randomToken();
    }
  }

  if (authMode === "password") {
    // Offer hashed credentials (recommended) vs legacy shared password
    type PasswordMode = "hashed" | "legacy";
    const passwordMode: PasswordMode =
      flow === "quickstart"
        ? "legacy"
        : await prompter.select<PasswordMode>({
            message: "Password auth mode",
            options: [
              {
                value: "hashed",
                label: "Hashed credentials (recommended)",
                hint: "Create a user account with scrypt-hashed password",
              },
              {
                value: "legacy",
                label: "Shared password (legacy)",
                hint: "Single password in config file",
              },
            ],
          });

    if (passwordMode === "hashed") {
      // Create a gateway user with hashed credentials
      const username = await prompter.text({
        message: "Admin username",
        initialValue: "admin",
        validate: (v) => {
          if (!v || v.trim().length < 2) {
            return "Minimum 2 characters";
          }
        },
      });
      const pwd = await prompter.text({
        message: "Password (min 8 chars)",
        validate: (v) => {
          if (!v || v.trim().length < 8) {
            return "Minimum 8 characters";
          }
        },
      });
      const recoveryCode = await prompter.text({
        message: "Recovery code (8-16 digits, for password reset)",
        validate: (v) => {
          if (!v || !/^\d{8,16}$/.test(v.trim())) {
            return "Must be 8 to 16 digits";
          }
        },
      });

      const [passwordHash, recoveryCodeHash] = await Promise.all([
        hashPassword(String(pwd).trim()),
        hashPassword(String(recoveryCode).trim()),
      ]);

      const created = createGatewayUser({
        username: String(username).trim(),
        passwordHash,
        role: "admin",
        recoveryCodeHash,
      });
      if (!created) {
        await prompter.note(`User "${username}" already exists. Skipping creation.`, "Note");
      } else {
        await prompter.note(`User "${username}" created (admin).`, "User Created");
      }

      // Optional 2FA setup
      const want2fa = await prompter.confirm({
        message: "Enable two-factor authentication (TOTP)?",
        initialValue: false,
      });
      if (want2fa) {
        const secret = generateTotpSecret();
        const uri = buildTotpUri(secret, String(username).trim());
        await prompter.note(
          [
            `TOTP secret: ${secret}`,
            "",
            `otpauth URI: ${uri}`,
            "",
            "Add this to your authenticator app, then enter the 6-digit code.",
          ].join("\n"),
          "2FA Setup",
        );
        const totpCode = await prompter.text({
          message: "6-digit code from authenticator",
          validate: (v) => {
            if (!v || !/^\d{6}$/.test(v.trim())) {
              return "Must be a 6-digit code";
            }
          },
        });
        const matched = verifyTotp(secret, String(totpCode).trim());
        if (matched) {
          const backupCodes = generateBackupCodes(10);
          const backupHashes = await hashBackupCodes(backupCodes);
          const { updateGatewayUserTotp } = await import("../infra/auth-credentials.js");
          updateGatewayUserTotp(String(username).trim(), {
            totpSecret: secret,
            totpEnabled: true,
            lastUsedTotpCode: matched,
            backupCodeHashes: backupHashes,
          });
          await prompter.note(
            ["2FA enabled. Save these backup codes:", "", ...backupCodes.map((c) => `  ${c}`)].join(
              "\n",
            ),
            "Backup Codes",
          );
        } else {
          await prompter.note(
            "Invalid TOTP code. 2FA not enabled. You can set it up later via: openclaw gateway user totp-setup",
            "2FA Skipped",
          );
        }
      }

      // Don't write plaintext password to config in hashed mode
      nextConfig = {
        ...nextConfig,
        gateway: {
          ...nextConfig.gateway,
          auth: {
            ...nextConfig.gateway?.auth,
            mode: "password",
          },
        },
      };
    } else {
      // Legacy shared password mode
      const password =
        flow === "quickstart" && quickstartGateway.password
          ? quickstartGateway.password
          : await prompter.text({
              message: "Gateway password",
              validate: (value) => (value?.trim() ? undefined : "Required"),
            });
      nextConfig = {
        ...nextConfig,
        gateway: {
          ...nextConfig.gateway,
          auth: {
            ...nextConfig.gateway?.auth,
            mode: "password",
            password: String(password).trim(),
          },
        },
      };
    }
  } else if (authMode === "token") {
    nextConfig = {
      ...nextConfig,
      gateway: {
        ...nextConfig.gateway,
        auth: {
          ...nextConfig.gateway?.auth,
          mode: "token",
          token: gatewayToken,
        },
      },
    };
  }

  // TLS / reverse proxy setup (advanced flow only)
  type TlsChoice = "off" | "self-signed" | "custom" | "reverse-proxy";
  let tlsChoice: TlsChoice = "off";
  let tlsCertPath: string | undefined;
  let tlsKeyPath: string | undefined;
  let trustedProxies: string[] | undefined;

  if (flow !== "quickstart" && tailscaleMode === "off") {
    tlsChoice = await prompter.select<TlsChoice>({
      message: "HTTPS / TLS",
      options: [
        { value: "off", label: "No TLS (plain HTTP)", hint: "Default for loopback" },
        { value: "self-signed", label: "Self-signed certificate (auto-generated)" },
        { value: "custom", label: "Custom certificate (provide cert/key paths)" },
        { value: "reverse-proxy", label: "Behind reverse proxy (proxy terminates TLS)" },
      ],
    });

    if (tlsChoice === "custom") {
      tlsCertPath = await prompter.text({
        message: "Path to PEM certificate file",
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
      tlsKeyPath = await prompter.text({
        message: "Path to PEM private key file",
        validate: (v) => (v?.trim() ? undefined : "Required"),
      });
    }

    if (tlsChoice === "reverse-proxy") {
      await prompter.note(
        [
          "Your reverse proxy must terminate TLS and forward:",
          "  X-Forwarded-For  (client IP)",
          "  X-Forwarded-Proto  (https)",
          "",
          "Docs: https://docs.openclaw.ai/gateway/reverse-proxy",
        ].join("\n"),
        "Reverse Proxy",
      );
      const proxiesInput = await prompter.text({
        message: "Trusted proxy IPs/CIDRs (comma-separated)",
        initialValue: "127.0.0.1, ::1",
        validate: (v) => (v?.trim() ? undefined : "At least one IP required"),
      });
      trustedProxies = String(proxiesInput)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  nextConfig = {
    ...nextConfig,
    gateway: {
      ...nextConfig.gateway,
      port,
      bind: bind as GatewayBindMode,
      ...(bind === "custom" && customBindHost ? { customBindHost } : {}),
      tailscale: {
        ...nextConfig.gateway?.tailscale,
        mode: tailscaleMode as GatewayTailscaleMode,
        resetOnExit: tailscaleResetOnExit,
      },
      ...(tlsChoice === "self-signed" || tlsChoice === "custom"
        ? {
            tls: {
              enabled: true,
              ...(tlsCertPath ? { certPath: tlsCertPath } : {}),
              ...(tlsKeyPath ? { keyPath: tlsKeyPath } : {}),
            },
          }
        : {}),
      ...(trustedProxies?.length ? { trustedProxies } : {}),
    },
  };

  // If this is a new gateway setup (no existing gateway settings), start with a
  // denylist for high-risk node commands. Users can arm these temporarily via
  // /phone arm ... (phone-control plugin).
  if (
    !quickstartGateway.hasExisting &&
    nextConfig.gateway?.nodes?.denyCommands === undefined &&
    nextConfig.gateway?.nodes?.allowCommands === undefined &&
    nextConfig.gateway?.nodes?.browser === undefined
  ) {
    nextConfig = {
      ...nextConfig,
      gateway: {
        ...nextConfig.gateway,
        nodes: {
          ...nextConfig.gateway?.nodes,
          denyCommands: [...DEFAULT_DANGEROUS_NODE_DENY_COMMANDS],
        },
      },
    };
  }

  return {
    nextConfig,
    settings: {
      port,
      bind: bind as GatewayBindMode,
      customBindHost: bind === "custom" ? customBindHost : undefined,
      authMode,
      gatewayToken,
      tailscaleMode: tailscaleMode as GatewayTailscaleMode,
      tailscaleResetOnExit,
    },
  };
}
