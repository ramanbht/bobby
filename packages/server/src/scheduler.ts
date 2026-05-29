import cron, { type ScheduledTask } from "node-cron";
import type { Job, ServerFrame } from "@bobby/shared";
import * as db from "./db.js";
import { runTurn } from "./turn.js";

type Emit = (frame: ServerFrame) => void;

const tasks = new Map<string, ScheduledTask>();
let broadcast: Emit = () => {};

/** Frames from scheduled runs go to every connected client (the run's chat updates live if open). */
export function setJobBroadcaster(fn: Emit): void {
  broadcast = fn;
}

/** Run a job once now: send its prompt as a turn into its dedicated chat. */
export async function runJobNow(job: Job): Promise<void> {
  const chat = db.getChat(job.chatId);
  if (!chat) {
    db.setJobRun(job.id, "error: chat missing");
    return;
  }
  try {
    await runTurn(chat, job.prompt, broadcast);
    db.setJobRun(job.id, "ok");
  } catch (e) {
    db.setJobRun(job.id, `error: ${(e as Error).message}`);
  }
}

export function scheduleJob(job: Job): void {
  unscheduleJob(job.id);
  if (!job.enabled) return;
  if (!cron.validate(job.schedule)) {
    console.error(`[cron] invalid schedule for "${job.name}": ${job.schedule}`);
    return;
  }
  tasks.set(
    job.id,
    cron.schedule(job.schedule, () => {
      runJobNow(job).catch((e) => console.error("[cron] run failed:", (e as Error).message));
    }),
  );
}

export function unscheduleJob(id: string): void {
  const t = tasks.get(id);
  if (t) {
    t.stop();
    tasks.delete(id);
  }
}

/** Schedule all enabled jobs on startup. */
export function initScheduler(): void {
  for (const job of db.listJobs()) scheduleJob(job);
}

export function isValidSchedule(expr: string): boolean {
  return cron.validate(expr);
}
