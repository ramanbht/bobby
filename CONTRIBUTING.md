# Contributing to Bobby

Thanks for your interest! Bobby is an open dashboard that sits on top of
existing LLM coding harnesses. The most valuable contributions are **new
harness adapters** and **memory/knowledge-base integrations**.

## Project layout

```
packages/
  shared/   Types shared by server + web (the event & wire protocol)
  server/   Fastify + WebSocket backend, SQLite store, harness adapters, memory pipeline
  web/      Vite + React chat UI
```

## Getting started

```bash
pnpm install
cp .env.example .env   # optional; everything has defaults
pnpm dev               # server on :8787, web on :5173
```

## Adding a harness adapter

1. Implement the `HarnessAdapter` interface in `packages/server/src/adapters/`.
   Your adapter spawns the harness CLI and normalizes its output into the
   `HarnessEvent` stream defined in `@bobby/shared`.
2. Register it in `packages/server/src/adapters/index.ts`.
3. Add its id to `HarnessId` / `HARNESSES` in `packages/shared/src/index.ts`.

That's it — the persistence layer, WebSocket streaming, and UI are
harness-agnostic and pick it up automatically.

## Conventions

- TypeScript, ES modules, `strict` on.
- Keep the adapter the *only* place that knows a harness's CLI quirks.
- Bobby's SQLite store is the source of truth for chat history; harness-native
  sessions are an optimization, never the canonical record.

## Running the tests

```bash
pnpm e2e               # one command: typecheck + 61 vitest tests + build + REST/WS smoke
pnpm e2e -- --live     # additionally run one live Claude turn (~$0.01)
pnpm e2e -- --skip-install  # re-run without `pnpm install`
```

What's covered automatically (no LLM credits needed):

| Layer | Coverage |
|---|---|
| Parsers / pure functions | Claude stream-json, hermes ACP `session/update` mapping, pi JSON extraction, distill note parser, `slugifyTitle`, `renderTranscript`, `promptWithHistory`, `parsePlanSteps`, `isValidSchedule` |
| HTTP API (`app.inject`) | health, harnesses, settings round-trip + validation, chat CRUD, harness switch + 404/400, jobs CRUD + validation, distill 400 |
| Orchestration (mocked adapter) | `runTurn` (streaming + session capture + auto-title), `runPlan` (plan parsing + `planMode`), `executePlan` + `continuePlan` (full pause/resume state machine), `stopChat` (cancellation), `editAndRerun` (truncate + clear + replay; assistant-edit rejection) |
| Server boot smoke | `node dist/index.js` boots; REST CRUD + harness switch live; **WebSocket** protocol — invalid JSON + 5 bogus-chat commands all produce `error` frames; `stop` is silent |

Agents: `pnpm e2e` is the single command — it exits non-zero on any failure and prints a clean per-category summary. When you add a new adapter, add parser unit tests; when you add server logic that streams or modifies messages, add an orchestration test using the mock-adapter pattern in `test/orchestration.test.ts`.

## Pull requests

`pnpm e2e` must pass before opening a PR. When you add an adapter, describe how
you tested it against a real CLI.
