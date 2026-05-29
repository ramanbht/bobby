import { useEffect, useRef, useState } from "react";
import type { ServerFrame } from "@bobby/shared";

type Status = "connecting" | "open" | "closed";

/**
 * Maintains a single WebSocket to the server, auto-reconnecting, and delivers
 * every ServerFrame to the latest `onFrame` callback. Returns a `send` that
 * dispatches a turn for a chat.
 */
export function useChatSocket(onFrame: (frame: ServerFrame) => void) {
  const [status, setStatus] = useState<Status>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => setStatus("open");
      ws.onmessage = (ev) => {
        try {
          onFrameRef.current(JSON.parse(ev.data) as ServerFrame);
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onclose = () => {
        setStatus("closed");
        if (!closed) retry = setTimeout(connect, 1000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  const post = (payload: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const send = (chatId: string, text: string) => post({ type: "send", chatId, text });
  const editMessage = (chatId: string, messageId: string, text: string) =>
    post({ type: "edit", chatId, messageId, text });
  const plan = (chatId: string, text: string) => post({ type: "plan", chatId, text });
  const executePlan = (chatId: string, messageId: string) =>
    post({ type: "execute-plan", chatId, messageId });
  const stop = (chatId: string) => post({ type: "stop", chatId });

  return { status, send, editMessage, plan, executePlan, stop };
}
