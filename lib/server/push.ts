export type PushKind = "five_minute" | "called" | "charge_end";
export interface PushMessage { kind: PushKind; subscriptionId: string; siteName: string; }
export type PushSender = (message: PushMessage) => Promise<void>;

let sender: PushSender | undefined;
export function setPushSenderForTests(value: PushSender | undefined) { sender = value; }

export async function sendQueuePush(message: PushMessage): Promise<boolean> {
  if (!message.subscriptionId) return false;
  if (sender) { await sender(message); return true; }
  // Web Push is optional. No API key is read by client code, and no-op is the
  // safe development behavior when OneSignal is not configured.
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  if (!apiKey || !appId) return false;

  const contents = {
    five_minute: "順番の約5分前です。施設付近へ戻る準備をしてください。",
    called: "順番です。5分以内に充電を開始してください。",
    charge_end: "充電終了予定の3分前です。終了または延長を選択してください。",
  }[message.kind];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        Authorization: `Basic ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: appId,
        include_subscription_ids: [message.subscriptionId],
        headings: { ja: "スパQ" },
        contents: { ja: contents },
        data: { kind: message.kind, siteName: message.siteName },
      }),
      signal: controller.signal,
    });
    return response.ok;
  } finally {
    clearTimeout(timeout);
  }
}
