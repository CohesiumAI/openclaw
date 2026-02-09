import type { Project, UiSettings } from "../storage.ts";
import { generateUUID } from "../uuid.ts";

const PROJECT_COLORS = [
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#6366f1",
];

type ProjectCommandHost = {
  settings: UiSettings;
  sessionKey: string;
  chatMessages: unknown[];
  applySettings: (next: UiSettings) => void;
};

const USAGE = [
  "**Project commands:**",
  "• `/project create <name>` — Create a new project",
  "• `/project rename <old> | <new>` — Rename a project",
  "• `/project list` — List all projects",
  "• `/project delete <name>` — Delete a project (must have 0 chats)",
  "• `/project add <name>` — Add the current chat to a project",
  "• `/project remove <name>` — Remove the current chat from a project",
].join("\n");

function findProject(projects: Project[], name: string): Project | undefined {
  const lower = name.toLowerCase();
  return projects.find((p) => p.name.toLowerCase() === lower);
}

function pickColor(projects: Project[]): string {
  const used = new Set(projects.map((p) => p.color));
  const available = PROJECT_COLORS.filter((c) => !used.has(c));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }
  return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];
}

function handleCreate(host: ProjectCommandHost, rawName: string): string {
  const name = rawName.trim();
  if (!name) {
    return "Usage: `/project create <name>`";
  }
  if (findProject(host.settings.projects, name)) {
    return `A project named **${name}** already exists.`;
  }
  const newProj: Project = {
    id: `proj-${generateUUID()}`,
    name,
    color: pickColor(host.settings.projects),
    sessionKeys: [],
    files: [],
    createdAt: Date.now(),
  };
  host.applySettings({
    ...host.settings,
    projects: [...host.settings.projects, newProj],
  });
  return `Project **${name}** created.`;
}

function handleRename(host: ProjectCommandHost, rawArgs: string): string {
  const parts = rawArgs.split("|").map((s) => s.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return "Usage: `/project rename <old name> | <new name>`";
  }
  const [oldName, newName] = parts;
  const proj = findProject(host.settings.projects, oldName);
  if (!proj) {
    return `No project named **${oldName}** found.`;
  }
  if (findProject(host.settings.projects, newName)) {
    return `A project named **${newName}** already exists.`;
  }
  const updated = host.settings.projects.map((p) =>
    p.id === proj.id ? { ...p, name: newName } : p,
  );
  host.applySettings({ ...host.settings, projects: updated });
  return `Project renamed from **${oldName}** to **${newName}**.`;
}

function handleList(host: ProjectCommandHost): string {
  const { projects } = host.settings;
  if (projects.length === 0) {
    return "No projects yet. Use `/project create <name>` to create one.";
  }
  const lines = projects.map(
    (p) => `• **${p.name}** — ${p.sessionKeys.length} chat${p.sessionKeys.length !== 1 ? "s" : ""}`,
  );
  return `**Projects (${projects.length}):**\n${lines.join("\n")}`;
}

function handleDelete(host: ProjectCommandHost, rawName: string): string {
  const name = rawName.trim();
  if (!name) {
    return "Usage: `/project delete <name>`";
  }
  const proj = findProject(host.settings.projects, name);
  if (!proj) {
    return `No project named **${name}** found.`;
  }
  if (proj.sessionKeys.length > 0) {
    return `Cannot delete **${name}** — it still has ${proj.sessionKeys.length} chat${proj.sessionKeys.length !== 1 ? "s" : ""}. Remove all chats first.`;
  }
  const updated = host.settings.projects.filter((p) => p.id !== proj.id);
  host.applySettings({ ...host.settings, projects: updated });
  return `Project **${name}** deleted.`;
}

function handleAdd(host: ProjectCommandHost, rawName: string): string {
  const name = rawName.trim();
  if (!name) {
    return "Usage: `/project add <name>`";
  }
  const proj = findProject(host.settings.projects, name);
  if (!proj) {
    return `No project named **${name}** found.`;
  }
  const key = host.sessionKey;
  if (proj.sessionKeys.includes(key)) {
    return `This chat is already in **${name}**.`;
  }
  // Mutual exclusion: a chat can only belong to one project
  const current = host.settings.projects.find((p) => p.sessionKeys.includes(key));
  if (current) {
    return `This chat is already in project **${current.name}**. Remove it first with \`/project remove ${current.name}\`.`;
  }
  const updated = host.settings.projects.map((p) =>
    p.id === proj.id ? { ...p, sessionKeys: [...p.sessionKeys, key] } : p,
  );
  // Remove from pinned (mutual exclusion with projects)
  const pinnedNext = host.settings.pinnedSessionKeys.filter((k) => k !== key);
  host.applySettings({ ...host.settings, projects: updated, pinnedSessionKeys: pinnedNext });

  // Import existing image files from the current chat messages
  if (Array.isArray(host.chatMessages) && host.chatMessages.length > 0) {
    const existingIds = new Set(proj.files.map((f) => f.id));
    void import("./project-files.ts").then((m) =>
      m
        .importChatFilesIntoProject(proj.id, key, host.chatMessages, existingIds)
        .then((imported) => {
          if (imported.length > 0) {
            const latest = host.settings.projects.map((p) =>
              p.id === proj.id ? { ...p, files: [...p.files, ...imported] } : p,
            );
            host.applySettings({ ...host.settings, projects: latest });
          }
        }),
    );
  }

  return `Chat added to **${name}**.`;
}

function handleRemove(host: ProjectCommandHost, rawName: string): string {
  const name = rawName.trim();
  if (!name) {
    return "Usage: `/project remove <name>`";
  }
  const proj = findProject(host.settings.projects, name);
  if (!proj) {
    return `No project named **${name}** found.`;
  }
  const key = host.sessionKey;
  if (!proj.sessionKeys.includes(key)) {
    return `This chat is not in **${name}**.`;
  }
  const updated = host.settings.projects.map((p) =>
    p.id === proj.id
      ? {
          ...p,
          sessionKeys: p.sessionKeys.filter((k) => k !== key),
          files: p.files.filter((f) => f.sessionKey !== key),
        }
      : p,
  );
  host.applySettings({ ...host.settings, projects: updated });
  return `Chat removed from **${name}**.`;
}

/**
 * Handle /project commands locally (projects live in UI settings).
 * Returns a reply string if the message is a /project command, null otherwise.
 */
export function handleProjectCommand(host: ProjectCommandHost, message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed.toLowerCase().startsWith("/project")) {
    return null;
  }
  const rest = trimmed.slice("/project".length).trim();
  if (!rest) {
    return USAGE;
  }
  const spaceIdx = rest.indexOf(" ");
  const action = spaceIdx === -1 ? rest.toLowerCase() : rest.slice(0, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1);

  switch (action) {
    case "create":
      return handleCreate(host, args);
    case "rename":
      return handleRename(host, args);
    case "list":
      return handleList(host);
    case "delete":
      return handleDelete(host, args);
    case "add":
      return handleAdd(host, args);
    case "remove":
      return handleRemove(host, args);
    default:
      return `Unknown action **${action}**.\n\n${USAGE}`;
  }
}
