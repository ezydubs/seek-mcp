import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "seek-shapes-"));
process.env.SEEK_TOKEN_DIR = dir;
writeFileSync(join(dir, "tokens.json"), JSON.stringify({
  origin: "https://nz.seek.com", issuer: "https://login.seek.com/", audience: "https://seek/api/candidate",
  client_id: "none", access_token: "none", refresh_token: "none", expires_at: Date.now() + 3_600_000, scope: null,
}));

const { ANONYMOUS_CAPABLE, CANNED, SCENARIOS, loadModules } = await import("../test/scenarios.mjs");
const realFetch = globalThis.fetch;
const verdicts = new Map();
let forwardAllowed = true;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/oauth/token")) return Response.json({ access_token: "none", refresh_token: "none", expires_in: 3600 });
  if (u.includes("upload.example.test")) return new Response(null, { status: 204 });
  if (u.includes("/api/jobsearch/")) return Response.json({ data: [], totalCount: 0, location: { whereId: "1018" } });
  if (!u.endsWith("/graphql")) return new Response("not found", { status: 404 });
  const body = JSON.parse(init.body);
  const ops = Array.isArray(body) ? body : [body];
  const replies = [];
  for (const op of ops) {
    const name = op.operationName ?? /\b(?:query|mutation)\s+(\w+)/.exec(op.query)?.[1] ?? "(anonymous)";
    if (!forwardAllowed || ANONYMOUS_CAPABLE.has(name)) {
      if (!verdicts.has(name)) verdicts.set(name, { outcome: "not sent", detail: "may run without a sign-in" });
    } else {
      const headers = Object.fromEntries(Object.entries(init.headers ?? {}).filter(([k]) => k.toLowerCase() !== "authorization"));
      const r = await realFetch(u, { method: "POST", headers, body: JSON.stringify(op) });
      const j = await r.json().catch(() => ({}));
      const reply = Array.isArray(j) ? j[0] : j;
      const codes = (reply?.errors ?? []).map((e) => e.extensions?.code ?? "?");
      const bad = (reply?.errors ?? []).filter((e) => ["BAD_USER_INPUT", "GRAPHQL_VALIDATION_FAILED"].includes(e.extensions?.code));
      const resolverOnly = (reply?.errors ?? []).length > 0 && (reply.errors ?? []).every((e) => Array.isArray(e.path));
      const outcome = bad.length ? "REJECTED"
        : codes.includes("UNAUTHENTICATED") ? "accepted (needs sign-in)"
        : resolverOnly ? `accepted (resolver: ${codes.join(",")})`
        : codes.length ? `other: ${codes.join(",")}`
        : "accepted (public)";
      const prev = verdicts.get(name);
      if (!prev || prev.outcome !== "REJECTED") verdicts.set(name, { outcome, detail: bad.map((e) => e.message).join(" | ").slice(0, 400) });
    }
    replies.push({ data: structuredClone(CANNED[name] ?? {}) });
  }
  return Response.json(Array.isArray(body) ? replies : replies[0]);
};

const modules = await loadModules();
for (const [label, run, opts] of SCENARIOS) {
  forwardAllowed = !opts?.offlineOnly;
  await run(modules).catch(() => undefined);
}

const rows = [...verdicts].sort((a, b) => a[0].localeCompare(b[0]));
for (const [name, v] of rows) console.log(`${v.outcome === "REJECTED" ? "✗" : v.outcome.startsWith("accepted") ? "✓" : "·"} ${name.padEnd(34)} ${v.outcome}${v.detail ? `\n    ${v.detail}` : ""}`);
const rejected = rows.filter(([, v]) => v.outcome === "REJECTED");
console.log(`\n${rows.length} operations: ${rows.filter(([, v]) => v.outcome.startsWith("accepted")).length} accepted, ${rejected.length} rejected, ${rows.filter(([, v]) => v.outcome === "not sent").length} not sent`);
process.exit(rejected.length ? 1 : 0);
