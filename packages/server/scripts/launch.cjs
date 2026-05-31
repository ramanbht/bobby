#!/usr/bin/env node
/**
 * Self-updating launcher for the Bobby server — makes "restart = latest".
 *
 * When update-on-start is on (the `--update` flag or a truthy
 * BOBBY_UPDATE_ON_START) AND we're in a git checkout, this pulls the latest
 * code (`git pull --ff-only`) and, only if HEAD actually moved, reinstalls and
 * rebuilds — then boots the server. So restarting picks up new versions with
 * no separate `pnpm refresh`.
 *
 * Safety first: any update failure (offline, dirty tree, non-fast-forward,
 * pnpm/git missing) is logged and ignored — the server ALWAYS boots on
 * whatever is already built. A packaged app (no `.git`) skips updating
 * entirely. A short throttle stops a crash-restart loop from hammering the
 * remote.
 *
 * Used by `pnpm start:latest` and, by default, the launchd daemon.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync, spawn } = require("node:child_process");

// packages/server/scripts/launch.cjs → repo root is three levels up.
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const serverEntry = path.resolve(__dirname, "..", "dist", "index.js");

const TRUTHY = ["1", "true", "yes", "on"];
const wantUpdate =
  process.argv.includes("--update") ||
  TRUTHY.includes(String(process.env.BOBBY_UPDATE_ON_START ?? "").toLowerCase());

// Don't let git block on a credential prompt in a non-interactive daemon.
const childEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

const log = (msg) => console.log(`[bobby:launch] ${msg}`);
const sh = (cmd) => execSync(cmd, { cwd: repoRoot, stdio: "inherit", env: childEnv });
const shOut = (cmd) => execSync(cmd, { cwd: repoRoot, encoding: "utf8", env: childEnv }).trim();

function selfUpdate() {
  if (!fs.existsSync(path.join(repoRoot, ".git"))) {
    log("not a git checkout — skipping update.");
    return;
  }

  // Throttle: a launchd crash-loop must not pull on every relaunch.
  const marker = path.join(os.tmpdir(), "bobby-last-update");
  try {
    if (Date.now() - Number(fs.readFileSync(marker, "utf8")) < 20_000) {
      log("updated moments ago — skipping.");
      return;
    }
  } catch {
    /* no marker yet */
  }
  try {
    fs.writeFileSync(marker, String(Date.now()));
  } catch {
    /* best effort */
  }

  const before = shOut("git rev-parse HEAD");
  log("checking for updates…");
  sh("git pull --ff-only");
  const after = shOut("git rev-parse HEAD");
  if (before === after) {
    log("already up to date.");
    return;
  }
  log(`updated ${before.slice(0, 7)} → ${after.slice(0, 7)} — installing & building…`);
  sh("pnpm install --prefer-offline");
  sh("pnpm build");
  log("build complete.");
}

if (wantUpdate) {
  try {
    selfUpdate();
  } catch (err) {
    log(`update skipped: ${err && err.message ? err.message : err}`);
  }
}

if (!fs.existsSync(serverEntry)) {
  log(`server build not found at ${serverEntry} — run \`pnpm build\` first.`);
  process.exit(1);
}

log("starting server…");
const child = spawn(process.execPath, [serverEntry], { stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
