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
  params: { username: string; passwordHash: string; role: GatewayUserRole },
  stateDir?: string,
): boolean {
  const filePath = resolveGatewayUsersPath(stateDir);
  const data = loadUsersFile(filePath);
  const normalized = params.username.trim().toLowerCase();
  if (data.users.some((u) => u.username.toLowerCase() === normalized)) {
    return false;
  }
  const now = Date.now();
  data.users.push({
    username: params.username.trim(),
    passwordHash: params.passwordHash,
    role: params.role,
    createdAt: now,
    updatedAt: now,
  });
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

/** Check if any gateway users exist (for onboarding detection). */
export function hasGatewayUsers(stateDir?: string): boolean {
  return listGatewayUsers(stateDir).length > 0;
}
