/**
 * Tiny live LLM smoke for `pnpm e2e -- --live`. Spends ~$0.01 of Claude credit.
 * Creates a chat, sends a one-word prompt, asserts that the harness streamed +
 * the assistant message was saved with usage cost. Expects $PORT to be set.
 */
const PORT = process.env.PORT ?? "8781";
const BASE = `http://localhost:${PORT}`;

const chat = await (
  await fetch(BASE + "/api/chats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ harness: "claude", model: "sonnet", title: "e2e live" }),
  })
).json();

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
let deltaCount = 0;
let savedText = "";
let usageCost = null;
let done = false;

ws.onmessage = (e) => {
  const f = JSON.parse(e.data);
  if (f.type === "event" && f.event.type === "text-delta") deltaCount++;
  if (f.type === "turn-end") {
    savedText = f.message.content;
    usageCost = f.message.meta?.usage?.costUsd ?? null;
    done = true;
    ws.close();
  }
};
ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: "send",
      chatId: chat.id,
      text: "Reply with exactly: OK",
    }),
  );
};

const timer = setTimeout(() => {
  console.error("timeout waiting for turn-end");
  process.exit(1);
}, 90000);

ws.onclose = () => {
  clearTimeout(timer);
  const ok =
    done &&
    deltaCount > 0 &&
    savedText.trim().toUpperCase().includes("OK") &&
    typeof usageCost === "number" &&
    usageCost > 0;
  console.log(
    `deltas:${deltaCount} text:${JSON.stringify(savedText)} cost:${usageCost}`,
  );
  process.exit(ok ? 0 : 1);
};
