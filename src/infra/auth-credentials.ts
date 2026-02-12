/**
 * Gateway user credentials store.
 * Persists hashed passwords in ~/.openclaw/credentials/gateway-users.json (mode 0o600).
 */

import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { loadJsonFile, saveJsonFile } from "./json-file.js";

export type GatewayUserRole = "admin" | "operator" | "read-only";

export type GatewayUser = {
  username: string;
  passwordHash: string;
  role: GatewayUserRole;
  /** Hashed numeric recovery code (8-12 digits) for password reset. */
  recoveryCodeHash?: string;
  /** Encrypted TOTP secret (AES-256-GCM with machine key). */
  totpSecret?: string;
  /** Whether 2FA TOTP is enabled for this user. */
  totpEnabled?: boolean;
  /** Scrypt-hashed backup codes for 2FA recovery. */
  backupCodeHashes?: string[];
  /** Last successfully verified TOTP code (anti-replay). */
  lastUsedTotpCode?: string;
  createdAt: number;
  updatedAt: number;
};

type UsersFile = {
  version: 1;
  users: GatewayUser[];
};

const CREDENTIALS_DIR = "credentials";
const USERS_FILENAME = "gateway-users.json";

/** Resolve the path to gateway-users.json. */
export function resolveGatewayUsersPath(stateDir: string = resolveStateDir()): string {
  return path.join(stateDir, CREDENTIALS_DIR, USERS_FILENAME);
}

function loadUsersFile(filePath: string): UsersFile {
  const raw = loadJsonFile(filePath);
  if (
    raw &&
    typeof raw === "object" &&
    "version" in (raw as Record<string, unknown>) &&
    "users" in (raw as Record<string, unknown>)
  ) {
    const file = raw as UsersFile;
    if (file.version === 1 && Array.isArray(file.users)) {
      return file;
    }
  }
  return { version: 1, users: [] };
}

function saveUsersFile(filePath: string, data: UsersFile): void {
  saveJsonFile(filePath, data);
}

/** List all gateway users. */
export function listGatewayUsers(stateDir?: string): GatewayUser[] {
  const filePath = resolveGatewayUsersPath(stateDir);
  return loadUsersFile(filePath).users;
}

/** Get a user by username (case-insensitive). */
export function getGatewayUser(username: string, stateDir?: string): GatewayUser | null {
  const users = listGatewayUsers(stateDir);
  const normalized = username.trim().toLowerCase();
  return users.find((u) => u.username.toLowerCase() === normalized) ?? null;
}

/** Create a new gateway user. Returns false if username already exists. */
export function createGatewayUser(
  params: {
    username: string;
    passwordHash: string;
    role: GatewayUserRole;
    recoveryCodeHash?: string;
  },
  stateDir?: string,
): boolean {
  const filePath = resolveGatewayUsersPath(stateDir);
  const data = loadUsersFile(filePath);
  const normalized = params.username.trim().toLowerCase();
  if (data.users.some((u) => u.username.toLowerCase() === normalized)) {
    return false;
  }
  const now = Date.now();
  const user: GatewayUser = {
    username: params.username.trim(),
    passwordHash: params.passwordHash,
    role: params.role,
    createdAt: now,
    updatedAt: now,
  };
  if (params.recoveryCodeHash) {
    user.recoveryCodeHash = params.recoveryCodeHash;
  }
  data.users.push(user);
  saveUsersFile(filePath, data);
  return true;
}

/** Update password for an existing user. Returns false if user not found. */
export function updateGatewayUserPassword(
  username: string,
  passwordHash: string,
  stateDir?: string,
): boolean {
  const filePath = resolveGatewayUsersPath(stateDir);
  const data = loadUsersFile(filePath);
  const normalized = username.trim().toLowerCase();
  const user = data.users.find((u) => u.username.toLowerCase() === normalized);
  if (!user) {
    return false;
  }
  user.passwordHash = passwordHash;
  user.updatedAt = Date.now();
  saveUsersFile(filePath, data);
  return true;
}

/** Update role for an existing user. Returns false if user not found. */
export function updateGatewayUserRole(
  username: string,
  role: GatewayUserRole,
  stateDir?: string,
): boolean {
  const filePath = resolveGatewayUsersPath(stateDir);
  const data = loadUsersFile(filePath);
  const normalized = username.trim().toLowerCase();
  const user = data.users.find((u) => u.username.toLowerCase() === normalized);
  if (!user) {
    return false;
  }
  user.role = role;
  user.updatedAt = Date.now();
  saveUsersFile(filePath, data);
  return true;
}

/** Delete a gateway user. Returns false if user not found. */
export function deleteGatewayUser(username: string, stateDir?: string): boolean {
  const filePath = resolveGatewayUsersPath(stateDir);
  const data = loadUsersFile(filePath);
  const normalized = username.trim().toLowerCase();
  const idx = data.users.findIndex((u) => u.username.toLowerCase() === normalized);
  if (idx === -1) {
    return false;
  }
  data.users.splice(idx, 1);
  saveUsersFile(filePath, data);
  return true;
}

/** Update recovery code hash for an existing user. Returns false if user not found. */
export function updateGatewayUserRecoveryCode(
  username: string,
  recoveryCodeHash: string,
  stateDir?: string,
): boolean {
  const filePath = resolveGatewayUsersPath(stateDir);
  const data = loadUsersFile(filePath);
  const normalized = username.trim().toLowerCase();
  const user = data.users.find((u) => u.username.toLowerCase() === normalized);
  if (!user) {
    return false;
  }
  user.recoveryCodeHash = recoveryCodeHash;
  user.updatedAt = Date.now();
  saveUsersFile(filePath, data);
  return true;
}

/** Update username for an existing user. Returns false if user not found or new name taken. */
export function updateGatewayUsername(
  currentUsername: string,
  newUsername: string,
  stateDir?: string,
): boolean {
  const filePath = resolveGatewayUsersPath(stateDir);
  const data = loadUsersFile(filePath);
  const currentNorm = currentUsername.trim().toLowerCase();
  const newNorm = newUsername.trim().toLowerCase();
  if (currentNorm !== newNorm && data.users.some((u) => u.username.toLowerCase() === newNorm)) {
    return false;
  }
  const user = data.users.find((u) => u.username.toLowerCase() === currentNorm);
  if (!user) {
    return false;
  }
  user.username = newUsername.trim();
  user.updatedAt = Date.now();
  saveUsersFile(filePath, data);
  return true;
}

/** Check if any gateway users exist (for onboarding detection). */
export function hasGatewayUsers(stateDir?: string): boolean {
  return listGatewayUsers(stateDir).length > 0;
}

/** Update TOTP fields for an existing user. Returns false if user not found. */
export function updateGatewayUserTotp(
  username: string,
  fields: {
    totpSecret?: string;
    totpEnabled?: boolean;
    backupCodeHashes?: string[];
    lastUsedTotpCode?: string;
  },
  stateDir?: string,
): boolean {
  const filePath = resolveGatewayUsersPath(stateDir);
  const data = loadUsersFile(filePath);
  const normalized = username.trim().toLowerCase();
  const user = data.users.find((u) => u.username.toLowerCase() === normalized);
  if (!user) {
    return false;
  }
  if (fields.totpSecret !== undefined) {
    user.totpSecret = fields.totpSecret;
  }
  if (fields.totpEnabled !== undefined) {
    user.totpEnabled = fields.totpEnabled;
  }
  if (fields.backupCodeHashes !== undefined) {
    user.backupCodeHashes = fields.backupCodeHashes;
  }
  if (fields.lastUsedTotpCode !== undefined) {
    user.lastUsedTotpCode = fields.lastUsedTotpCode;
  }
  user.updatedAt = Date.now();
  saveUsersFile(filePath, data);
  return true;
}
