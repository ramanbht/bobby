import "dotenv/config";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { HarnessId } from "@bobby/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Package root (packages/server), regardless of running from src/ or dist/. */
const pkgRoot = path.resolve(__dirname, "..");

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

/**
 * One shared data directory for ALL launch methods (dev server, desktop .dmg,
 * launchd daemon) so chat history persists no matter how Bobby is started.
 * This matches Electron's `app.getPath("userData")` and the daemon's data dir
 * on macOS (~/Library/Application Support/Bobby). Override with BOBBY_DB /
 * BOBBY_WORKDIR (the test harness does this to stay isolated).
 */
function appDataDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Bobby");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Bobby");
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "Bobby");
}

const dataDir = appDataDir();

export interface Config {
  port: number;
  dbPath: string;
  /** Base dir for per-chat harness working directories. */
  workspacesDir: string;
  bin: Record<HarnessId, string>;
  claudePermissionMode: string;
  /**
   * Extended-thinking token budget for Claude, passed to the CLI as
   * MAX_THINKING_TOKENS. > 0 turns on visible reasoning; 0 disables it.
   */
  claudeThinkingTokens: number;
  obsidianVault: string | null;
  obsidianFolder: string;
  distillHarness: HarnessId;
  autoDistill: boolean;
  /** Built web UI to serve (so one origin serves UI + API; used by the desktop app). */
  webDist: string;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.BOBBY_DB ?? path.join(dataDir, "bobby.sqlite"),
  workspacesDir: process.env.BOBBY_WORKDIR ?? path.join(dataDir, "workspaces"),
  bin: {
    claude: process.env.BOBBY_CLAUDE_BIN ?? "claude",
    hermes: process.env.BOBBY_HERMES_BIN ?? "hermes",
    pi: process.env.BOBBY_PI_BIN ?? "pi",
  },
  claudePermissionMode: process.env.BOBBY_CLAUDE_PERMISSION_MODE ?? "acceptEdits",
  claudeThinkingTokens: Number(process.env.BOBBY_CLAUDE_THINKING_TOKENS ?? 4096),
  obsidianVault: process.env.OBSIDIAN_VAULT ?? null,
  obsidianFolder: process.env.OBSIDIAN_FOLDER ?? "Bobby",
  distillHarness: (process.env.BOBBY_DISTILL_HARNESS as HarnessId) ?? "claude",
  autoDistill: bool(process.env.BOBBY_AUTO_DISTILL, false),
  webDist: process.env.BOBBY_WEB_DIST ?? path.resolve(pkgRoot, "../web/dist"),
};

/** Ensure the runtime data directories exist. */
export function ensureDirs(): void {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  fs.mkdirSync(config.workspacesDir, { recursive: true });
}

/** Per-chat working directory the harness subprocess runs in. */
export function chatWorkdir(chatId: string): string {
  const dir = path.join(config.workspacesDir, chatId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
