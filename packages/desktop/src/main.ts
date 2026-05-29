import { app, BrowserWindow, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";

/**
 * Bobby desktop shell.
 *
 * Electron boots the Bobby server as a child process (which serves both the
 * API/WebSocket and the built web UI from one origin), waits for it to come up,
 * then loads it in a native window.
 *
 *  - In development we spawn the server with the system `node`, so the
 *    `better-sqlite3` build already on disk loads fine.
 *  - In a packaged app we run it through Electron's bundled Node
 *    (`ELECTRON_RUN_AS_NODE`), and electron-builder rebuilds native deps to
 *    match Electron's ABI.
 */

const PORT = Number(process.env.BOBBY_PORT ?? 8799);
let server: ChildProcess | null = null;

function resourcePath(...parts: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, "..", "..", ...parts);
}

function startServer(): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(PORT),
    BOBBY_DB: path.join(app.getPath("userData"), "bobby.sqlite"),
    BOBBY_WORKDIR: path.join(app.getPath("userData"), "workspaces"),
    BOBBY_WEB_DIST: resourcePath("web", "dist"),
  };

  const entry = resourcePath("server", "dist", "index.js");

  if (app.isPackaged) {
    // Use Electron's own Node so we don't depend on a system install.
    env.ELECTRON_RUN_AS_NODE = "1";
    server = spawn(process.execPath, [entry], { env, stdio: "inherit" });
  } else {
    server = spawn("node", [entry], { env, stdio: "inherit" });
  }

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
