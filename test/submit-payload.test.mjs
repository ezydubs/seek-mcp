import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSubmitPayload } from "../dist/apply.js";

const base = {
  jobId: "95060390",
  correlationId: "corr-1",
  resume: null,
  coverLetterUri: null,
  selectionCriteriaUri: null,
  coverLetterText: null,
  selectionCriteriaText: null,
  questionnaireAnswers: [],
  mostRecentRole: null,
  profilePrivacyLevel: undefined,
};

test("minimal application: no résumé, letter, answers or role", () => {
  const p = buildSubmitPayload(base);
  assert.deepEqual(p, {
    jobId: "95060390",
    correlationId: "corr-1",
    zone: "anz-2",
    profilePrivacyLevel: "Public",
    priorityApply: { state: "NotPrioritized" },
  });

  assert.equal("resume" in p, false);
  assert.equal("coverLetter" in p, false);
  assert.equal("mostRecentRole" in p, false);
  assert.equal("questionnaireAnswers" in p, false);
  assert.equal("selectionCriteria" in p, false);
});

test("résumé is sent as id + blobstore uri + the site's fixed -1", () => {
  const p = buildSubmitPayload({ ...base, resume: { id: "r1", uri: "/v2/blobstore/resumes/r1/" } });
  assert.deepEqual(p.resume, { id: "r1", uri: "/v2/blobstore/resumes/r1/", idFromResumeResource: -1 });
});

test("written cover letter and selection criteria carry text and generated uri", () => {
  const p = buildSubmitPayload({
    ...base,
    coverLetterText: "Dear team",
    coverLetterUri: "/v2/blobstore/cover-letters/c1/",
    selectionCriteriaText: "Criteria",
    selectionCriteriaUri: "/v2/blobstore/selection-criteria/s1/",
  });
  assert.deepEqual(p.coverLetter, { writtenText: "Dear team", uri: "/v2/blobstore/cover-letters/c1/" });
  assert.deepEqual(p.selectionCriteria, { writtenText: "Criteria", uri: "/v2/blobstore/selection-criteria/s1/" });
});

test("current role omits finished rather than sending null", () => {
  const p = buildSubmitPayload({
    ...base,
    mostRecentRole: { company: "Acme", title: "Dev", started: { year: 2024, month: 2 }, finished: null },
  });
  assert.deepEqual(p.mostRecentRole, { company: "Acme", title: "Dev", started: { year: 2024, month: 2 } });
  const q = buildSubmitPayload({
    ...base,
    mostRecentRole: { company: "Acme", title: "Dev", started: { year: 2023, month: 1 }, finished: { year: 2024, month: 6 } },
  });
  assert.deepEqual(q.mostRecentRole, { company: "Acme", title: "Dev", started: { year: 2023, month: 1 }, finished: { year: 2024, month: 6 } });
});

test("questionnaire answers are passed through only when there are any; privacy level is honoured", () => {
  const answers = [{ questionId: "Q1", answers: [{ id: "O1", text: "Yes", uri: null }] }];
  const p = buildSubmitPayload({ ...base, questionnaireAnswers: answers, profilePrivacyLevel: "Private" });
  assert.deepEqual(p.questionnaireAnswers, answers);
  assert.equal(p.profilePrivacyLevel, "Private");
});
