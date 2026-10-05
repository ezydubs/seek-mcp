import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "seek-auth-test-"));
process.env.SEEK_TOKEN_DIR = dir;
const { gql } = await import("../dist/auth.js");

const stored = (access_token, refresh_token = "r") => ({
  origin: "https://nz.seek.com", issuer: "https://login.seek.com/", audience: "https://seek/api/candidate",
  client_id: "client", access_token, refresh_token, expires_at: Date.now() + 3_600_000, scope: null,
});
const write = (t) => writeFileSync(join(dir, "tokens.json"), JSON.stringify(t));

const seen = [];
globalThis.fetch = async (url, init) => {
  const auth = init?.headers?.authorization ?? "";
  seen.push({ url: String(url), auth });
  if (String(url).includes("/oauth/token")) {
    return new Response(JSON.stringify({ access_token: "renewed", refresh_token: "r2", expires_in: 3600 }), { status: 200 });
  }
  if (auth === "Bearer stale") {
    return new Response(JSON.stringify([{ errors: [{ message: "nope", extensions: { code: "UNAUTHENTICATED" } }] }]), { status: 200 });
  }
  return new Response(JSON.stringify([{ data: { who: auth.replace("Bearer ", "") } }]), { status: 200 });
};

test("a sign-in swapped in on disk is used by the next call", async () => {
  write(stored("first"));
  assert.deepEqual(await gql("query { who }"), { who: "first" });
  write(stored("second"));
  assert.deepEqual(await gql("query { who }"), { who: "second" });
});

test("a token Seek rejects is renewed once and the renewed token is stored and used", async () => {
  write(stored("stale"));
  assert.deepEqual(await gql("query { who }"), { who: "renewed" });
  assert.ok(seen.some((s) => s.url.includes("/oauth/token")), "refresh grant was called");
  assert.deepEqual(await gql("query { who }"), { who: "renewed" });
});
