import { estimateBase64DecodedBytes } from "../media/base64.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";

export type ChatAttachment = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content?: unknown;
};

export type ChatImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

/** Binary attachment that couldn't be inlined as text or passed as an image */
export type BinaryFileAttachment = {
  fileName: string;
  mimeType: string;
  base64: string;
};

export type ParsedMessageWithImages = {
  message: string;
  images: ChatImageContent[];
  /** Non-image, non-text attachments (PDF, DOCX, etc.) for media understanding */
  binaryFiles: BinaryFileAttachment[];
};

/** Text-like MIME types that can be decoded and injected into the message */
const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/x-sh",
  "application/x-python",
];

const TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".jsonl",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".py",
  ".rb",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".swift",
  ".kt",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd",
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".env",
  ".ini",
  ".cfg",
  ".conf",
  ".log",
  ".diff",
  ".patch",
  ".makefile",
  ".dockerfile",
  ".r",
  ".lua",
  ".pl",
  ".php",
  ".ex",
  ".exs",
  ".erl",
  ".hs",
  ".svelte",
  ".vue",
  ".astro",
]);

function isTextMime(mime?: string): boolean {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  return TEXT_MIME_PREFIXES.some((p) => lower.startsWith(p));
}

function isTextExtension(fileName?: string): boolean {
  if (!fileName) return false;
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_FILE_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}

/** Infer a code-fence language hint from file extension */
function langFromFileName(fileName?: string): string {
  if (!fileName) return "";
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  const ext = fileName.slice(dot + 1).toLowerCase();
  const map: Record<string, string> = {
    py: "python",
    js: "javascript",
    ts: "typescript",
    jsx: "jsx",
    tsx: "tsx",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    h: "c",
    hpp: "cpp",
    swift: "swift",
    kt: "kotlin",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    ps1: "powershell",
    sql: "sql",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    html: "html",
    css: "css",
    md: "markdown",
    csv: "csv",
    graphql: "graphql",
    proto: "protobuf",
    lua: "lua",
    php: "php",
    r: "r",
    ex: "elixir",
    exs: "elixir",
    hs: "haskell",
  };
  return map[ext] ?? ext;
}

/** Max size for text file injection into message (500 KB) */
const MAX_TEXT_FILE_BYTES = 512_000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type AttachmentLog = {
  warn: (message: string) => void;
};

type NormalizedAttachment = {
  label: string;
  mime: string;
  base64: string;
};

function normalizeMime(mime?: string): string | undefined {
  if (!mime) {
    return undefined;
  }
  const cleaned = mime.split(";")[0]?.trim().toLowerCase();
  return cleaned || undefined;
}

function isImageMime(mime?: string): boolean {
  return typeof mime === "string" && mime.startsWith("image/");
}

function isValidBase64(value: string): boolean {
  // Minimal validation; avoid full decode allocations for large payloads.
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function normalizeAttachment(
  att: ChatAttachment,
  idx: number,
  opts: { stripDataUrlPrefix: boolean; requireImageMime: boolean },
): NormalizedAttachment {
  const mime = att.mimeType ?? "";
  const content = att.content;
  const label = att.fileName || att.type || `attachment-${idx + 1}`;

  if (typeof content !== "string") {
    throw new Error(`attachment ${label}: content must be base64 string`);
  }
  if (opts.requireImageMime && !mime.startsWith("image/")) {
    throw new Error(`attachment ${label}: only image/* supported`);
  }

  let base64 = content.trim();
  if (opts.stripDataUrlPrefix) {
    // Strip data URL prefix if present (e.g., "data:image/jpeg;base64,...").
    const dataUrlMatch = /^data:[^;]+;base64,(.*)$/.exec(base64);
    if (dataUrlMatch) {
      base64 = dataUrlMatch[1];
    }
  }
  return { label, mime, base64 };
}

function validateAttachmentBase64OrThrow(
  normalized: NormalizedAttachment,
  opts: { maxBytes: number },
): number {
  if (!isValidBase64(normalized.base64)) {
    throw new Error(`attachment ${normalized.label}: invalid base64 content`);
  }
  const sizeBytes = estimateBase64DecodedBytes(normalized.base64);
  if (sizeBytes <= 0 || sizeBytes > opts.maxBytes) {
    throw new Error(
      `attachment ${normalized.label}: exceeds size limit (${sizeBytes} > ${opts.maxBytes} bytes)`,
    );
  }
  return sizeBytes;
}

/**
 * Parse attachments and extract images as structured content blocks.
 * Returns the message text and an array of image content blocks
 * compatible with Claude API's image format.
 */
export async function parseMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number; log?: AttachmentLog },
): Promise<ParsedMessageWithImages> {
  const maxBytes = opts?.maxBytes ?? 5_000_000; // decoded bytes (5,000,000)
  const log = opts?.log;
  if (!attachments || attachments.length === 0) {
    return { message, images: [], binaryFiles: [] };
  }

  const images: ChatImageContent[] = [];
  const textBlocks: string[] = [];
  const binaryFiles: BinaryFileAttachment[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const normalized = normalizeAttachment(att, idx, {
      stripDataUrlPrefix: true,
      requireImageMime: false,
    });
    validateAttachmentBase64OrThrow(normalized, { maxBytes });
    const { base64: b64, label, mime } = normalized;

    const providedMime = normalizeMime(mime);
    const sniffedMime = normalizeMime(await sniffMimeFromBase64(b64));
    const resolvedMime = sniffedMime ?? providedMime ?? mime;

    // Image attachments → pass as structured image content blocks
    if (isImageMime(sniffedMime) || (!sniffedMime && isImageMime(providedMime))) {
      if (sniffedMime && providedMime && sniffedMime !== providedMime) {
        log?.warn(
          `attachment ${label}: mime mismatch (${providedMime} -> ${sniffedMime}), using sniffed`,
        );
      }
      images.push({
        type: "image",
        data: b64,
        mimeType: resolvedMime,
      });
      // Add text placeholder so the model knows an image was attached even
      // when vision is unavailable (mirrors channel behavior: [media attached: ...]).
      textBlocks.push(`[Image attached: ${label} (${resolvedMime})]`);
      continue;
    }

    // Text/code files → decode and inject as fenced code block
    if (isTextMime(resolvedMime) || isTextExtension(att.fileName)) {
      if (sizeBytes > MAX_TEXT_FILE_BYTES) {
        log?.warn(
          `attachment ${label}: text file too large (${sizeBytes} bytes), adding placeholder`,
        );
        textBlocks.push(
          `[File attached: ${label} (${resolvedMime}, ${formatBytes(sizeBytes)} — too large to inline)]`,
        );
        continue;
      }
      try {
        const decoded = Buffer.from(b64, "base64").toString("utf-8");
        const lang = langFromFileName(att.fileName);
        // Use more backticks than the longest run in the content to avoid ambiguity
        const maxRun = Math.max(3, ...[...decoded.matchAll(/`+/g)].map((m) => m[0].length));
        const fence = "`".repeat(maxRun + 1);
        textBlocks.push(`[File: ${label}]\n${fence}${lang}\n${decoded}\n${fence}`);
      } catch {
        log?.warn(`attachment ${label}: failed to decode text, adding placeholder`);
        textBlocks.push(`[File attached: ${label} (${resolvedMime}, decode error)]`);
      }
      continue;
    }

    // Other binary files → collect for media understanding pipeline
    binaryFiles.push({ fileName: label, mimeType: resolvedMime, base64: b64 });
    textBlocks.push(`[File attached: ${label} (${resolvedMime}, ${formatBytes(sizeBytes)})]`);
  }

  // Append text file blocks to the message
  const augmentedMessage =
    textBlocks.length > 0 ? [message.trim(), ...textBlocks].filter(Boolean).join("\n\n") : message;

  return { message: augmentedMessage, images, binaryFiles };
}

/**
 * @deprecated Use parseMessageWithAttachments instead.
 * This function converts images to markdown data URLs which Claude API cannot process as images.
 */
export function buildMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number },
): string {
  const maxBytes = opts?.maxBytes ?? 2_000_000; // 2 MB
  if (!attachments || attachments.length === 0) {
    return message;
  }

  const blocks: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const normalized = normalizeAttachment(att, idx, {
      stripDataUrlPrefix: false,
      requireImageMime: true,
    });
    validateAttachmentBase64OrThrow(normalized, { maxBytes });
    const { base64, label, mime } = normalized;

    const safeLabel = label.replace(/\s+/g, "_");
    const dataUrl = `![${safeLabel}](data:${mime};base64,${base64})`;
    blocks.push(dataUrl);
  }

  if (blocks.length === 0) {
    return message;
  }
  const separator = message.trim().length > 0 ? "\n\n" : "";
  return `${message}${separator}${blocks.join("\n\n")}`;
}
