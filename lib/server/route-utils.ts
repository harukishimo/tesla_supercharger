import { ApiError, jsonError, jsonData, parseJson } from "./errors";

export async function route<T>(handler: () => Promise<T>): Promise<Response> {
  try { return jsonData(await handler()); } catch (error) { return jsonError(error); }
}

export { parseJson };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function requireUuid(value: string | null | undefined, code: "FACILITY_NOT_FOUND" | "ENTRY_NOT_FOUND" = "ENTRY_NOT_FOUND"): string {
  if (!value || !UUID_RE.test(value)) throw new ApiError(code);
  return value;
}
