import { stripEnvelope } from "../../../../src/shared/chat-envelope.js";
import { stripThinkingTags } from "../format.ts";

const textCache = new WeakMap<object, string | null>();
const thinkingCache = new WeakMap<object, string | null>();

/** Strip gateway-injected image placeholder tags from displayed text */
function stripImagePlaceholders(text: string): string {
  return text.replace(/\s*\[Image attached:[^\]]*\]/g, "").trim();
}

/** Strip directive tags like [[reply_to_current]], [[reply_to:<id>]], [[audio_as_voice]] */
function stripDirectiveTags(text: string): string {
  return text
    .replace(/\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+|audio_as_voice)\s*\]\]/gi, "")
    .trim();
}

/**
 * Strip gateway-injected inlined file content from user messages.
 *
 * Robust approach: strip everything from the first file/attachment marker
 * to the end of the text.
 */
function stripInlinedFileContent(text: string): string {
  let result = text;
  // Phase 1: strip preamble markers injected BEFORE user text by the gateway
  result = result.replace(/\[media attached(?:\s+\d+\/\d+)?:\s*[^\]]*\]/g, "");
  result = result.replace(/\[media attached:\s*\d+\s+files\]/g, "");
  result = result.replace(/\[Image attached:\s*[^\]]*\]/g, "");
  result = result.replace(
    /To send an image back, prefer the message tool \(media\/path\/filePath\)\.[^\n]*/g,
    "",
  );
  result = result.replace(/\n{3,}/g, "\n\n").trim();

  // Phase 2: truncate from first file/content marker to end.
  const marker = /\[File(?:\s+attached)?:\s*[^\]]+\]|<file\s+/.exec(result);
  if (marker) {
    result = result.slice(0, marker.index).trim();
  }
  return result;
}

/** Compose all display-level sanitization: image placeholders, directive tags, inlined file content */
function sanitizeDisplayText(text: string): string {
  return stripInlinedFileContent(stripDirectiveTags(stripImagePlaceholders(text)));
}

export function extractText(message: unknown): string | null {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "";
  const content = m.content;
  if (typeof content === "string") {
    const processed = role === "assistant" ? stripThinkingTags(content) : stripEnvelope(content);
    const result = sanitizeDisplayText(processed);
    return result;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        const item = p as Record<string, unknown>;
        if (item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return null;
      })
      .filter((v): v is string => typeof v === "string");
    if (parts.length > 0) {
      const joined = parts.join("\n");
      const processed = role === "assistant" ? stripThinkingTags(joined) : stripEnvelope(joined);
      const result = sanitizeDisplayText(processed);
      return result;
    }
  }
  if (typeof m.text === "string") {
    const processed = role === "assistant" ? stripThinkingTags(m.text) : stripEnvelope(m.text);
    return sanitizeDisplayText(processed);
  }
  // Fallback: assistant messages may have errorMessage when content is empty
  if (role === "assistant" && typeof m.errorMessage === "string" && m.errorMessage) {
    return `Error: ${m.errorMessage}`;
  }
  return null;
}

export function extractTextCached(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return extractText(message);
  }
  const obj = message;
  if (textCache.has(obj)) {
    return textCache.get(obj) ?? null;
  }
  const value = extractText(message);
  textCache.set(obj, value);
  return value;
}

export function extractThinking(message: unknown): string | null {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const parts: string[] = [];
  if (Array.isArray(content)) {
    for (const p of content) {
      const item = p as Record<string, unknown>;
      if (item.type === "thinking" && typeof item.thinking === "string") {
        const cleaned = item.thinking.trim();
        if (cleaned) {
          parts.push(cleaned);
        }
      }
    }
  }
  if (parts.length > 0) {
    return parts.join("\n");
  }

  // Back-compat: older logs may still have <think> tags inside text blocks.
  const rawText = extractRawText(message);
  if (!rawText) {
    return null;
  }
  const matches = [
    ...rawText.matchAll(/<\s*think(?:ing)?\s*>([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>/gi),
  ];
  const extracted = matches.map((m) => (m[1] ?? "").trim()).filter(Boolean);
  return extracted.length > 0 ? extracted.join("\n") : null;
}

export function extractThinkingCached(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return extractThinking(message);
  }
  const obj = message;
  if (thinkingCache.has(obj)) {
    return thinkingCache.get(obj) ?? null;
  }
  const value = extractThinking(message);
  thinkingCache.set(obj, value);
  return value;
}

export function extractRawText(message: unknown): string | null {
  const m = message as Record<string, unknown>;
  const content = m.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        const item = p as Record<string, unknown>;
        if (item.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return null;
      })
      .filter((v): v is string => typeof v === "string");
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  if (typeof m.text === "string") {
    return m.text;
  }
  return null;
}

export function formatReasoningMarkdown(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `_${line}_`);
  return lines.length ? ["_Reasoning:_", ...lines].join("\n") : "";
}
