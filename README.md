<div align="center">

# 🌸 Bobby

**One chat dashboard over the LLM harnesses you already run.**

Talk to **Claude Code**, **Hermes**, **pi** — or any harness you add — from a single
window. Every chat saved to your own database; every conversation distillable into
your **Obsidian** knowledge base.

<p>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-7c3aed" />
  <img alt="typescript" src="https://img.shields.io/badge/TypeScript-strict-3178c6" />
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520-339933" />
  <img alt="tests" src="https://img.shields.io/badge/tests-34%20passing-4ade80" />
</p>

<img src="docs/screenshots/stream.gif" width="860" alt="Bobby — a live streaming turn" />

<sub>A real, unedited turn — type a prompt, watch Claude stream back, cost tracked, saved locally.</sub>

</div>

---

## Why Bobby?

You already run powerful LLM harnesses on your machine — coding agents and beyond.
What you *don't* have is one place to use them, compare them, and keep everything
they tell you. Bobby is that place — a thin, local-first dashboard that drives the
harness CLIs you already trust. Any harness works, not just coding ones; adding one
is a single adapter file.

- 🪟 **One window over many harnesses.** Switch harness *mid-chat*; ask all three
  the same question and compare.
- 🎚️ **Your model, your tools, per chat.** Change the model anytime, attach custom
  **agents** (Claude `--agent`/`--agents`) and **skills** (Hermes/pi) — or set
  defaults once in Settings.
- 💾 **Your chats are yours.** Every message lands in a local SQLite database you
  own, independent of each harness's own session store.
- 🧠 **Knowledge, not just transcripts.** Distill any chat into atomic notes written
  straight into your Obsidian vault — automatically or on demand.
- 📊 **Rich output.** Replies render real widgets — charts, diagrams (Mermaid),
  tables, and code — not just walls of text.
- 🖥️ **Runs anywhere.** A browser tab (`pnpm dev`) or a native desktop app
  (`pnpm desktop`, packaged to `.dmg`/`.exe`/`AppImage`).
- 🧩 **Open & extensible.** Adding a new harness is one adapter file. MIT licensed.

## Screenshots

<img src="docs/screenshots/widgets.png" width="860" alt="Charts, tables and diagrams rendered inline" />

<sub>Replies render as widgets — charts, tables, and Mermaid diagrams.</sub>

| Multi-harness sidebar + welcome | Global settings |
| :---: | :---: |
| <img src="docs/screenshots/welcome.png" width="420" alt="Welcome screen" /> | <img src="docs/screenshots/settings.png" width="420" alt="Settings" /> |
| **Per-chat agents & skills** | **Live streaming + code + cost** |
| <img src="docs/screenshots/agents.png" width="420" alt="Agents and skills panel" /> | <img src="docs/screenshots/chat.png" width="420" alt="Chat" /> |

## Quick start

**Prerequisites:** [Node](https://nodejs.org) ≥ 20, [pnpm](https://pnpm.io)
(`npm i -g pnpm`), and at least one harness CLI on your `PATH` — `claude`,
`hermes`, or `pi`.

**One line — clone, install, run:**

```bash
git clone https://github.com/ramanbht/bobby bobby && cd bobby && pnpm install && pnpm dev
```

Then open **http://localhost:5173**, hit **+ New chat**, pick a harness, and type.

<details>
<summary>Step by step</summary>

```bash
git clone https://github.com/ramanbht/bobby bobby && cd bobby
pnpm install            # installs deps, compiles the SQLite native module
cp .env.example .env    # optional — everything has sane defaults
pnpm dev                # ▶ web UI on http://localhost:5173, API on :8787
```

</details>

> Other commands: `pnpm test` (run the suite), `pnpm build` then `pnpm start`
> (production — serves UI + API on one origin at http://localhost:8787), `pnpm typecheck`.

## Desktop app

Prefer a native window over a browser tab?

```bash
pnpm desktop        # run Bobby in its own window (Electron) — boots the server for you
pnpm desktop:dist   # build a double-click installer → packages/desktop/release/
```

`pnpm desktop:dist` produces a real installer (`.dmg` on macOS, `.exe` on Windows,
`AppImage` on Linux). The server is bundled into a single file and runs in-process;
the native SQLite module is rebuilt for Electron automatically, so the packaged app
is fully self-contained.

> Note: `desktop:dist` recompiles `better-sqlite3` for Electron's ABI. If you then
> want to run `pnpm dev` / `pnpm test` (which use system Node), run `pnpm install`
> once to restore it.

## Configuration

Everything is environment variables (see [`.env.example`](.env.example)) — all optional:

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` | API/WebSocket port |
| `BOBBY_DB` | `./data/bobby.sqlite` | Where your chats are stored |
| `OBSIDIAN_VAULT` | *(unset)* | Absolute path to your vault. Unset ⇒ distillation off |
| `OBSIDIAN_FOLDER` | `Bobby` | Subfolder for distilled notes |
| `BOBBY_DISTILL_HARNESS` | `claude` | Harness used for the distillation pass |
| `BOBBY_AUTO_DISTILL` | `false` | Distill automatically after each turn |
| `BOBBY_CLAUDE_PERMISSION_MODE` | `acceptEdits` | Claude tool-permission mode |

## Customizing chats

- **Settings (⚙ in the sidebar)** — default harness, a default model per harness,
  and default agent/skills for new chats. Stored server-side.
- **Per-chat model** — the model field in the chat header is editable anytime; the
  next turn uses it.
- **Switch harness mid-chat** — the harness dropdown in the chat header; Bobby
  replays the conversation to the new harness so context carries over.
- **Edit & re-run** — hover any message you sent and hit **✎ edit**: Bobby rewrites
  it, discards everything after, and re-runs the conversation from that point.
- **Agents & skills (⚙ in the chat header)** — per harness, best-effort:

  | Field | Claude | Hermes | pi |
  |-------|--------|--------|----|
  | Agent | `--agent <name>` | — | — |
  | Custom agents JSON | `--agents <json>` | — | — |
  | Skills | — | `--skills a,b` | `--skill a --skill b` |

## How it works

```
                 ┌──────────────┐   WebSocket    ┌─────────────────────────┐
   React UI ◄────►│   Fastify    │◄──────────────►│  Adapter (per harness)  │
  (packages/web)  │   server     │  HarnessEvent  │  claude · hermes · pi   │
                 │ packages/    │     stream     └───────────┬─────────────┘
                 │  server      │                            │ spawns CLI
                 │              │                  ┌─────────▼─────────┐
                 │  SQLite ◄────┼── saves chats    │  claude / hermes  │
                 │  (canonical) │                  │  / pi subprocess  │
                 │  Distiller ──┼──► Obsidian      └───────────────────┘
                 └──────────────┘
```

Each **adapter** is the only code that knows a harness's CLI quirks. It spawns the
harness and normalizes whatever it emits into one `HarnessEvent` stream. The server
persists that stream to SQLite and forwards it to the browser, so the UI speaks one
dialect regardless of which agent is answering.

| Harness | Native mode Bobby uses | Streaming | Resume |
|---------|------------------------|-----------|--------|
| Claude Code | `claude -p --output-format stream-json` | token-level | `-r <session id>` |
| pi | `pi -p --mode json` | per-turn | `--session <id>` |
| Hermes | `hermes -z` (oneshot) | per-turn | via Bobby history |

## Testing

```bash
pnpm test     # 29 tests, fully offline — no harness or network needed
```

Covers the pure harness-output parsers (Claude stream-json, pi JSON extraction,
distill note parsing) and the HTTP API end-to-end via Fastify `inject` (chat CRUD,
per-chat model/agent/skills, settings, validation).

## Roadmap

- Token streaming for Hermes (ACP) and pi (`--mode rpc`) — the adapter interface
  already supports it.
- Richer tool-call/diff rendering in the chat view.
- More knowledge-base targets beyond Obsidian.

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the (short) guide
to adding a harness adapter.

## License

[MIT](LICENSE) — © 2026 Bobby contributors.
