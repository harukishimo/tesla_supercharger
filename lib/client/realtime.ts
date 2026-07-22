export type QueueChangedPayload = { siteId: string; queueVersion: number };

type RealtimeMessage = {
  event?: string;
  topic?: string;
  payload?: { event?: string; payload?: QueueChangedPayload };
};

/**
 * Private, receive-only Supabase Realtime Broadcast subscriber. PostgreSQL is
 * the only production sender; the browser receives only a facility version and
 * then performs the normal Route Handler fetch. If Realtime is unavailable,
 * polling remains the source of synchronization.
 */
export function subscribeToQueue(siteId: string, onChange: (payload: QueueChangedPayload) => void): () => void {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !publishableKey || typeof window === "undefined" || typeof WebSocket === "undefined") return () => undefined;

  const websocketUrl = `${baseUrl.replace(/^http/u, "ws").replace(/\/$/u, "")}/realtime/v1/websocket?apikey=${encodeURIComponent(publishableKey)}&vsn=1.0.0`;
  const topic = `realtime:site:${siteId}`;
  const socket = new WebSocket(websocketUrl);
  let reference = 0;
  let latestVersion = 0;
  let lastDeliveredAt = 0;
  let pending: QueueChangedPayload | null = null;
  let deliveryTimer: number | null = null;
  let heartbeat: number | null = null;
  let stopped = false;
  const send = (event: string, payload: unknown, messageTopic = topic) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ topic: messageTopic, event, payload, ref: String(++reference) }));
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (heartbeat !== null) window.clearInterval(heartbeat);
    if (deliveryTimer !== null) window.clearTimeout(deliveryTimer);
    socket.close();
  };
  socket.addEventListener("open", () => {
    send("phx_join", { config: { private: true, broadcast: { self: false, ack: true }, presence: { key: "" }, postgres_changes: [] }, access_token: publishableKey });
    heartbeat = window.setInterval(() => send("heartbeat", {}, "phoenix"), 25_000);
  });
  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data)) as RealtimeMessage;
      if (message.event !== "broadcast" || message.payload?.event !== "queue_changed") return;
      const payload = message.payload.payload;
      if (payload?.siteId !== siteId || !Number.isSafeInteger(payload.queueVersion) || payload.queueVersion <= 0 || payload.queueVersion <= latestVersion) return;
      latestVersion = payload.queueVersion;
      pending = payload;
      const deliver = () => {
        deliveryTimer = null;
        const next = pending;
        pending = null;
        if (!next) return;
        lastDeliveredAt = Date.now();
        onChange(next);
      };
      const wait = Math.max(0, 1_000 - (Date.now() - lastDeliveredAt));
      if (deliveryTimer === null) deliveryTimer = window.setTimeout(deliver, wait);
    } catch {
      // Ignore malformed public signals; polling will recover the state.
    }
  });
  socket.addEventListener("error", () => undefined);
  socket.addEventListener("close", () => {
    if (heartbeat !== null) window.clearInterval(heartbeat);
  });
  return stop;
}
