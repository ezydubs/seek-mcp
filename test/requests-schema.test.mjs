import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { buildClientSchema, parse, validate, getNamedType, typeFromAST } from "graphql";
import { getVariableValues } from "graphql/execution/values.js";
import { CANNED, SCENARIOS, loadModules } from "./scenarios.mjs";

const dir = mkdtempSync(join(tmpdir(), "seek-schema-test-"));
process.env.SEEK_TOKEN_DIR = dir;
writeFileSync(join(dir, "tokens.json"), JSON.stringify({
  origin: "https://nz.seek.com", issuer: "https://login.seek.com/", audience: "https://seek/api/candidate",
  client_id: "client", access_token: "fake", refresh_token: "fake", expires_at: Date.now() + 3_600_000, scope: null,
}));

const schema = buildClientSchema(JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/seek-schema.json.gz", import.meta.url))).toString()));
const { D } = await import("../dist/documents.js");
const siteDocuments = new Set(Object.values(D));

const sent = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/oauth/token")) return Response.json({ access_token: "fake", refresh_token: "fake", expires_in: 3600 });
  if (u.includes("upload.example.test")) return new Response(null, { status: 204 });
  if (u.includes("/api/jobsearch/")) return Response.json({ data: [], totalCount: 0, location: { whereId: "1018", description: "All Auckland" } });
  if (u.endsWith("/graphql")) {
    const body = JSON.parse(init.body);
    const ops = Array.isArray(body) ? body : [body];
    const replies = ops.map((op) => {
      const name = op.operationName ?? /\b(?:query|mutation)\s+(\w+)/.exec(op.query)?.[1];
      sent.push({ name, query: op.query, variables: op.variables ?? {}, endpoint: u });
      return { data: structuredClone(CANNED[name] ?? {}) };
    });
    return Response.json(Array.isArray(body) ? replies : replies[0]);
  }
  return new Response("not found", { status: 404 });
};

const modules = await loadModules();

const NEWER_THAN_SNAPSHOT = /^(Cannot query field|Unknown type|Unknown argument|Unknown fragment)/;
const LIVE_FIELDS = ["lastCoverLetterMethod"];
const newerLiveField = (m) => LIVE_FIELDS.some((f) => m.includes(`"${f}"`));

for (const [label, run] of SCENARIOS) {
  test(`${label}: requests match Seek's schema`, async () => {
    const before = sent.length;
    await run(modules).catch(() => undefined);
    const mine = sent.slice(before).filter((r) => r.endpoint.startsWith("https://nz.seek.com/"));
    assert.ok(mine.length > 0, "no GraphQL request was sent");
    for (const r of mine) {
      const doc = parse(r.query);
      const site = siteDocuments.has(r.query);
      const docErrors = validate(schema, doc).map((e) => e.message).filter((m) => !((site || newerLiveField(m)) && NEWER_THAN_SNAPSHOT.test(m)));
      assert.deepEqual(docErrors, [], `${r.name}: document does not validate`);
      const op = doc.definitions.find((d) => d.kind === "OperationDefinition");
      const known = (op.variableDefinitions ?? []).filter((v) => {
        const t = typeFromAST(schema, v.type);
        return !!t && !!getNamedType(t);
      });
      const { errors } = getVariableValues(schema, known, r.variables);
      assert.deepEqual((errors ?? []).map((e) => e.message), [], `${r.name}: variables do not fit the schema`);
    }
  });
}
