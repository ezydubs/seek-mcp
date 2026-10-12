import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "seek-applied-jobs-test-"));
process.env.SEEK_TOKEN_DIR = dir;
writeFileSync(join(dir, "tokens.json"), JSON.stringify({
  origin: "https://nz.seek.com", issuer: "https://login.seek.com/", audience: "https://seek/api/candidate",
  client_id: "client", access_token: "fake", refresh_token: "fake", expires_at: Date.now() + 3_600_000, scope: null,
}));
const { appliedJobs } = await import("../dist/api.js");

const node = (id, title, isExternal) => ({
  node: {
    id: `a${id}`, isActive: true, isExternal, hasAppliedWithResume: !isExternal, hasAppliedWithCoverLetter: false,
    appliedAt: { dateTimeUtc: "2026-10-05T09:30:00.000Z" }, events: [{ status: "Applied", timestamp: { dateTimeUtc: "2026-10-05T09:30:00.000Z" } }],
    job: { id, title, advertiser: { name: "Acme" } },
  },
});
const INSIGHTS = {
  "95000001": [
    { __typename: "ApplicantCount", count: 267, message: "267 candidates applied for this role" },
    { __typename: "ApplicantsWithResumePercentage", percentage: 100, message: "100% of candidates attached a resumé" },
    { __typename: "ApplicantsWithCoverLetterPercentage", percentage: 60, message: "60% of candidates attached a cover letter" },
  ],
  "95000002": [{ __typename: "ApplicantCount", count: 44, message: "44 candidates applied for this role" }],
};

let detailCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(init.body);
  const ops = Array.isArray(body) ? body : [body];
  const replies = ops.map((op) => {
    const name = op.operationName ?? /\b(?:query|mutation)\s+(\w+)/.exec(op.query)?.[1];
    if (name === "GetAppliedJobs") {
      return { data: { viewer: { id: "1", appliedJobs: { edges: [node("95000001", "Engineer", false), node("95000002", "SRE", false), node("95000003", "Off-site", true)] } } } };
    }
    if (name === "GetAppliedJobDetail") {
      detailCalls.push(op.variables.jobId);
      return { data: { viewer: { id: "1", appliedJob: { id: "x" } }, jobDetails: { insights: INSIGHTS[op.variables.jobId] ?? [] } } };
    }
    return { data: {} };
  });
  return Response.json(Array.isArray(body) ? replies : replies[0]);
};

test("applied jobs carry Seek's applicant count and résumé and cover-letter shares", async () => {
  detailCalls = [];
  const rows = await appliedJobs();
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId["95000001"].applicants, 267);
  assert.equal(byId["95000001"].applicantsWithResumePercent, 100);
  assert.equal(byId["95000001"].applicantsWithCoverLetterPercent, 60);
  assert.equal(byId["95000002"].applicants, 44);
  assert.equal(byId["95000002"].applicantsWithCoverLetterPercent, undefined);
});

test("off-site applications are not looked up, since Seek has no applicant figures for them", async () => {
  detailCalls = [];
  const rows = await appliedJobs();
  assert.deepEqual(detailCalls.sort(), ["95000001", "95000002"]);
  assert.equal(rows.find((r) => r.id === "95000003").applicants, undefined);
});

test("applicants: false lists applications without the extra lookups", async () => {
  detailCalls = [];
  const rows = await appliedJobs({ applicants: false });
  assert.equal(rows.length, 3);
  assert.deepEqual(detailCalls, []);
  assert.equal(rows[0].applicants, undefined);
});
