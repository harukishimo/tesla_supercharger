export interface QueueBroadcast { siteId: string; queueVersion: number; }
export type BroadcastSender = (payload: QueueBroadcast) => Promise<void>;

let sender: BroadcastSender | undefined;
export function setBroadcastSenderForTests(value: BroadcastSender | undefined) { sender = value; }

/**
 * Production Broadcast is emitted inside PostgreSQL by the
 * `broadcast_queue_version` trigger. Keeping this seam lets domain tests
 * observe a queue change without reintroducing a browser-callable REST
 * Broadcast endpoint.
 */
export async function broadcastQueueChanged(payload: QueueBroadcast): Promise<void> {
  if (!payload.siteId || !Number.isSafeInteger(payload.queueVersion)) return;
  if (sender) await sender(payload);
}
