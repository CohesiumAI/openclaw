/**
 * CLI commands for managing gateway users (create, passwd, reset-password, list, delete).
 * Recovery codes are hashed with the same scrypt scheme as passwords.
 */

import type { Command } from "commander";
import { cancel, confirm, isCancel, password, select, text } from "@clack/prompts";
import { hashPassword, verifyPassword } from "../../gateway/auth-password.js";
import { deleteUserSessions } from "../../gateway/auth-sessions.js";
import {
  createGatewayUser,
  deleteGatewayUser,
  getGatewayUser,
  listGatewayUsers,
  updateGatewayUserPassword,
  updateGatewayUserRecoveryCode,
  updateGatewayUsername,
  type GatewayUserRole,
} from "../../infra/auth-credentials.js";
import { defaultRuntime } from "../../runtime.js";
import { isRich, theme } from "../../terminal/theme.js";

const MIN_PASSWORD_LENGTH = 8;
const RECOVERY_CODE_RE = /^\d{4,12}$/;

function guardCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }
  return value as T;
}

/** Prompt for a password twice and verify match. */
async function promptPasswordTwice(label: string): Promise<string> {
  const first = guardCancel(
    await password({
      message: `${label}`,
      validate: (v) => {
        if (!v || v.length < MIN_PASSWORD_LENGTH) {
          return `Minimum ${MIN_PASSWORD_LENGTH} characters`;
        }
      },
    }),
  );
  const second = guardCancel(
    await password({
      message: `Confirm ${label.toLowerCase()}`,
    }),
  );
  if (first !== second) {
    defaultRuntime.log(theme.error("Passwords do not match."));
    process.exit(1);
  }
  return first;
}

/** Prompt for a numeric recovery code twice and verify match. */
async function promptRecoveryCodeTwice(): Promise<string> {
  const first = guardCancel(
    await password({
      message: "Recovery code (4-12 digits)",
      validate: (v) => {
        if (!v || !RECOVERY_CODE_RE.test(v)) {
          return "Must be 4 to 12 digits";
        }
      },
    }),
  );
  const second = guardCancel(
    await password({
      message: "Confirm recovery code",
    }),
  );
  if (first !== second) {
    defaultRuntime.log(theme.error("Recovery codes do not match."));
    process.exit(1);
  }
  return first;
}

export function addGatewayUserCommands(gateway: Command) {
  const user = gateway.command("user").description("Manage gateway users");

  // --- gateway user create ---
  user
    .command("create")
    .description("Create a new gateway user")
    .action(async () => {
      const username = guardCancel(
        await text({
          message: "Username",
          validate: (v) => {
            if (!v || !v.trim()) {
              return "Username is required";
            }
            if (v.trim().length < 2) {
              return "Minimum 2 characters";
            }
          },
        }),
      );

      const pwd = await promptPasswordTwice("Password");
      const recoveryCode = await promptRecoveryCodeTwice();

      const role = guardCancel(
        await select<GatewayUserRole>({
          message: "Role",
          options: [
            { value: "admin", label: "Admin", hint: "full access" },
            { value: "operator", label: "Operator", hint: "read + write + approvals" },
            { value: "read-only", label: "Read-only", hint: "view only" },
          ],
        }),
      );

      const [passwordHash, recoveryCodeHash] = await Promise.all([
        hashPassword(pwd),
        hashPassword(recoveryCode),
      ]);

      const ok = createGatewayUser({ username, passwordHash, role, recoveryCodeHash });
      if (!ok) {
        defaultRuntime.log(theme.error(`User "${username}" already exists.`));
        process.exit(1);
      }
      defaultRuntime.log(theme.success(`User "${username}" created (role: ${role}).`));
    });

  // --- gateway user passwd ---
  user
    .command("passwd")
    .description("Change password for a gateway user")
    .action(async () => {
      const username = guardCancel(
        await text({
          message: "Username",
          validate: (v) => {
            if (!v || !v.trim()) {
              return "Username is required";
            }
          },
        }),
      );

      const existing = getGatewayUser(username);
      if (!existing) {
        defaultRuntime.log(theme.error(`User "${username}" not found.`));
        process.exit(1);
      }

      const currentPwd = guardCancel(await password({ message: "Current password" }));
      const valid = await verifyPassword(currentPwd, existing.passwordHash);
      if (!valid) {
        defaultRuntime.log(theme.error("Current password is incorrect."));
        process.exit(1);
      }

      const newPwd = await promptPasswordTwice("New password");
      const newHash = await hashPassword(newPwd);
      updateGatewayUserPassword(username, newHash);
      defaultRuntime.log(theme.success(`Password updated for "${username}".`));
    });

  // --- gateway user reset-password ---
  user
    .command("reset-password")
    .description("Reset password using recovery code")
    .action(async () => {
      const username = guardCancel(
        await text({
          message: "Username",
          validate: (v) => {
            if (!v || !v.trim()) {
              return "Username is required";
            }
          },
        }),
      );

      const existing = getGatewayUser(username);
      if (!existing) {
        defaultRuntime.log(theme.error(`User "${username}" not found.`));
        process.exit(1);
      }
      if (!existing.recoveryCodeHash) {
        defaultRuntime.log(theme.error("No recovery code configured for this user."));
        process.exit(1);
      }

      const code = guardCancel(await password({ message: "Recovery code" }));
      const valid = await verifyPassword(code, existing.recoveryCodeHash);
      if (!valid) {
        defaultRuntime.log(theme.error("Invalid recovery code."));
        process.exit(1);
      }

      const newPwd = await promptPasswordTwice("New password");
      const newHash = await hashPassword(newPwd);
      updateGatewayUserPassword(username, newHash);
      defaultRuntime.log(theme.success(`Password reset for "${username}".`));
    });

  // --- gateway user rename ---
  user
    .command("rename")
    .description("Change username (requires current password)")
    .action(async () => {
      const currentName = guardCancel(
        await text({
          message: "Current username",
          validate: (v) => {
            if (!v || !v.trim()) {
              return "Username is required";
            }
          },
        }),
      );

      const existing = getGatewayUser(currentName);
      if (!existing) {
        defaultRuntime.log(theme.error(`User "${currentName}" not found.`));
        process.exit(1);
      }

      const currentPwd = guardCancel(await password({ message: "Current password" }));
      const valid = await verifyPassword(currentPwd, existing.passwordHash);
      if (!valid) {
        defaultRuntime.log(theme.error("Current password is incorrect."));
        process.exit(1);
      }

      const newName = guardCancel(
        await text({
          message: "New username",
          validate: (v) => {
            if (!v || !v.trim()) {
              return "Username is required";
            }
            if (v.trim().length < 2) {
              return "Minimum 2 characters";
            }
          },
        }),
      );

      const ok = updateGatewayUsername(currentName, newName);
      if (!ok) {
        defaultRuntime.log(theme.error(`Username "${newName}" is already taken.`));
        process.exit(1);
      }
      defaultRuntime.log(theme.success(`Username changed: "${currentName}" → "${newName}".`));
    });

  // --- gateway user recovery-code ---
  user
    .command("recovery-code")
    .description("Set or update recovery code (requires current password)")
    .action(async () => {
      const username = guardCancel(
        await text({
          message: "Username",
          validate: (v) => {
            if (!v || !v.trim()) {
              return "Username is required";
            }
          },
        }),
      );

      const existing = getGatewayUser(username);
      if (!existing) {
        defaultRuntime.log(theme.error(`User "${username}" not found.`));
        process.exit(1);
      }

      const currentPwd = guardCancel(await password({ message: "Current password" }));
      const valid = await verifyPassword(currentPwd, existing.passwordHash);
      if (!valid) {
        defaultRuntime.log(theme.error("Current password is incorrect."));
        process.exit(1);
      }

      const code = await promptRecoveryCodeTwice();
      const codeHash = await hashPassword(code);
      updateGatewayUserRecoveryCode(username, codeHash);
      defaultRuntime.log(theme.success(`Recovery code updated for "${username}".`));
    });

  // --- gateway user list ---
  user
    .command("list")
    .description("List all gateway users")
    .option("--json", "Print JSON", false)
    .action((opts: { json?: boolean }) => {
      const users = listGatewayUsers();
      if (opts.json) {
        defaultRuntime.log(
          JSON.stringify(
            users.map((u) => ({
              username: u.username,
              role: u.role,
              hasRecoveryCode: Boolean(u.recoveryCodeHash),
              createdAt: new Date(u.createdAt).toISOString(),
            })),
            null,
            2,
          ),
        );
        return;
      }
      if (users.length === 0) {
        defaultRuntime.log("No gateway users configured.");
        return;
      }
      const rich = isRich();
      for (const u of users) {
        const date = new Date(u.createdAt).toISOString().slice(0, 10);
        const recovery = u.recoveryCodeHash ? "recovery: yes" : "recovery: no";
        const line = `${u.username}  role=${u.role}  ${recovery}  created=${date}`;
        defaultRuntime.log(rich ? theme.muted(line) : line);
      }
    });

  // --- gateway user delete ---
  user
    .command("delete")
    .description("Delete a gateway user")
    .action(async () => {
      const username = guardCancel(
        await text({
          message: "Username to delete",
          validate: (v) => {
            if (!v || !v.trim()) {
              return "Username is required";
            }
          },
        }),
      );

      const existing = getGatewayUser(username);
      if (!existing) {
        defaultRuntime.log(theme.error(`User "${username}" not found.`));
        process.exit(1);
      }

      const confirmed = guardCancel(
        await confirm({
          message: `Delete user "${username}" (role: ${existing.role})?`,
          initialValue: false,
        }),
      );
      if (!confirmed) {
        defaultRuntime.log("Cancelled.");
        return;
      }

      deleteGatewayUser(username);
      defaultRuntime.log(theme.success(`User "${username}" deleted.`));
    });

  // --- gateway user revoke ---
  user
    .command("revoke")
    .description("Revoke all active sessions for a gateway user")
    .action(async () => {
      const username = guardCancel(
        await text({
          message: "Username",
          validate: (v) => {
            if (!v || !v.trim()) {
              return "Username is required";
            }
          },
        }),
      );

      const existing = getGatewayUser(username);
      if (!existing) {
        defaultRuntime.log(theme.error(`User "${username}" not found.`));
        process.exit(1);
      }

      const confirmed = guardCancel(
        await confirm({
          message: `Revoke all active sessions for "${username}"?`,
          initialValue: false,
        }),
      );
      if (!confirmed) {
        defaultRuntime.log("Cancelled.");
        return;
      }

      const count = deleteUserSessions(username);
      defaultRuntime.log(
        theme.success(`Revoked ${count} session${count !== 1 ? "s" : ""} for "${username}".`),
      );
    });
}
