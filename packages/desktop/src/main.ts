import { app, BrowserWindow, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";

/**
 * Bobby desktop shell.
 *
 * Electron starts the Bobby server (which serves the API/WebSocket *and* the
 * built web UI from one origin), waits for it, then loads it in a window.
 *
 *  - Packaged: the server is bundled into a single `server.cjs` (esbuild) and
 *    run **in-process** in the Electron main. `better-sqlite3` is the only
 *    native dep, rebuilt for Electron's ABI by electron-builder and unpacked
 *    from the asar — so it loads here directly.
 *  - Dev: we spawn the workspace server with the system `node`, whose
 *    `better-sqlite3` build is already on disk.
 */

const PORT = Number(process.env.BOBBY_PORT ?? 8799);
let server: ChildProcess | null = null;

function startServer(): void {
  process.env.PORT = String(PORT);
  process.env.BOBBY_DB = path.join(app.getPath("userData"), "bobby.sqlite");
  process.env.BOBBY_WORKDIR = path.join(app.getPath("userData"), "workspaces");

  if (app.isPackaged) {
    process.env.BOBBY_WEB_DIST = path.join(process.resourcesPath, "web", "dist");
    // Run the bundled server in this process (native deps match Electron's ABI).
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
  const win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: "#0e0a16",
    title: "Bobby",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });

  // Open external links in the system browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer();
  } catch (err) {
    console.error(err);
  }
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => server?.kill());
