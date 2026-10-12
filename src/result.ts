import { NotLoggedInError } from "./auth.js";

export const MAX_CHARS = 80_000;

export const ok = (data: unknown) => {
  let text = JSON.stringify(data, null, 2) ?? "null";
  if (text.length > MAX_CHARS) {
    text =
      `${text.slice(0, MAX_CHARS)}\n…\n[cut at ${MAX_CHARS} of ${text.length} characters: ask for a smaller page ` +
      `(page / pageSize / perPage) or fewer sections]`;
  }
  return { content: [{ type: "text" as const, text }] };
};

export const fail = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  const hint =
    e instanceof NotLoggedInError ? " (signed-in tools need seek_auth; the public tools work without it)" : "";
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}${hint}` }] };
};

export const guard = (fn: () => Promise<unknown>) => fn().then(ok, fail);
