import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "seek-merge-test-"));
process.env.SEEK_TOKEN_DIR = dir;
writeFileSync(join(dir, "tokens.json"), JSON.stringify({
  origin: "x", issuer: "x", audience: "x", client_id: "c", access_token: "t", refresh_token: "r", expires_at: Date.now() + 3_600_000, scope: null,
}));

const replies = {
  GetConfirmedQualifications: { viewer: { _id: "1", confirmedQualifications: [{ id: "q1", name: { text: "BCom", ontologyId: "ont:bcom" }, institute: { text: "UoA", ontologyId: "ont:uoa" }, completed: true, completionDate: { year: 2019 }, highlights: "Dean's list" }] } },
  GetLicences: { viewer: { _id: "1", licences: [{ id: "l1", name: { text: "Class 1", ontologyId: "ont:c1" }, issuingOrganisation: "NZTA", issueDate: { year: 2015, month: 4 }, expiryDate: { year: 2030, month: 4 } }] } },
  GetRightsToWork: { viewer: { _id: "1", rightsToWork: [{ id: "rtw-au", country: { countryCode: "AU" }, type2: { id: "opt:au-citizen" } }, { id: "rtw-nz", country: { countryCode: "NZ" }, type2: { id: "opt:nz-visa" } }] } },
  ContactRecruiterByEmail: { contactRecruiterByEmail: { __typename: "ContactRecruiterFailure", errors: [{ code: "LIMIT", message: "limit reached" }] } },
};
const sent = [];
globalThis.fetch = async (url, init = {}) => {
  const b = JSON.parse(init.body);
  const ops = Array.isArray(b) ? b : [b];
  const out = ops.map((o) => { sent.push(o); return { data: structuredClone(replies[o.operationName] ?? {}) }; });
  return Response.json(Array.isArray(b) ? out : out[0]);
};
const sections = await import("../dist/profile-sections.js");
const { contactRecruiter } = await import("../dist/directory.js");
const last = (name) => sent.filter((o) => o.operationName === name).at(-1)?.variables;

test("updating a qualification changes only the fields given", async () => {
  await sections.upsertQualification({ id: "q1", highlights: "Top of class" });
  const q = last("UpdateQualification").qualification;
  assert.deepEqual(q, { id: "q1", name: { text: "BCom", ontologyId: "ont:bcom" }, institute: { text: "UoA", ontologyId: "ont:uoa" }, completed: true, completionYear: 2019, highlights: "Top of class" });
});

test("updating a licence keeps its dates and issuer", async () => {
  await sections.upsertLicence({ id: "l1", description: "Full licence" });
  const l = last("UpdateLicence").licenceData;
  assert.equal(l.name.text, "Class 1");
  assert.deepEqual(l.expiryDate, { year: 2030, month: 4 });
  assert.equal(l.noExpiryDate, false);
  assert.equal(l.issuingOrganisation, "NZTA");
  assert.equal(l.description, "Full licence");
});

test("setting one country's right to work keeps the others", async () => {
  await sections.updatePreferences({ rightsToWork: [{ countryCode: "NZ", optionId: "opt:nz-citizen" }] });
  const list = last("UpdateRightsToWork").input.rightsToWork;
  assert.deepEqual(list, [
    { id: "rtw-au", countryCode: "AU", type2: { id: "opt:au-citizen" } },
    { id: "rtw-nz", countryCode: "NZ", type2: { id: "opt:nz-citizen" } },
  ]);
});

test("a recruiter message Seek refuses is reported, and not sent a second way", async () => {
  const before = sent.filter((o) => o.operationName === "ContactRecruiterByEmail").length;
  await assert.rejects(contactRecruiter({ slug: "x", name: "A", email: "a@b.c", message: "Hi" }), /limit reached/);
  assert.equal(sent.filter((o) => o.operationName === "ContactRecruiterByEmail").length - before, 1);
});
