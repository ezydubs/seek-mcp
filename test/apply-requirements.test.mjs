import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "seek-apply-requirements-test-"));
process.env.SEEK_TOKEN_DIR = dir;
writeFileSync(join(dir, "tokens.json"), JSON.stringify({
  origin: "https://nz.seek.com", issuer: "https://login.seek.com/", audience: "https://seek/api/candidate",
  client_id: "client", access_token: "fake", refresh_token: "fake", expires_at: Date.now() + 3_600_000, scope: null,
}));
const { applicationProcess } = await import("../dist/api.js");

const REPLIES = {
  GetJobApplicationProcess: { jobApplicationProcess: { job: { title: "Accountant", advertiser: { name: "Acme" } }, questionnaire: { questions: [] }, documents: {} } },
  SearchSavedAndAppliedJobs: { viewer: { searchSavedJobs: [], searchAppliedJobs: [] } },
  GetVerifications: {
    viewer: {
      _id: "1",
      verificationNudges: [{ uri: "", ctaLabel: "Verify now", ctaUrl: "https://verify.example.test/id", description: "Digital identity", rank: 1, verificationType: ["digital_identity"] }],
    },
  },
};

let sent = [];
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(init.body);
  const ops = Array.isArray(body) ? body : [body];
  const replies = ops.map((op) => {
    const name = op.operationName ?? /\b(?:query|mutation)\s+(\w+)/.exec(op.query)?.[1];
    sent.push(name);
    return { data: structuredClone(REPLIES[name] ?? {}) };
  });
  return Response.json(Array.isArray(body) ? replies : replies[0]);
};

test("reading the questionnaire for an application does not ask Seek for verification prompts", async () => {
  sent = [];
  const p = await applicationProcess("95000001");
  assert.ok(!sent.includes("GetVerifications"), `sent: ${sent.join(", ")}`);
  assert.equal(p.verificationNudges, undefined);
});

test("apply requirements list Seek's verification prompts", async () => {
  sent = [];
  const p = await applicationProcess("95000001", { verificationNudges: true });
  assert.ok(sent.includes("GetVerifications"));
  assert.deepEqual(p.verificationNudges, [
    { rank: 1, description: "Digital identity", types: ["digital_identity"], action: "Verify now", url: "https://verify.example.test/id" },
  ]);
});
