/**
 * CLI commands for encrypting/decrypting gateway credentials at rest.
 * Uses AES-256-GCM with a scrypt-derived key.
 */

import type { Command } from "commander";
import { cancel, isCancel, password } from "@clack/prompts";
import fs from "node:fs";
import { resolveStateDir } from "../../config/paths.js";
import { rotateSessionKey } from "../../gateway/session-persistence.js";
import { resolveGatewayUsersPath } from "../../infra/auth-credentials.js";
import {
  decryptCredentials,
  encryptCredentials,
  isEncryptedCredentials,
} from "../../infra/credentials-crypto.js";
import { defaultRuntime } from "../../runtime.js";
import { theme } from "../../terminal/theme.js";

function guardCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }
  return value as T;
}

export function addCredentialsCommands(gateway: Command) {
  const creds = gateway.command("credentials").description("Manage gateway credentials encryption");

  creds
    .command("encrypt")
    .description("Encrypt the gateway-users.json file at rest")
    .action(async () => {
      const filePath = resolveGatewayUsersPath();
      if (!fs.existsSync(filePath)) {
        defaultRuntime.log(theme.error(`Credentials file not found: ${filePath}`));
        process.exit(1);
      }

      const raw = fs.readFileSync(filePath, "utf8");
      if (isEncryptedCredentials(raw)) {
        defaultRuntime.log(theme.error("Credentials file is already encrypted."));
        process.exit(1);
      }

      const pw = guardCancel(
        await password({
          message: "Encryption password",
          validate: (v) => {
            if (!v || v.length < 8) {
              return "Minimum 8 characters";
            }
          },
        }),
      );
      const confirm = guardCancel(await password({ message: "Confirm encryption password" }));
      if (pw !== confirm) {
        defaultRuntime.log(theme.error("Passwords do not match."));
        process.exit(1);
      }

      const encrypted = encryptCredentials(raw, pw);
      fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
      defaultRuntime.log(theme.success("Credentials file encrypted."));
    });

  creds
    .command("decrypt")
    .description("Decrypt the gateway-users.json file")
    .action(async () => {
      const filePath = resolveGatewayUsersPath();
      if (!fs.existsSync(filePath)) {
        defaultRuntime.log(theme.error(`Credentials file not found: ${filePath}`));
        process.exit(1);
      }

      const raw = fs.readFileSync(filePath, "utf8");
      if (!isEncryptedCredentials(raw)) {
        defaultRuntime.log(theme.error("Credentials file is not encrypted."));
        process.exit(1);
      }

      const pw = guardCancel(await password({ message: "Decryption password" }));

      try {
        const decrypted = decryptCredentials(raw, pw);
        fs.writeFileSync(filePath, decrypted, { mode: 0o600 });
        defaultRuntime.log(theme.success("Credentials file decrypted."));
      } catch {
        defaultRuntime.log(theme.error("Decryption failed — wrong password or corrupted file."));
        process.exit(1);
      }
    });

  creds
    .command("rotate")
    .description("Rotate the session encryption key (re-encrypts persisted sessions)")
    .action(() => {
      try {
        const stateDir = resolveStateDir();
        const result = rotateSessionKey(stateDir);
        defaultRuntime.log(
          theme.success(`Session key rotated (${result.sessionsRotated} sessions re-encrypted).`),
        );
        defaultRuntime.log(theme.muted("Restart the gateway to pick up the new key."));
      } catch (err) {
        defaultRuntime.log(
          theme.error(`Rotation failed: ${err instanceof Error ? err.message : String(err)}`),
        );
        process.exit(1);
      }
    });
}
