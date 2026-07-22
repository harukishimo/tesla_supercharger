export type ErrorCode =
  | "FACILITY_NOT_FOUND" | "FACILITY_QUEUE_DISABLED" | "FULL_CONFIRMATION_REQUIRED"
  | "TERMS_NOT_ACCEPTED" | "TERMS_VERSION_OUTDATED" | "NICKNAME_INVALID"
  | "CAPTCHA_FAILED" | "RATE_LIMITED" | "ENTRY_NOT_FOUND" | "MANAGEMENT_TOKEN_INVALID"
  | "IDEMPOTENCY_KEY_REUSED"
  | "START_NOT_AVAILABLE" | "SKIP_START_NOT_AVAILABLE" | "CALL_EXPIRED" | "DURATION_REQUIRED" | "DURATION_NOT_INTEGER"
  | "DURATION_OUT_OF_RANGE" | "DURATION_ALREADY_CONFIRMED" | "EXTENSION_UNAVAILABLE"
  | "COMPLETE_NOT_AVAILABLE" | "PUSH_REGISTRATION_FAILED" | "SERVER_TEMPORARY_ERROR"
  | "UNEXPECTED_ERROR" | "CONFIGURATION_ERROR" | "INVALID_QUEUE_STATE";

const MESSAGES: Record<ErrorCode, string> = {
  FACILITY_NOT_FOUND: "施設情報が見つかりませんでした。もう一度検索してください。",
  FACILITY_QUEUE_DISABLED: "この施設では現在、待ち列を受け付けていません。現地状況を優先してください。",
  FULL_CONFIRMATION_REQUIRED: "アプリ上の待ちはありません。現地が満車であることを確認してから、待ち列を開始してください。",
  TERMS_NOT_ACCEPTED: "利用規約およびプライバシーポリシーへの同意が必要です。",
  TERMS_VERSION_OUTDATED: "利用規約またはプライバシーポリシーが更新されています。内容を確認して同意してください。",
  NICKNAME_INVALID: "ニックネームを1〜30文字で入力してください。",
  CAPTCHA_FAILED: "操作を確認できませんでした。もう一度お試しください。",
  RATE_LIMITED: "操作が集中しています。しばらくしてから、もう一度お試しください。",
  IDEMPOTENCY_KEY_REUSED: "同じ操作がすでに処理されています。最新の状態を確認してください。",
  ENTRY_NOT_FOUND: "この待ち列の情報を確認できません。利用が終了したか、ブラウザのデータが変更された可能性があります。",
  MANAGEMENT_TOKEN_INVALID: "この待ち列の情報を確認できません。利用が終了したか、ブラウザのデータが変更された可能性があります。",
  START_NOT_AVAILABLE: "まだ充電開始を受け付けられません。順番の状態を確認してください。",
  SKIP_START_NOT_AVAILABLE: "現地の空きを待ち列へ反映できませんでした。周りの並びを確認して、最新の状態を確認してください。",
  CALL_EXPIRED: "充電開始の受付時間を過ぎたため、待ち列を終了しました。必要な場合は現地状況を確認して、もう一度参加してください。",
  DURATION_REQUIRED: "予定充電時間を入力してください。",
  DURATION_NOT_INTEGER: "充電時間は1分単位の整数で入力してください。",
  DURATION_OUT_OF_RANGE: "充電時間は5〜120分で入力してください。",
  DURATION_ALREADY_CONFIRMED: "最初の充電時間はすでに確定しています。追加する場合は、終了前の確認で延長してください。",
  EXTENSION_UNAVAILABLE: "延長できる時間ではありません。現在の充電状態を確認してください。",
  COMPLETE_NOT_AVAILABLE: "充電完了の処理を確認できません。現在の状態を確認してください。",
  PUSH_REGISTRATION_FAILED: "通知を設定できませんでした。待ち列は維持されています。もう一度お試しください。",
  SERVER_TEMPORARY_ERROR: "一時的に処理できませんでした。少し待ってから、もう一度お試しください。",
  UNEXPECTED_ERROR: "処理を完了できませんでした。時間をおいて、もう一度お試しください。",
  CONFIGURATION_ERROR: "サーバーの設定を確認できないため、現在この操作を利用できません。",
  INVALID_QUEUE_STATE: "待ち列の状態が更新されています。最新の内容を確認してください。",
};

export class ApiError extends Error {
  constructor(public readonly code: ErrorCode, public readonly status = statusFor(code), public readonly retryable = retryableFor(code), message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = "ApiError";
  }
}

export function statusFor(code: ErrorCode): number {
  if (code === "MANAGEMENT_TOKEN_INVALID") return 403;
  if (code === "FACILITY_NOT_FOUND" || code === "ENTRY_NOT_FOUND") return 404;
  if (code === "FACILITY_QUEUE_DISABLED" || code === "FULL_CONFIRMATION_REQUIRED" || code === "IDEMPOTENCY_KEY_REUSED" || code === "START_NOT_AVAILABLE" || code === "SKIP_START_NOT_AVAILABLE" || code === "CALL_EXPIRED" || code === "DURATION_ALREADY_CONFIRMED" || code === "EXTENSION_UNAVAILABLE" || code === "COMPLETE_NOT_AVAILABLE" || code === "INVALID_QUEUE_STATE") return 409;
  if (code === "RATE_LIMITED") return 429;
  if (code === "SERVER_TEMPORARY_ERROR" || code === "CONFIGURATION_ERROR") return 503;
  return 400;
}

export function retryableFor(code: ErrorCode): boolean {
  return ["CAPTCHA_FAILED", "RATE_LIMITED", "START_NOT_AVAILABLE", "SKIP_START_NOT_AVAILABLE", "EXTENSION_UNAVAILABLE", "COMPLETE_NOT_AVAILABLE", "SERVER_TEMPORARY_ERROR", "UNEXPECTED_ERROR", "INVALID_QUEUE_STATE"].includes(code);
}

export function jsonError(error: unknown): Response {
  const apiError = error instanceof ApiError ? error : new ApiError("UNEXPECTED_ERROR", 500, true);
  return Response.json({ error: { code: apiError.code, message: apiError.message, retryable: apiError.retryable } }, {
    status: apiError.status,
    headers: apiError.code === "RATE_LIMITED" ? { "Retry-After": "30" } : undefined,
  });
}

export function jsonData<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, init);
}

export async function parseJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 32_768) throw new Error("body too large");
    const raw = await request.text();
    if (raw.length > 32_768) throw new Error("body too large");
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError("UNEXPECTED_ERROR", 400, false);
  }
}
