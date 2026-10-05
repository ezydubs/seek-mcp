import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readChromeLocalStorage } from "./chrome-storage.js";

export const ORIGIN = "https://nz.seek.com";
const ISSUER = "https://login.seek.com/";
const STORE_DIR = process.env.SEEK_TOKEN_DIR ?? join(homedir(), ".seek-mcp");
const TOKEN_PATH = join(STORE_DIR, "tokens.json");
const RENEW_MARGIN_MS = 5 * 60_000;

export class NotLoggedInError extends Error {}

export interface StoredToken {
  origin: string;
  issuer: string;
  audience: string;
  client_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string | null;
}

function readStore(): StoredToken | null {
  try {
    const t = JSON.parse(readFileSync(TOKEN_PATH, "utf8")) as StoredToken;
    return t?.access_token && t?.refresh_token ? t : null;
  } catch {
    return null;
  }
}

function writeStore(t: StoredToken): void {
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify(t, null, 2));
  chmodSync(TOKEN_PATH, 0o600);
}

export async function bootstrapFromChrome(): Promise<{ ok: boolean; detail: string }> {
  const entries = await readChromeLocalStorage(ORIGIN, "@@auth0spajs@@");
  for (const [key, raw] of Object.entries(entries)) {
    const body = JSON.parse(raw).body as Record<string, string> | undefined;
    if (!body?.refresh_token) continue;
    const m = key.match(/^@@auth0spajs@@(.+?)@@(.+)$/);
    const client_id = m?.[1] ?? body.client_id;
    const audience = m?.[2] ?? "https://seek/api/candidate";
    if (!client_id) continue;
    const refreshed = await refreshPair(body.refresh_token, client_id);
    writeStore({
      origin: ORIGIN,
      issuer: ISSUER,
      audience,
      client_id,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? body.refresh_token,
      expires_at: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
      scope: refreshed.scope ?? null,
    });
    return { ok: true, detail: `took Seek's sign-in from Chrome for ${audience} and renewed it` };
  }
  return {
    ok: false,
    detail: "Chrome holds no Seek sign-in. Log into nz.seek.com in Chrome, then run this again.",
  };
}

async function refreshPair(refresh_token: string, client_id: string) {
  const r = await fetch(`${ISSUER}oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id,
      refresh_token,
      redirect_uri: `${ORIGIN}/oauth/callback`,
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Seek refused to renew the sign-in (HTTP ${r.status}): ${text.slice(0, 200)}`);
  return JSON.parse(text) as {
    access_token: string; refresh_token?: string; expires_in?: number; scope?: string;
  };
}

let refreshing: Promise<StoredToken> | null = null;

async function renew(force = false): Promise<StoredToken> {
  if (!refreshing) {
    refreshing = currentToken(force).finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function currentToken(force: boolean): Promise<StoredToken> {
  const cur = readStore();
  if (!cur) throw new NotLoggedInError("No Seek sign-in. Run seek_auth first.");
  if (!force && cur.expires_at - RENEW_MARGIN_MS > Date.now()) return cur;
  try {
    const next = await refreshPair(cur.refresh_token, cur.client_id);
    const t: StoredToken = {
      ...cur,
      access_token: next.access_token,
      refresh_token: next.refresh_token ?? cur.refresh_token,
      expires_at: Date.now() + (next.expires_in ?? 3600) * 1000,
      scope: next.scope ?? cur.scope,
    };
    writeStore(t);
    return t;
  } catch (e) {
    throw new NotLoggedInError(
      `Could not renew the Seek sign-in: ${(e as Error).message}. Log into Seek again and re-run seek_auth.`,
    );
  }
}

export function authStatus() {
  const t = readStore();
  return {
    signedIn: !!t,
    account: t?.audience ?? null,
    clientId: t?.client_id ?? null,
    expiresAt: t?.expires_at ? new Date(t.expires_at).toISOString() : null,
    expired: t ? t.expires_at <= Date.now() : null,
    tokenPath: TOKEN_PATH,
    scope: t?.scope ?? null,
  };
}

function graphqlHeaders(token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "seek-request-brand": "seek",
    "seek-request-country": "NZ",
    origin: ORIGIN,
    referer: `${ORIGIN}/`,
  };
}

const unauthenticated = (body: any): boolean =>
  Array.isArray(body?.errors) &&
  body.errors.some((e: any) => e?.extensions?.code === "UNAUTHENTICATED");

export async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const send = async (token: string) => {
    const r = await fetch(`${ORIGIN}/graphql`, {
      method: "POST",
      headers: graphqlHeaders(token),
      body: JSON.stringify([{ query, variables }]),
    });
    const text = await r.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Seek returned HTTP ${r.status} that was not JSON: ${text.slice(0, 200)}`);
    }
    if (!r.ok && !body?.errors) throw new Error(`Seek returned HTTP ${r.status}: ${text.slice(0, 300)}`);
    return Array.isArray(body) ? body[0] : body;
  };
  let token = (await renew()).access_token;
  let body = await send(token);
  if (unauthenticated(body)) {
    token = (await renew(true)).access_token;
    body = await send(token);
  }
  if (unauthenticated(body)) throw new NotLoggedInError("Seek rejected the sign-in. Run seek_auth again.");
  if (body?.errors?.length) throw new Error(`Seek: ${body.errors[0].message}`);
  return body.data as T;
}

export async function seekGet(url: string, init: RequestInit = {}): Promise<Response> {
  const attempt = async (force: boolean) => {
    const token = (await renew(force)).access_token;
    const r = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, accept: "application/json", origin: ORIGIN },
    });
    if (r.status === 401 && !force) return attempt(true);
    return r;
  };
  return attempt(false);
}
