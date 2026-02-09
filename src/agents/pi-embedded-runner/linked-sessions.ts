import { loadSessionStore, resolveStorePath, type SessionEntry } from "../../config/sessions.js";
import { readSessionMessages } from "../../gateway/session-utils.fs.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import type { OpenClawConfig } from "../../config/config.js";

/** Max messages to extract per linked session */
const MAX_MESSAGES_PER_SESSION = 20;
/** Hard cap on total injected chars across all linked sessions */
const MAX_TOTAL_CHARS = 8_000;

type LinkedSessionContext = {
  key: string;
  label: string;
  messages: string[];
};

/** Extract user-visible text from a raw transcript message object */
function extractMessageText(msg: unknown): string | undefined {
  if (!msg || typeof msg !== "object") return undefined;
  const rec = msg as Record<string, unknown>;
  const role = typeof rec.role === "string" ? rec.role : "";
  if (role !== "user" && role !== "assistant") return undefined;
  if (typeof rec.content === "string") {
    return `[${role}]: ${rec.content}`;
  }
  if (Array.isArray(rec.content)) {
    const texts = rec.content
      .filter((b): b is { type: string; text: string } =>
        !!b && typeof b === "object" && (b as Record<string, unknown>).type === "text",
      )
      .map((b) => b.text)
      .filter(Boolean);
    if (texts.length > 0) return `[${role}]: ${texts.join(" ")}`;
  }
  return undefined;
}

/**
 * Build workspace notes containing context from sessions linked via /joinchat.
 * Returns an array of note strings ready for injection into workspaceNotes.
 */
export function buildLinkedSessionsContext(params: {
  sessionKey?: string;
  config?: OpenClawConfig;
}): string[] {
  if (!params.sessionKey || !params.config) return [];

  const agentId = resolveAgentIdFromSessionKey(params.sessionKey);
  const storePath = resolveStorePath(params.config?.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  const entry = store[params.sessionKey];
  const linked = entry?.linkedSessions;
  if (!linked?.length) return [];

  const contexts: LinkedSessionContext[] = [];
  let totalChars = 0;

  for (const linkedKey of linked) {
    if (totalChars >= MAX_TOTAL_CHARS) break;

    const linkedEntry = findSessionEntry(store, linkedKey, params.config);
    if (!linkedEntry) continue;

    const label = linkedEntry.displayName ?? linkedEntry.label ?? linkedKey;
    const rawMessages = readSessionMessages(
      linkedEntry.sessionId,
      storePath,
      linkedEntry.sessionFile,
    );

    // Take the last N messages and extract text
    const recent = rawMessages.slice(-MAX_MESSAGES_PER_SESSION);
    const lines: string[] = [];
    for (const msg of recent) {
      const text = extractMessageText(msg);
      if (!text) continue;
      // Truncate individual messages
      const truncated = text.length > 500 ? `${text.slice(0, 497)}...` : text;
      if (totalChars + truncated.length > MAX_TOTAL_CHARS) break;
      lines.push(truncated);
      totalChars += truncated.length;
    }

    if (lines.length > 0) {
      contexts.push({ key: linkedKey, label, messages: lines });
    }
  }

  if (contexts.length === 0) return [];

  const blocks = contexts.map(
    (ctx) =>
      `## Linked Chat: ${ctx.label} (${ctx.key})\n${ctx.messages.join("\n")}`,
  );

  return [
    `# Context from linked chats (via /joinchat)\n\n${blocks.join("\n\n")}`,
  ];
}

/** Find session entry by key, checking the given store and falling back to other agent stores */
function findSessionEntry(
  store: Record<string, SessionEntry>,
  key: string,
  config?: OpenClawConfig,
): SessionEntry | undefined {
  // Direct lookup in current store
  if (store[key]) return store[key];

  // Try loading from the target agent's store
  const targetAgentId = resolveAgentIdFromSessionKey(key);
  if (targetAgentId && config) {
    try {
      const targetStorePath = resolveStorePath(config.session?.store, {
        agentId: targetAgentId,
      });
      const targetStore = loadSessionStore(targetStorePath);
      return targetStore[key];
    } catch {
      return undefined;
    }
  }

  return undefined;
}
