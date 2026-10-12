import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "seek-unstable-fields-test-"));
process.env.SEEK_TOKEN_DIR = dir;
writeFileSync(join(dir, "tokens.json"), JSON.stringify({
  origin: "https://nz.seek.com", issuer: "https://login.seek.com/", audience: "https://seek/api/candidate",
  client_id: "client", access_token: "fake", refresh_token: "fake", expires_at: Date.now() + 3_600_000, scope: null,
}));
const { sgql } = await import("../dist/auth.js");
const { publicGql } = await import("../dist/seek.js");

const FLAG = "application/features.seek.all+json";
const sentWith = new Map();
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(init.body);
  const op = Array.isArray(body) ? body[0] : body;
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  sentWith.set(op.operationName, headers["x-custom-features"]);
  return Response.json(Array.isArray(body) ? [{ data: {} }] : { data: {} });
};

test("signed-in operations that select Seek's unstable fields carry the features header", async () => {
  for (const name of [
    "jobDetailsPersonalised", "CandidateJobMatch", "createCandidateJobMatchRequest", "CandidateJobMatchStrongFit",
    "createCandidateJobMatchStrongFitRequest", "CandidateJobMatchStandOut", "createCandidateJobMatchStandOutRequest",
    "GetCareerFeed", "CareerFeedJobsNextBestQuestion", "SubmitCareerFeedJobsRefinement", "GetCareerFeedRecsRefinementStatus",
    "CareerFeedProfilePerformanceInsightsSummary",
  ]) {
    await sgql(name, {});
    assert.equal(sentWith.get(name), FLAG, name);
  }
});

test("other signed-in operations go without it, as the site sends them", async () => {
  for (const name of ["jobDetails", "GetSalaryNudge", "CareerFeedInsights", "GetSkills", "UpdateSkills"]) {
    await sgql(name, {});
    assert.ok(sentWith.has(name), `${name} was not sent`);
    assert.equal(sentWith.get(name), undefined, name);
  }
});

test("public operations that need it carry it, and others do not", async () => {
  for (const name of ["GetJobSearchAssist", "GetGraduatesTabData"]) {
    await publicGql(name, {});
    assert.equal(sentWith.get(name), FLAG, name);
  }
  await publicGql("SearchCompanies", {});
  assert.ok(sentWith.has("SearchCompanies"));
  assert.equal(sentWith.get("SearchCompanies"), undefined);
});
