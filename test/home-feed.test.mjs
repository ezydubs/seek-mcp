import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "seek-home-feed-test-"));
process.env.SEEK_TOKEN_DIR = dir;
writeFileSync(join(dir, "tokens.json"), JSON.stringify({
  origin: "https://nz.seek.com", issuer: "https://login.seek.com/", audience: "https://seek/api/candidate",
  client_id: "client", access_token: "fake", refresh_token: "fake", expires_at: Date.now() + 3_600_000, scope: null,
}));
const { homeFeed } = await import("../dist/feed.js");

const jobNode = (i) => ({
  __typename: "CareerFeedJob", id: `${95000000 + i}`, jobId: `${95000000 + i}`, serviceToken: "44444444-4444-4444-8444-444444444444",
  job: { id: `${95000000 + i}`, title: `Job ${i}`, advertiser: { name: "Acme" } },
});
const REPLIES = {
  GetCareerFeed: {
    careerFeed: {
      serviceToken: "33333333-3333-4333-8333-333333333333",
      edges: [
        ...Array.from({ length: 45 }, (_, i) => ({ node: jobNode(i + 1) })),
        { node: { __typename: "CareerFeedPersonalMarketInsights", id: "mi1", role: { id: "accountant", uri: "http://graph.seek.com/role-title/accountant", roleTitle: "Accountant" }, location: { id: "1018", label: "All Auckland" } } },
      ],
    },
  },
};
globalThis.fetch = async (url, init = {}) => {
  const body = JSON.parse(init.body);
  const ops = Array.isArray(body) ? body : [body];
  const replies = ops.map((op) => ({ data: structuredClone(REPLIES[op.operationName] ?? {}) }));
  return Response.json(Array.isArray(body) ? replies : replies[0]);
};

test("the home feed pages its jobs, 20 at a time by default, and says how many there are", async () => {
  const first = await homeFeed();
  assert.equal(first.totalJobs, 45);
  assert.equal(first.jobs.length, 20);
  assert.equal(first.jobs[0].id, "95000001");
  const third = await homeFeed({ page: 3 });
  assert.deepEqual(third.jobs.map((j) => j.id), ["95000041", "95000042", "95000043", "95000044", "95000045"]);
  const big = await homeFeed({ pageSize: 50 });
  assert.equal(big.jobs.length, 45);
});

test("the feed's other sections come before the jobs, so a long answer never loses them", async () => {
  const feed = await homeFeed({ pageSize: 50 });
  const keys = Object.keys(feed);
  assert.ok(keys.includes("marketInsights"));
  assert.ok(keys.indexOf("marketInsights") < keys.indexOf("jobs"), keys.join(", "));
});
