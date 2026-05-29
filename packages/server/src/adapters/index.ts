import type { HarnessId } from "@bobby/shared";
import { claudeAdapter } from "./claude.js";
import { hermesAdapter } from "./hermes.js";
import { piAdapter } from "./pi.js";
import type { HarnessAdapter } from "./types.js";

export const adapters: Record<HarnessId, HarnessAdapter> = {
  claude: claudeAdapter,
  hermes: hermesAdapter,
  pi: piAdapter,
};

export function getAdapter(id: HarnessId): HarnessAdapter {
  const a = adapters[id];
  if (!a) throw new Error(`Unknown harness: ${id}`);
  return a;
}

export type { HarnessAdapter, TurnInput } from "./types.js";
