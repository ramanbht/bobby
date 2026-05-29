import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Isolate tests onto a throwaway DB + workspace dir so they never touch real data.
const tmp = path.join(os.tmpdir(), `bobby-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: {
      BOBBY_DB: path.join(tmp, "test.sqlite"),
      BOBBY_WORKDIR: path.join(tmp, "workspaces"),
      // Ensure the Obsidian vault is treated as unconfigured during tests.
      OBSIDIAN_VAULT: "",
    },
  },
});
