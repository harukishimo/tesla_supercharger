import { ApiError } from "./errors";

export async function verifyTurnstile(token: unknown, remoteIp?: string | null): Promise<void> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Local development may omit the widget. A production deployment must
    // fail closed so a forgotten secret never silently disables bot defense.
    if (process.env.NODE_ENV === "production") throw new ApiError("CONFIGURATION_ERROR");
    return;
  }
  if (typeof token !== "string" || !token) throw new ApiError("CAPTCHA_FAILED");
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const result = await response.json() as { success?: boolean };
    if (!response.ok || !result.success) throw new ApiError("CAPTCHA_FAILED");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("CAPTCHA_FAILED");
  }
}
