import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const TTS_PATH_PREFIX = "/__openclaw__/tts/";

/** Content-type by audio extension. */
function audioContentType(ext: string): string | null {
  switch (ext) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".webm":
      return "audio/webm";
    case ".opus":
      return "audio/opus";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}

/**
 * Serve TTS audio files from the OS temp directory.
 * Only files inside tts-* subdirectories of tmpdir() are allowed.
 * Returns true if the request was handled, false otherwise.
 */
export function handleTtsHttpRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url;
  if (!url || !url.startsWith(TTS_PATH_PREFIX)) {
    return false;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  // Extract filename from URL path (strip query string)
  const rawFilename = decodeURIComponent(url.slice(TTS_PATH_PREFIX.length).split("?")[0]);

  // Security: filename must be safe — no slashes, no path traversal
  if (
    !rawFilename ||
    rawFilename.includes("/") ||
    rawFilename.includes("\\") ||
    rawFilename.includes("..") ||
    rawFilename.includes("\0")
  ) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Bad Request");
    return true;
  }

  // The filename format from tts.ts is: voice-<timestamp>.<ext>
  // It lives inside a tts-<random> directory under tmpdir()
  // We need to search for it since we don't know the random dir name
  const tmp = tmpdir();
  let filePath: string | null = null;

  try {
    const entries = fs.readdirSync(tmp, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("tts-")) {
        continue;
      }
      const candidate = path.join(tmp, entry.name, rawFilename);
      // Double-check resolved path is still under tmpdir
      const resolved = path.resolve(candidate);
      if (!resolved.startsWith(tmp)) {
        continue;
      }
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        filePath = resolved;
        break;
      }
    }
  } catch {
    // tmpdir read failed
  }

  if (!filePath) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = audioContentType(ext);
  const stat = fs.statSync(filePath);

  res.statusCode = 200;
  res.setHeader("Content-Type", contentType ?? "application/octet-stream");
  res.setHeader("Content-Length", stat.size);
  // Allow browser to cache briefly since the file is ephemeral (5 min TTL)
  res.setHeader("Cache-Control", "private, max-age=300");

  if (req.method === "HEAD") {
    res.end();
    return true;
  }

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.statusCode = 500;
    }
    res.end();
  });

  return true;
}
