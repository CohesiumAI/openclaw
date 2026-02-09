import type { SessionEntry } from "../../config/sessions.js";
import type { CommandHandler } from "./commands-types.js";
import { updateSessionStore } from "../../config/sessions.js";
import { resolveMainSessionKey } from "../../config/sessions.js";
import { callGateway } from "../../gateway/call.js";
import { logVerbose } from "../../globals.js";

const COMMAND = "/joinchat";

type SessionListRow = {
  key: string;
  label?: string;
  displayName?: string;
  updatedAt?: number | null;
};

/** Format a session row for the /joinchat list output */
function formatSessionRow(row: SessionListRow): string {
  const title = row.displayName || row.label || "(untitled)";
  const age = row.updatedAt ? formatAge(row.updatedAt) : "";
  return `• ${title}  —  \`${row.key}\`${age ? `  (${age})` : ""}`;
}

function formatAge(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Default web session = agent:*:web-* with no label/displayName — hidden in sidebar */
function isDefaultWebSession(s: SessionListRow): boolean {
  if (!/^agent:.*:web-/.test(s.key)) return false;
  return !s.label && !s.displayName;
}

/** /joinchat list — list all sessions except the main agent session */
async function handleList(
  params: Parameters<CommandHandler>[0],
): Promise<ReturnType<CommandHandler>> {
  const list = await callGateway<{ sessions: SessionListRow[] }>({
    method: "sessions.list",
    params: {
      includeGlobal: false,
      includeUnknown: false,
    },
  });

  const sessions = Array.isArray(list?.sessions) ? list.sessions : [];
  const mainKey = resolveMainSessionKey(params.cfg);

  // Exclude main session, current session, and unnamed default web sessions (match sidebar filter)
  const filtered = sessions.filter(
    (s) =>
      s.key !== mainKey &&
      !s.key.endsWith(":main") &&
      s.key !== params.sessionKey &&
      !isDefaultWebSession(s),
  );

  if (filtered.length === 0) {
    return {
      shouldContinue: false,
      reply: { text: "📋 No chat sessions found (only Agent-Main exists)." },
    };
  }

  const lines = filtered.map(formatSessionRow);
  const currentLinked = params.sessionEntry?.linkedSessions ?? [];
  const linkedNote =
    currentLinked.length > 0
      ? `\n\n🔗 Currently linked: ${currentLinked.map((k) => `\`${k}\``).join(", ")}`
      : "";

  return {
    shouldContinue: false,
    reply: {
      text: `📋 Available chats (${filtered.length}):\n${lines.join("\n")}${linkedNote}\n\nUsage: /joinchat <key> to link a chat as context.`,
    },
  };
}

/** /joinchat remove <key> — unlink a previously joined session */
async function handleRemove(
  params: Parameters<CommandHandler>[0],
  targetKey: string,
): Promise<ReturnType<CommandHandler>> {
  const current = params.sessionEntry?.linkedSessions ?? [];
  if (!current.includes(targetKey)) {
    return {
      shouldContinue: false,
      reply: { text: `⚠️ Chat \`${targetKey}\` is not linked to this session.` },
    };
  }

  if (params.sessionEntry && params.sessionStore && params.sessionKey) {
    params.sessionEntry.linkedSessions = current.filter((k) => k !== targetKey);
    if (params.sessionEntry.linkedSessions.length === 0) {
      delete params.sessionEntry.linkedSessions;
    }
    params.sessionEntry.updatedAt = Date.now();
    params.sessionStore[params.sessionKey] = params.sessionEntry;
    if (params.storePath) {
      await updateSessionStore(params.storePath, (store) => {
        const entry = store[params.sessionKey] as SessionEntry | undefined;
        if (entry) {
          entry.linkedSessions = params.sessionEntry?.linkedSessions;
          if (!entry.linkedSessions?.length) delete entry.linkedSessions;
          entry.updatedAt = Date.now();
        }
      });
    }
  }

  return {
    shouldContinue: false,
    reply: { text: `🔓 Chat \`${targetKey}\` unlinked from this session.` },
  };
}

/** /joinchat <key> — link a session as context source */
async function handleJoin(
  params: Parameters<CommandHandler>[0],
  targetKey: string,
): Promise<ReturnType<CommandHandler>> {
  // Prevent joining self
  if (targetKey === params.sessionKey) {
    return {
      shouldContinue: false,
      reply: { text: "⚠️ Cannot join the current session to itself." },
    };
  }

  // Verify the target session exists
  const list = await callGateway<{ sessions: SessionListRow[] }>({
    method: "sessions.list",
    params: {
      includeGlobal: false,
      includeUnknown: false,
    },
  });
  const sessions = Array.isArray(list?.sessions) ? list.sessions : [];
  const target = sessions.find((s) => s.key === targetKey);
  if (!target) {
    return {
      shouldContinue: false,
      reply: {
        text: `⚠️ Session \`${targetKey}\` not found. Use /joinchat list to see available chats.`,
      },
    };
  }

  // Check if already linked
  const current = params.sessionEntry?.linkedSessions ?? [];
  if (current.includes(targetKey)) {
    return {
      shouldContinue: false,
      reply: { text: `ℹ️ Chat \`${targetKey}\` is already linked to this session.` },
    };
  }

  // Persist the link
  if (params.sessionEntry && params.sessionStore && params.sessionKey) {
    const next = [...current, targetKey];
    params.sessionEntry.linkedSessions = next;
    params.sessionEntry.updatedAt = Date.now();
    params.sessionStore[params.sessionKey] = params.sessionEntry;
    if (params.storePath) {
      await updateSessionStore(params.storePath, (store) => {
        const entry = store[params.sessionKey] as SessionEntry | undefined;
        if (entry) {
          entry.linkedSessions = [...(entry.linkedSessions ?? []), targetKey];
          entry.updatedAt = Date.now();
        }
      });
    }
  }

  const title = target.displayName || target.label || targetKey;
  return {
    shouldContinue: false,
    reply: {
      text: `🔗 Chat "${title}" (\`${targetKey}\`) linked.\nContext from this chat will be available in your current session.`,
    },
  };
}

export const handleJoinChatCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== COMMAND && !normalized.startsWith(`${COMMAND} `)) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /joinchat from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  const args = normalized === COMMAND ? "" : normalized.slice(COMMAND.length + 1).trim();

  // /joinchat (no args) or /joinchat help → show usage
  if (!args || args === "help") {
    return {
      shouldContinue: false,
      reply: {
        text:
          "🔗 /joinchat — Link another chat as context source\n\n" +
          "Usage:\n" +
          "• /joinchat list — List available chats\n" +
          "• /joinchat <session_key> — Link a chat\n" +
          "• /joinchat remove <session_key> — Unlink a chat",
      },
    };
  }

  // /joinchat list
  if (args === "list") {
    return handleList(params);
  }

  // /joinchat remove [<key>]
  if (args === "remove" || args.startsWith("remove ")) {
    const removeTarget = args === "remove" ? "" : args.slice("remove ".length).trim();
    if (!removeTarget) {
      return {
        shouldContinue: false,
        reply: { text: "⚠️ Usage: /joinchat remove <session_key>" },
      };
    }
    return handleRemove(params, removeTarget);
  }

  // /joinchat <key> — join a session
  return handleJoin(params, args);
};
