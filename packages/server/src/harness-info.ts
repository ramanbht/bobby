import { spawnSync } from "node:child_process";
import { HARNESSES, type HarnessInfo } from "@bobby/shared";
import { adapters } from "./adapters/index.js";
import { config } from "./config.js";

const availabilityCache = new Map<string, boolean>();

function isAvailable(bin: string): boolean {
  if (availabilityCache.has(bin)) return availabilityCache.get(bin)!;
  let ok = false;
  try {
    // `which` resolves PATH entries on macOS/Linux without running the binary.
    const r = spawnSync("/usr/bin/env", ["which", bin], { encoding: "utf8" });
    ok = r.status === 0 && !!r.stdout.trim();
  } catch {
    ok = false;
  }
  availabilityCache.set(bin, ok);
  return ok;
}

export function listHarnessInfo(): HarnessInfo[] {
  return HARNESSES.map((id) => ({
    id,
    label: adapters[id].label,
    streaming: adapters[id].streaming,
    available: isAvailable(config.bin[id]),
  }));
}
