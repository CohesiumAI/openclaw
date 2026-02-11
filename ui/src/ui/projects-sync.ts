/**
 * Sync user projects between localStorage and gateway server.
 *
 * - On connect: fetch server projects, merge with local (server wins if non-empty)
 * - On local mutation: push changes to server
 * - Migration: if server is empty but local has projects, push local to server
 */

import type { GatewayBrowserClient } from "./gateway.ts";
import type { Project, UiSettings } from "./storage.ts";

type ServerProject = {
  id: string;
  name: string;
  color: string;
  sessionKeys: string[];
  files: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sessionKey: string;
    addedAt: number;
  }>;
  createdAt: number;
};

/**
 * On successful gateway connect: fetch server projects and merge.
 * Server is source of truth if non-empty; otherwise migrate local to server.
 */
export async function syncProjectsOnConnect(params: {
  client: GatewayBrowserClient;
  settings: UiSettings;
  applySettings: (next: UiSettings) => void;
}): Promise<void> {
  const { client, settings, applySettings } = params;
  try {
    const res = await client.request<{ projects?: ServerProject[] }>(
      "user.projects.list",
      {},
    );
    const serverProjects = res?.projects ?? [];

    if (serverProjects.length > 0) {
      // Server has projects — use as source of truth
      const mapped: Project[] = serverProjects.map(toLocalProject);
      applySettings({ ...settings, projects: mapped });
      return;
    }

    // Server is empty — migrate local projects if any
    if (settings.projects.length > 0) {
      for (const proj of settings.projects) {
        try {
          await client.request("user.projects.create", {
            id: proj.id,
            name: proj.name,
            color: proj.color,
            sessionKeys: proj.sessionKeys,
          });
        } catch {
          // Best-effort migration per project
        }
      }
    }
  } catch {
    // Gateway doesn't support projects (older version) or not password-authenticated
  }
}

/** Push a single project mutation to server (fire-and-forget). */
export async function pushProjectCreate(
  client: GatewayBrowserClient | null,
  project: Project,
): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.request("user.projects.create", {
      id: project.id,
      name: project.name,
      color: project.color,
      sessionKeys: project.sessionKeys,
    });
  } catch {
    // Best-effort
  }
}

/** Push a project update to server (fire-and-forget). */
export async function pushProjectUpdate(
  client: GatewayBrowserClient | null,
  projectId: string,
  patch: { name?: string; color?: string; sessionKeys?: string[] },
): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.request("user.projects.update", {
      projectId,
      ...patch,
    });
  } catch {
    // Best-effort
  }
}

/** Push a project deletion to server (fire-and-forget). */
export async function pushProjectDelete(
  client: GatewayBrowserClient | null,
  projectId: string,
): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.request("user.projects.delete", { projectId });
  } catch {
    // Best-effort
  }
}

function toLocalProject(sp: ServerProject): Project {
  return {
    id: sp.id,
    name: sp.name,
    color: sp.color,
    sessionKeys: sp.sessionKeys ?? [],
    files: (sp.files ?? []).map((f) => ({
      id: f.id,
      fileName: f.fileName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      sessionKey: f.sessionKey,
      addedAt: f.addedAt,
    })),
    createdAt: sp.createdAt,
  };
}
