import { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog, type MenuItemConstructorOptions } from "electron";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

/**
 * Bobby desktop shell.
 *
 * Closing the window does NOT quit Bobby — it hides to the menu-bar tray so
 * scheduled jobs keep firing in the background. Quit explicitly from the tray
 * menu or Cmd+Q.
 *
 * Bobby runs from a source checkout (`pnpm desktop`): this shell spawns the
 * workspace server with system `node`.
 */

const PORT = Number(process.env.BOBBY_PORT ?? 8799);
let server: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function startServer(): void {
  // Keep every launch method on ONE data dir (CLAUDE.md invariant). Forcing the
  // app name to "Bobby" makes userData resolve to ~/Library/Application Support/
  // Bobby — the same dir `pnpm dev` / `pnpm start` use — instead of the dev
  // package name (@bobby/desktop), which would silently split chat history.
  app.setName("Bobby");
  process.env.PORT = String(PORT);
  process.env.BOBBY_DB = path.join(app.getPath("userData"), "bobby.sqlite");
  process.env.BOBBY_WORKDIR = path.join(app.getPath("userData"), "workspaces");
  process.env.BOBBY_WEB_DIST = path.join(__dirname, "..", "..", "web", "dist");

  const entry = path.join(__dirname, "..", "..", "server", "dist", "index.js");
  server = spawn("node", [entry], { env: process.env, stdio: "inherit" });
  server.on("exit", (code) => console.log("[bobby] server exited", code));
}

function waitForServer(retries = 80): Promise<void> {
  return new Promise((resolve, reject) => {
    const ping = (n: number) => {
      http
        .get(`http://localhost:${PORT}/api/health`, (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => {
          if (n <= 0) reject(new Error("Bobby server did not start in time"));
          else setTimeout(() => ping(n - 1), 250);
        });
    };
    ping(retries);
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: "#0e0a16",
    title: "Bobby",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Intercept window close: hide to tray instead of quitting (so jobs keep firing).
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`http://localhost:${PORT}`);
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow().catch((e) => console.error(e));
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Restart the whole app: schedule a relaunch, then quit. The fresh process
 * boots a new server, so this picks up an updated build (after a `pnpm refresh`)
 * and clears any stuck state.
 */
function relaunchApp(): void {
  isQuitting = true;
  app.relaunch();
  app.quit();
}

/**
 * Manual "git pull on restart" for the desktop app: pull the latest, and only
 * if HEAD actually moved, reinstall + rebuild, then relaunch onto the new
 * build. Heavy steps run async so the menu-bar app doesn't beachball.
 *
 * Bobby runs from a source checkout, so there's always a repo to pull; the
 * `.git` guard below only trips if the tree was copied without it. Any failure
 * is shown and leaves Bobby untouched.
 */
async function checkForUpdatesAndRestart(): Promise<void> {
  const repoRoot = path.join(__dirname, "..", "..", "..");
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const head = () => execSync("git rev-parse HEAD", { cwd: repoRoot, env }).toString().trim();
  const step = (cmd: string, args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const p = spawn(cmd, args, { cwd: repoRoot, env, stdio: "inherit" });
      p.on("error", reject);
      p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} → exit ${code}`))));
    });

  if (!fs.existsSync(path.join(repoRoot, ".git"))) {
    await dialog.showMessageBox({
      type: "info",
      message: "Nothing to update",
      detail: "This folder has no .git, so there's no repo to pull. Re-clone Bobby from GitHub to update.",
    });
    return;
  }

  tray?.setTitle("🌸 ⏳");
  try {
    const before = head();
    await step("git", ["pull", "--ff-only"]);
    if (head() === before) {
      tray?.setTitle("🌸");
      await dialog.showMessageBox({
        type: "info",
        message: "Already up to date",
        detail: `You're on the latest commit (${before.slice(0, 7)}).`,
      });
      return;
    }
    await step("pnpm", ["install", "--prefer-offline"]);
    await step("pnpm", ["build"]);
    await step("pnpm", ["--filter", "@bobby/desktop", "build"]);
    relaunchApp();
  } catch (err) {
    tray?.setTitle("🌸");
    await dialog.showMessageBox({
      type: "error",
      message: "Update failed",
      detail: `${(err as Error).message || err}\n\nBobby was not changed — it's still on the current build.`,
    });
  }
}

function createTray(): void {
  // Empty icon + a unicode title gives a clean 🌸 in the macOS menu bar with
  // no platform-specific image asset to ship.
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("🌸");
  tray.setToolTip("Bobby — click to open");
  const template: MenuItemConstructorOptions[] = [
    { label: "Open Bobby", click: () => showWindow() },
    { label: "Open in browser…", click: () => shell.openExternal(`http://localhost:${PORT}`) },
    { type: "separator" },
    { label: "Bobby is running — scheduled jobs will fire here.", enabled: false },
    { type: "separator" },
  ];
  // Self-update from the source checkout: pull + rebuild + relaunch.
  template.push({ label: "Check for updates & Restart", click: () => void checkForUpdatesAndRestart() });
  template.push(
    { label: "Restart Bobby", click: () => relaunchApp() },
    { label: "Quit Bobby", accelerator: "CommandOrControl+Q", click: () => { isQuitting = true; app.quit(); } },
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.on("click", () => showWindow());
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer();
  } catch (err) {
    console.error(err);
  }
  createTray();
  await createWindow();

  app.on("activate", () => showWindow());
});

// Never auto-quit on last window close — tray-mode keeps Bobby alive so
// scheduled jobs fire even when the UI is hidden. Quit is explicit.
app.on("window-all-closed", () => {
  /* no-op */
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("quit", () => server?.kill());
