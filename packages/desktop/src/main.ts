import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";

/**
 * Bobby desktop shell.
 *
 * Closing the window does NOT quit Bobby — it hides to the menu-bar tray so
 * scheduled jobs keep firing in the background. Quit explicitly from the tray
 * menu or Cmd+Q. (For a true OS-level daemon that survives login,
 * `pnpm daemon:install`.)
 *
 *  - Packaged: server is bundled to one `server.cjs` (esbuild) and required in
 *    process; better-sqlite3 is rebuilt for Electron's ABI by electron-builder.
 *  - Dev: spawn the workspace server with system `node`.
 */

const PORT = Number(process.env.BOBBY_PORT ?? 8799);
let server: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function startServer(): void {
  process.env.PORT = String(PORT);
  process.env.BOBBY_DB = path.join(app.getPath("userData"), "bobby.sqlite");
  process.env.BOBBY_WORKDIR = path.join(app.getPath("userData"), "workspaces");

  if (app.isPackaged) {
    process.env.BOBBY_WEB_DIST = path.join(process.resourcesPath, "web", "dist");
    require(path.join(__dirname, "..", "build", "server.cjs"));
  } else {
    process.env.BOBBY_WEB_DIST = path.join(__dirname, "..", "..", "web", "dist");
    const entry = path.join(__dirname, "..", "..", "server", "dist", "index.js");
    server = spawn("node", [entry], { env: process.env, stdio: "inherit" });
    server.on("exit", (code) => console.log("[bobby] server exited", code));
  }
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

function createTray(): void {
  // Empty icon + a unicode title gives a clean 🌸 in the macOS menu bar with
  // no platform-specific image asset to ship.
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle("🌸");
  tray.setToolTip("Bobby — click to open");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Bobby", click: () => showWindow() },
      { label: "Open in browser…", click: () => shell.openExternal(`http://localhost:${PORT}`) },
      { type: "separator" },
      { label: "Bobby is running — scheduled jobs will fire here.", enabled: false },
      { type: "separator" },
      { label: "Quit Bobby", accelerator: "CommandOrControl+Q", click: () => { isQuitting = true; app.quit(); } },
    ]),
  );
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
