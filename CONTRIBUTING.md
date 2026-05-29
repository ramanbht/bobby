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

## Pull requests

Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before opening a PR. When
you add an adapter, add parser unit tests (see `packages/server/test/`) and
describe how you tested it against a real CLI.
