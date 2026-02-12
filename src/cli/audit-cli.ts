/**
 * CLI commands for querying the gateway audit log (JSONL).
 * Provides `openclaw audit tail` and `openclaw audit search`.
 */

import type { Command } from "commander";
import fs from "node:fs";
import readline from "node:readline";
import { resolveStateDir } from "../config/paths.js";
import { resolveAuditPath } from "../gateway/audit-log.js";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";

type AuditEntry = {
  ts: string;
  event: string;
  actor: string;
  ip: string;
  details: Record<string, unknown>;
};

/** Read the last N lines from a file (efficient tail). */
function tailLines(filePath: string, count: number): string[] {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  return lines.slice(-count);
}

/** Format a single audit entry for human-readable output. */
function formatEntry(entry: AuditEntry): string {
  const ts = entry.ts.replace("T", " ").replace(/\.\d+Z$/, "Z");
  const details = Object.keys(entry.details).length > 0
    ? ` ${JSON.stringify(entry.details)}`
    : "";
  return `${theme.muted(ts)} ${entry.event} ${theme.muted(`actor=${entry.actor} ip=${entry.ip}`)}${details}`;
}

/** Parse a duration string (e.g. "1h", "24h", "7d") into milliseconds. */
function parseDuration(input: string): number | null {
  const match = /^(\d+)([smhd])$/i.exec(input.trim());
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (multipliers[unit] ?? 0);
}

/** Parse a --since value into a timestamp (ms). Supports durations and ISO dates. */
function parseSince(input: string): number {
  const durationMs = parseDuration(input);
  if (durationMs !== null) {
    return Date.now() - durationMs;
  }
  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid --since value: "${input}". Use a duration (e.g. 1h, 24h, 7d) or ISO date.`);
  }
  return parsed;
}

export function registerAuditCli(program: Command) {
  const audit = program
    .command("audit")
    .description("Query the gateway security audit log");

  audit
    .command("tail")
    .description("Show recent audit log entries")
    .option("-n, --lines <count>", "Number of lines to show", "20")
    .option("-f, --follow", "Stream new entries as they arrive", false)
    .option("--json", "Output raw JSONL", false)
    .action(async (opts: { lines: string; follow: boolean; json: boolean }) => {
      const stateDir = resolveStateDir();
      const filePath = resolveAuditPath(stateDir);
      if (!fs.existsSync(filePath)) {
        defaultRuntime.log(theme.muted("No audit log found."));
        return;
      }

      const count = Math.max(1, Number(opts.lines) || 20);
      const lines = tailLines(filePath, count);

      for (const line of lines) {
        if (opts.json) {
          defaultRuntime.log(line);
        } else {
          try {
            const entry = JSON.parse(line) as AuditEntry;
            defaultRuntime.log(formatEntry(entry));
          } catch {
            defaultRuntime.log(line);
          }
        }
      }

      if (opts.follow) {
        // Watch for new lines appended to the file
        let position = fs.statSync(filePath).size;
        fs.watchFile(filePath, { interval: 500 }, () => {
          try {
            const stat = fs.statSync(filePath);
            if (stat.size <= position) {
              // File was truncated/rotated — reset
              position = 0;
            }
            if (stat.size > position) {
              const fd = fs.openSync(filePath, "r");
              const buf = Buffer.alloc(stat.size - position);
              fs.readSync(fd, buf, 0, buf.length, position);
              fs.closeSync(fd);
              position = stat.size;
              const newLines = buf.toString("utf8").split("\n").filter((l) => l.trim());
              for (const nl of newLines) {
                if (opts.json) {
                  defaultRuntime.log(nl);
                } else {
                  try {
                    const entry = JSON.parse(nl) as AuditEntry;
                    defaultRuntime.log(formatEntry(entry));
                  } catch {
                    defaultRuntime.log(nl);
                  }
                }
              }
            }
          } catch {
            // Best-effort
          }
        });
        // Keep process alive
        await new Promise(() => {});
      }
    });

  audit
    .command("search")
    .description("Search audit log entries with filters")
    .option("--event <pattern>", "Filter by event name (substring match)")
    .option("--actor <pattern>", "Filter by actor (substring match)")
    .option("--since <duration>", "Time filter (e.g. 1h, 24h, 7d, or ISO date)")
    .option("--json", "Output raw JSONL", false)
    .action((opts: { event?: string; actor?: string; since?: string; json: boolean }) => {
      const stateDir = resolveStateDir();
      const filePath = resolveAuditPath(stateDir);
      if (!fs.existsSync(filePath)) {
        defaultRuntime.log(theme.muted("No audit log found."));
        return;
      }

      let sinceMs = 0;
      if (opts.since) {
        try {
          sinceMs = parseSince(opts.since);
        } catch (err) {
          defaultRuntime.log(theme.error(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        }
      }

      const eventFilter = opts.event?.toLowerCase();
      const actorFilter = opts.actor?.toLowerCase();

      const rl = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });

      let matchCount = 0;
      rl.on("line", (line) => {
        if (!line.trim()) {
          return;
        }
        try {
          const entry = JSON.parse(line) as AuditEntry;
          // Apply filters
          if (sinceMs > 0 && new Date(entry.ts).getTime() < sinceMs) {
            return;
          }
          if (eventFilter && !entry.event.toLowerCase().includes(eventFilter)) {
            return;
          }
          if (actorFilter && !entry.actor.toLowerCase().includes(actorFilter)) {
            return;
          }
          matchCount++;
          if (opts.json) {
            defaultRuntime.log(line);
          } else {
            defaultRuntime.log(formatEntry(entry));
          }
        } catch {
          // Skip malformed lines
        }
      });

      rl.on("close", () => {
        if (matchCount === 0) {
          defaultRuntime.log(theme.muted("No matching entries found."));
        } else {
          defaultRuntime.log(theme.muted(`\n${matchCount} entries found.`));
        }
      });
    });
}
