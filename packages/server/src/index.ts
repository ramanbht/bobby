import { buildServer } from "./server.js";
import { config } from "./config.js";
import { initScheduler } from "./scheduler.js";

const app = buildServer();

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .then(() => {
    initScheduler(); // start any enabled cron jobs
    app.log.info(`Bobby server listening on http://localhost:${config.port}`);
    app.log.info(`  db: ${config.dbPath}`);
    app.log.info(
      config.obsidianVault
        ? `  obsidian: ${config.obsidianVault}/${config.obsidianFolder} (distill via ${config.distillHarness})`
        : "  obsidian: not configured (memory distillation disabled)",
    );
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
