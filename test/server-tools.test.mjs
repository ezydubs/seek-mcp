import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.SEEK_TOKEN_DIR = mkdtempSync(join(tmpdir(), "seek-tools-test-"));
const { createServer, INSTRUCTIONS } = await import("../dist/server.js");
const { searchFilters } = await import("../dist/api.js");
const { clean } = await import("../dist/seek.js");
const { resolveCompanyId } = await import("../dist/companies.js");

globalThis.fetch = async () => {
  throw new Error("no network in unit tests");
};

const connect = async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
};

test("every tool is listed once, with a description, and the server explains itself", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length >= 58, `only ${names.length} tools`);
  for (const t of tools) assert.ok(t.description && t.description.length > 30, `${t.name} has no real description`);
  for (const n of ["seek_search", "seek_apply", "seek_saved_searches", "seek_preferences", "seek_company_reviews", "seek_career_salary", "seek_recruiter_search", "seek_people_search", "seek_notifications", "seek_delete_account"]) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  assert.match(client.getInstructions() ?? INSTRUCTIONS, /cannot be withdrawn/);
});

test("tools that act on other people or cannot be undone are marked and demand confirmation", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const n of ["seek_apply", "seek_delete_account", "seek_resume_delete", "seek_change_email"]) {
    assert.equal(byName[n].annotations?.destructiveHint, true, `${n} should be destructive`);
  }
  for (const n of ["seek_search", "seek_job", "seek_company", "seek_career_role"]) {
    assert.equal(byName[n].annotations?.readOnlyHint, true, `${n} should be read-only`);
  }
  for (const n of ["seek_report_job", "seek_contact_recruiter", "seek_company_review_feedback"]) {
    assert.ok(byName[n].inputSchema.required?.includes("confirm"), `${n} must require confirm`);
  }
  assert.ok(byName.seek_delete_account.inputSchema.required?.includes("confirmEmail"));
  const r = await client.callTool({ name: "seek_report_job", arguments: { id: "1", reason: "Fraudulent", comment: "x", email: "a@b.c", confirm: false } });
  assert.equal(r.isError, true, "confirm: false must be refused before anything is sent");
});

test("search filters use the parameter names and ids nz.seek.com uses", () => {
  assert.deepEqual(
    searchFilters({
      keywords: "accountant", where: "All Auckland", workType: ["full_time", "casual"], workArrangement: ["hybrid", "remote"],
      classification: [1200], subclassification: [6140, 6141], listedWithinDays: 7, salaryMin: 60000, advertiserId: "20159938", companyId: "2945",
    }),
    {
      keywords: "accountant", where: "All Auckland", worktype: "242,245", workarrangement: "2,3", classification: "1200",
      subclassification: "6140,6141", daterange: "7", salaryrange: "60000-", salarytype: "annual", advertiserid: "20159938", companyid: "2945",
    },
  );
  assert.deepEqual(searchFilters({}), {});
});

test("clean drops typenames and empty values but keeps false and zero", () => {
  assert.deepEqual(clean({ __typename: "X", a: null, b: "", c: [], d: {}, e: false, f: 0, g: [{ __typename: "Y", h: 1 }, null] }), { e: false, f: 0, g: [{ h: 1 }] });
});

test("a company is found by id, slug or profile URL without a lookup", async () => {
  assert.equal(await resolveCompanyId("171714208688486"), "171714208688486");
  assert.equal(await resolveCompanyId("kiwibank-171714208688486"), "171714208688486");
  assert.equal(await resolveCompanyId("https://nz.seek.com/companies/kiwibank-171714208688486/reviews"), "171714208688486");
});
