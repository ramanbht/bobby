#!/usr/bin/env node
/**
 * Install/uninstall Bobby as a macOS LaunchAgent so scheduled jobs fire even
 * when nobody's logged into the desktop app. The agent runs the self-updating
 * launcher (packages/server/scripts/launch.cjs) on login + relaunches on crash,
 * so each (re)start pulls + rebuilds the latest before booting the server.
 *
 *   pnpm daemon:install     install + load it (RunAtLoad + KeepAlive)
 *   pnpm daemon:status      check whether it's running
 *   pnpm daemon:uninstall   unload + remove the plist
 *
 * Auto-update is on by default; disable with `BOBBY_UPDATE_ON_START=false pnpm
 * daemon:install`.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const LABEL = "dev.bobby.server";
const HOME = os.homedir();
const PLIST = path.join(HOME, "Library", "LaunchAgents", `${LABEL}.plist`);
const DATA_DIR = path.join(HOME, "Library", "Application Support", "Bobby");
const LOG_DIR = path.join(HOME, "Library", "Logs", "Bobby");
const PORT = Number(process.env.PORT ?? 8787);

function requireMac() {
  if (process.platform !== "darwin") {
    console.error("`pnpm daemon:*` is macOS-only (launchd). For Linux/Windows, run `pnpm start` under your platform's service manager.");
    process.exit(1);
  }
}

function buildPlist({ nodeBin, launcher, workdir, updateOnStart }) {
  const env = {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    PORT: String(PORT),
    BOBBY_DB: path.join(DATA_DIR, "bobby.sqlite"),
    BOBBY_WORKDIR: path.join(DATA_DIR, "workspaces"),
    BOBBY_UPDATE_ON_START: String(updateOnStart),
  };
  const envBlock = Object.entries(env)
    .map(([k, v]) => `      <key>${k}</key>\n      <string>${escapeXml(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodeBin)}</string>
    <string>${escapeXml(launcher)}</string>
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(workdir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envBlock}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(path.join(LOG_DIR, "out.log"))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(path.join(LOG_DIR, "err.log"))}</string>
</dict>
</plist>
`;
}

const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function gui() {
  return `gui/${process.getuid()}`;
}

function install() {
  requireMac();
  const nodeBin = process.execPath;
  const serverEntry = path.resolve(__dirname, "..", "dist", "index.js");
  const launcher = path.resolve(__dirname, "launch.cjs");
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  if (!fs.existsSync(serverEntry)) {
    console.error(`Server build not found at: ${serverEntry}\nRun \`pnpm build\` first.`);
    process.exit(1);
  }
  // Auto-update on each (re)start by default; opt out with BOBBY_UPDATE_ON_START=false.
  const updateOnStart = !["0", "false", "no", "off"].includes(
    String(process.env.BOBBY_UPDATE_ON_START ?? "true").toLowerCase(),
  );
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(PLIST, buildPlist({ nodeBin, launcher, workdir: repoRoot, updateOnStart }));
  // Reload (bootout first to avoid "service already loaded" errors).
  try { execSync(`launchctl bootout ${gui()}/${LABEL}`, { stdio: "ignore" }); } catch { /* not loaded */ }
  execSync(`launchctl bootstrap ${gui()} "${PLIST}"`, { stdio: "inherit" });
  console.log("✓ Bobby daemon installed and running.");
  console.log(`  Plist:  ${PLIST}`);
  console.log(`  Data:   ${DATA_DIR}`);
  console.log(`  Logs:   ${LOG_DIR}`);
  console.log(`  Update: ${updateOnStart ? "on each (re)start — git pull + build" : "off"}`);
  console.log(`  Open:   http://localhost:${PORT}`);
}

function uninstall() {
  requireMac();
  try { execSync(`launchctl bootout ${gui()}/${LABEL}`, { stdio: "ignore" }); } catch { /* not loaded */ }
  if (fs.existsSync(PLIST)) fs.unlinkSync(PLIST);
  console.log("✓ Bobby daemon uninstalled.");
}

function status() {
  requireMac();
  if (!fs.existsSync(PLIST)) {
    console.log("Bobby daemon: not installed.");
    return;
  }
  console.log(`Plist: ${PLIST}`);
  try {
    const out = execSync(`launchctl print ${gui()}/${LABEL}`, { encoding: "utf8" });
    const state = out.match(/state\s*=\s*(\S+)/)?.[1] ?? "?";
    const pid = out.match(/pid\s*=\s*(\d+)/)?.[1] ?? "—";
    console.log(`State: ${state}   PID: ${pid}`);
    console.log(`Open:  http://localhost:${PORT}`);
  } catch {
    console.log("State: not loaded (run `pnpm daemon:install`).");
  }
}

const cmd = process.argv[2];
if (cmd === "install") install();
else if (cmd === "uninstall") uninstall();
else if (cmd === "status") status();
else {
  console.log("Bobby — macOS launchd daemon");
  console.log("Usage: pnpm daemon:install | daemon:status | daemon:uninstall");
}
