/**
 * CLI commands for managing gateway TLS (enable, disable, status, regenerate).
 */

import type { Command } from "commander";
import { cancel, confirm, isCancel } from "@clack/prompts";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readConfigFileSnapshot, writeConfigFile } from "../../config/config.js";
import { normalizeFingerprint } from "../../infra/tls/fingerprint.js";
import { generateSelfSignedCertNative } from "../../infra/tls/generate.js";
import { defaultRuntime } from "../../runtime.js";
import { theme } from "../../terminal/theme.js";
import { CONFIG_DIR, ensureDir, resolveUserPath } from "../../utils.js";

function guardCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }
  return value as T;
}

const DEFAULT_TLS_DIR = path.join(CONFIG_DIR, "gateway", "tls");
const DEFAULT_CERT_PATH = path.join(DEFAULT_TLS_DIR, "gateway-cert.pem");
const DEFAULT_KEY_PATH = path.join(DEFAULT_TLS_DIR, "gateway-key.pem");

export function addGatewayTlsCommands(gateway: Command) {
  const tls = gateway.command("tls").description("Manage gateway TLS/HTTPS");

  // --- gateway tls enable ---
  tls
    .command("enable")
    .description("Enable TLS for the gateway (generates self-signed cert if needed)")
    .action(async () => {
      const snapshot = await readConfigFileSnapshot();
      if (!snapshot.valid && snapshot.exists) {
        defaultRuntime.log(theme.error("Config file is invalid. Run `openclaw doctor` first."));
        process.exit(1);
      }
      const config = snapshot.valid ? snapshot.config : {};

      const certPath = resolveUserPath(config.gateway?.tls?.certPath ?? DEFAULT_CERT_PATH);
      const keyPath = resolveUserPath(config.gateway?.tls?.keyPath ?? DEFAULT_KEY_PATH);

      // Generate cert if missing
      if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        defaultRuntime.log("Generating self-signed certificate...");
        ensureDir(path.dirname(certPath));
        const { certPem, keyPem } = generateSelfSignedCertNative();
        fs.writeFileSync(certPath, certPem, { mode: 0o600 });
        fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });
        defaultRuntime.log(theme.success(`Certificate: ${certPath}`));
        defaultRuntime.log(theme.success(`Private key: ${keyPath}`));
      }

      // Update config
      await writeConfigFile({
        ...config,
        gateway: {
          ...config.gateway,
          tls: {
            ...config.gateway?.tls,
            enabled: true,
            certPath,
            keyPath,
          },
        },
      });

      defaultRuntime.log(theme.success("TLS enabled. Restart the gateway to apply."));
    });

  // --- gateway tls disable ---
  tls
    .command("disable")
    .description("Disable TLS for the gateway")
    .action(async () => {
      const snapshot = await readConfigFileSnapshot();
      const config = snapshot.valid ? snapshot.config : {};

      await writeConfigFile({
        ...config,
        gateway: {
          ...config.gateway,
          tls: {
            ...config.gateway?.tls,
            enabled: false,
          },
        },
      });

      defaultRuntime.log(theme.success("TLS disabled. Restart the gateway to apply."));
    });

  // --- gateway tls status ---
  tls
    .command("status")
    .description("Show TLS status, certificate info, and fingerprint")
    .action(async () => {
      const snapshot = await readConfigFileSnapshot();
      const config = snapshot.valid ? snapshot.config : {};
      const tlsConfig = config.gateway?.tls;
      const enabled = tlsConfig?.enabled === true;

      defaultRuntime.log(`TLS enabled: ${enabled ? "yes" : "no"}`);

      const certPath = resolveUserPath(tlsConfig?.certPath ?? DEFAULT_CERT_PATH);
      const keyPath = resolveUserPath(tlsConfig?.keyPath ?? DEFAULT_KEY_PATH);
      defaultRuntime.log(
        `Certificate: ${certPath} ${fs.existsSync(certPath) ? "(exists)" : "(missing)"}`,
      );
      defaultRuntime.log(
        `Private key: ${keyPath} ${fs.existsSync(keyPath) ? "(exists)" : "(missing)"}`,
      );

      if (fs.existsSync(certPath)) {
        try {
          const certPem = fs.readFileSync(certPath, "utf8");
          const x509 = new X509Certificate(certPem);
          const fp = normalizeFingerprint(x509.fingerprint256 ?? "");
          defaultRuntime.log(`Subject: ${x509.subject}`);
          defaultRuntime.log(`Valid from: ${x509.validFrom}`);
          defaultRuntime.log(`Valid to: ${x509.validTo}`);
          if (fp) {
            defaultRuntime.log(`SHA256 fingerprint: ${fp}`);
          }
          const san = x509.subjectAltName;
          if (san) {
            defaultRuntime.log(`SAN: ${san}`);
          }
        } catch (err) {
          defaultRuntime.log(theme.error(`Failed to read certificate: ${err}`));
        }
      }
    });

  // --- gateway tls regenerate ---
  tls
    .command("regenerate")
    .description("Regenerate the self-signed TLS certificate")
    .action(async () => {
      const snapshot = await readConfigFileSnapshot();
      const config = snapshot.valid ? snapshot.config : {};
      const certPath = resolveUserPath(config.gateway?.tls?.certPath ?? DEFAULT_CERT_PATH);
      const keyPath = resolveUserPath(config.gateway?.tls?.keyPath ?? DEFAULT_KEY_PATH);

      if (fs.existsSync(certPath)) {
        const ok = guardCancel(
          await confirm({
            message: `Overwrite existing certificate at ${certPath}?`,
            initialValue: false,
          }),
        );
        if (!ok) {
          defaultRuntime.log("Cancelled.");
          return;
        }
      }

      ensureDir(path.dirname(certPath));
      const { certPem, keyPem } = generateSelfSignedCertNative();
      fs.writeFileSync(certPath, certPem, { mode: 0o600 });
      fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });

      defaultRuntime.log(theme.success("Certificate regenerated."));
      defaultRuntime.log(`Certificate: ${certPath}`);
      defaultRuntime.log(`Private key: ${keyPath}`);

      try {
        const x509 = new X509Certificate(certPem);
        const fp = normalizeFingerprint(x509.fingerprint256 ?? "");
        if (fp) {
          defaultRuntime.log(`SHA256 fingerprint: ${fp}`);
        }
      } catch {
        // best effort
      }

      defaultRuntime.log("Restart the gateway to apply the new certificate.");
    });
}
