#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const uiDir = path.join(repoRoot, "ui");

function usage() {
  // keep this tiny; it's invoked from npm scripts too
  process.stderr.write("Usage: node scripts/ui.js <install|dev|build|build-v1|test> [...args]\n");
}

function which(cmd) {
  try {
    const key = process.platform === "win32" ? "Path" : "PATH";
    const paths = (process.env[key] ?? process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean);
    const extensions =
      process.platform === "win32"
        ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
        : [""];
    for (const entry of paths) {
      for (const ext of extensions) {
        const candidate = path.join(entry, process.platform === "win32" ? `${cmd}${ext}` : cmd);
        try {
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function resolveRunner() {
  const pnpm = which("pnpm");
  if (pnpm) {
    return { cmd: pnpm, kind: "pnpm" };
  }
  return null;
}

function run(cmd, args, envOverride) {
  const child = spawn(cmd, args, {
    cwd: uiDir,
    stdio: "inherit",
    env: envOverride ?? process.env,
    shell: process.platform === "win32",
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
}

function runSync(cmd, args, envOverride) {
  const result = spawnSync(cmd, args, {
    cwd: uiDir,
    stdio: "inherit",
    env: envOverride ?? process.env,
    shell: process.platform === "win32",
  });
  if (result.signal) {
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function depsInstalled(kind) {
  try {
    const require = createRequire(path.join(uiDir, "package.json"));
    require.resolve("vite");
    require.resolve("dompurify");
    if (kind === "test") {
      require.resolve("vitest");
      require.resolve("@vitest/browser-playwright");
      require.resolve("playwright");
    }
    return true;
  } catch {
    return false;
  }
}

const [, , action, ...rest] = process.argv;
if (!action) {
  usage();
  process.exit(2);
}

const runner = resolveRunner();
if (!runner) {
  process.stderr.write("Missing UI runner: install pnpm, then retry.\n");
  process.exit(1);
}

const script =
  action === "install"
    ? null
    : action === "dev" || action === "dev-v2"
      ? "dev"
      : action === "build" || action === "build-v2" || action === "build-v1"
        ? "build"
        : action === "test"
          ? "test"
          : null;

if (action !== "install" && !script) {
  usage();
  process.exit(2);
}

// V2 is now the default UI — no special env needed
const runEnv = process.env;

if (action === "install") {
  run(runner.cmd, ["install", ...rest]);
} else if (action === "build-v1") {
  // Build V1 UI from main branch source (git checkout → build → restore)
  if (!depsInstalled("build")) {
    runSync(runner.cmd, ["install", "--prod"], { ...process.env, NODE_ENV: "production" });
  }
  try {
    spawnSync("git", ["checkout", "main", "--", "ui/src", "ui/index.html"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    runSync(runner.cmd, ["run", "build", ...rest], process.env);
  } finally {
    spawnSync("git", ["checkout", "HEAD", "--", "ui/src", "ui/index.html"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
  }
} else {
  const isBuild = action === "build" || action === "build-v2";
  if (!depsInstalled(action === "test" ? "test" : "build")) {
    const installEnv = isBuild ? { ...runEnv, NODE_ENV: "production" } : runEnv;
    const installArgs = isBuild ? ["install", "--prod"] : ["install"];
    runSync(runner.cmd, installArgs, installEnv);
  }
  run(runner.cmd, ["run", script, ...rest], runEnv);
}
