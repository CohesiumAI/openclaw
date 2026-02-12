/**
 * Per-user projects store.
 * Metadata: ~/.openclaw/user-projects/<username>/projects.json (mode 0o600)
 * Files:    ~/.openclaw/user-projects/<username>/files/<projectId>/<fileId>
 *
 * Username and IDs are always validated server-side. No user-supplied paths are trusted.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";

const PROJECTS_DIR = "user-projects";
const PROJECTS_FILENAME = "projects.json";
const FILES_SUBDIR = "files";

// Strict ID format: alphanumeric + dash/underscore, 1–64 chars
const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

// Max file size: 25 MB base64 ≈ ~34 MB encoded
const MAX_FILE_DATA_LENGTH = 35_000_000;

// Resource limits per user (DoS prevention)
const MAX_PROJECTS_PER_USER = 100;
const MAX_FILES_PER_PROJECT = 500;

export type ProjectFileMeta = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sessionKey: string;
  addedAt: number;
};

export type UserProject = {
  id: string;
  name: string;
  color: string;
  sessionKeys: string[];
  files: ProjectFileMeta[];
  createdAt: number;
};

type ProjectsFile = {
  version: 1;
  projects: UserProject[];
};

function sanitizeUsername(username: string): string {
  return username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

function isSafeId(id: string): boolean {
  return SAFE_ID_RE.test(id);
}

function resolveUserDir(username: string, stateDir?: string): string {
  const dir = stateDir ?? resolveStateDir();
  return path.join(dir, PROJECTS_DIR, sanitizeUsername(username));
}

function resolveProjectsPath(username: string, stateDir?: string): string {
  return path.join(resolveUserDir(username, stateDir), PROJECTS_FILENAME);
}

function resolveFilePath(
  username: string,
  projectId: string,
  fileId: string,
  stateDir?: string,
): string {
  return path.join(resolveUserDir(username, stateDir), FILES_SUBDIR, projectId, fileId);
}

// --- Projects CRUD ---

function loadProjectsFile(username: string, stateDir?: string): ProjectsFile {
  const filePath = resolveProjectsPath(username, stateDir);
  const raw = loadJsonFile(filePath);
  if (
    raw &&
    typeof raw === "object" &&
    (raw as Record<string, unknown>).version === 1 &&
    Array.isArray((raw as Record<string, unknown>).projects)
  ) {
    return raw as ProjectsFile;
  }
  return { version: 1, projects: [] };
}

function saveProjectsFile(username: string, data: ProjectsFile, stateDir?: string): void {
  const filePath = resolveProjectsPath(username, stateDir);
  saveJsonFile(filePath, data);
}

export function listProjects(username: string, stateDir?: string): UserProject[] {
  return loadProjectsFile(username, stateDir).projects;
}

export function createProject(
  username: string,
  params: { id: string; name: string; color: string; sessionKeys?: string[] },
  stateDir?: string,
): UserProject | null {
  if (!isSafeId(params.id)) {
    return null;
  }
  const data = loadProjectsFile(username, stateDir);
  if (data.projects.length >= MAX_PROJECTS_PER_USER) {
    return null; // resource limit
  }
  if (data.projects.some((p) => p.id === params.id)) {
    return null; // duplicate
  }
  const project: UserProject = {
    id: params.id,
    name: params.name.slice(0, 200),
    color: params.color.slice(0, 30),
    sessionKeys: Array.isArray(params.sessionKeys)
      ? params.sessionKeys.filter((k): k is string => typeof k === "string").slice(0, 500)
      : [],
    files: [],
    createdAt: Date.now(),
  };
  data.projects.push(project);
  saveProjectsFile(username, data, stateDir);
  return project;
}

export function updateProject(
  username: string,
  projectId: string,
  patch: { name?: string; color?: string; sessionKeys?: string[] },
  stateDir?: string,
): UserProject | null {
  if (!isSafeId(projectId)) {
    return null;
  }
  const data = loadProjectsFile(username, stateDir);
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) {
    return null;
  }
  if (typeof patch.name === "string") {
    project.name = patch.name.slice(0, 200);
  }
  if (typeof patch.color === "string") {
    project.color = patch.color.slice(0, 30);
  }
  if (Array.isArray(patch.sessionKeys)) {
    project.sessionKeys = patch.sessionKeys
      .filter((k): k is string => typeof k === "string")
      .slice(0, 500);
  }
  saveProjectsFile(username, data, stateDir);
  return project;
}

export function deleteProject(username: string, projectId: string, stateDir?: string): boolean {
  if (!isSafeId(projectId)) {
    return false;
  }
  const data = loadProjectsFile(username, stateDir);
  const idx = data.projects.findIndex((p) => p.id === projectId);
  if (idx === -1) {
    return false;
  }
  data.projects.splice(idx, 1);
  saveProjectsFile(username, data, stateDir);
  // Clean up files directory
  const filesDir = path.join(resolveUserDir(username, stateDir), FILES_SUBDIR, projectId);
  try {
    fs.rmSync(filesDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  return true;
}

// --- File storage ---

export function putProjectFile(
  username: string,
  projectId: string,
  file: {
    fileId: string;
    fileName: string;
    dataUrl: string;
    mimeType?: string;
    sessionKey?: string;
  },
  stateDir?: string,
): ProjectFileMeta | null {
  if (!isSafeId(projectId) || !isSafeId(file.fileId)) {
    return null;
  }
  if (file.dataUrl.length > MAX_FILE_DATA_LENGTH) {
    return null;
  }
  const data = loadProjectsFile(username, stateDir);
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) {
    return null;
  }
  // Enforce file count limit (re-put of existing file is always allowed)
  const isNewFile = !project.files.some((f) => f.id === file.fileId);
  if (isNewFile && project.files.length >= MAX_FILES_PER_PROJECT) {
    return null;
  }
  // Write binary to disk
  const filePath = resolveFilePath(username, projectId, file.fileId, stateDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(filePath, file.dataUrl, "utf8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows may not support chmod
  }
  // Update metadata
  const sizeBytes = Math.round((file.dataUrl.length * 3) / 4);
  const meta: ProjectFileMeta = {
    id: file.fileId,
    fileName: file.fileName.slice(0, 255),
    mimeType: (file.mimeType ?? "application/octet-stream").slice(0, 100),
    sizeBytes,
    sessionKey: (file.sessionKey ?? "").slice(0, 200),
    addedAt: Date.now(),
  };
  const existingIdx = project.files.findIndex((f) => f.id === file.fileId);
  if (existingIdx >= 0) {
    project.files[existingIdx] = meta;
  } else {
    project.files.push(meta);
  }
  saveProjectsFile(username, data, stateDir);
  return meta;
}

export function getProjectFile(
  username: string,
  projectId: string,
  fileId: string,
  stateDir?: string,
): { dataUrl: string; fileName: string } | null {
  if (!isSafeId(projectId) || !isSafeId(fileId)) {
    return null;
  }
  const data = loadProjectsFile(username, stateDir);
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) {
    return null;
  }
  const fileMeta = project.files.find((f) => f.id === fileId);
  if (!fileMeta) {
    return null;
  }
  const filePath = resolveFilePath(username, projectId, fileId, stateDir);
  try {
    const dataUrl = fs.readFileSync(filePath, "utf8");
    return { dataUrl, fileName: fileMeta.fileName };
  } catch {
    return null;
  }
}

export function removeProjectFiles(
  username: string,
  projectId: string,
  fileIds: string[],
  stateDir?: string,
): number {
  if (!isSafeId(projectId)) {
    return 0;
  }
  const data = loadProjectsFile(username, stateDir);
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) {
    return 0;
  }
  let removed = 0;
  const toRemove = new Set(fileIds.filter(isSafeId));
  for (const fileId of toRemove) {
    const idx = project.files.findIndex((f) => f.id === fileId);
    if (idx >= 0) {
      project.files.splice(idx, 1);
      removed++;
    }
    const filePath = resolveFilePath(username, projectId, fileId, stateDir);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // best-effort
    }
  }
  if (removed > 0) {
    saveProjectsFile(username, data, stateDir);
  }
  return removed;
}
