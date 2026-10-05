import { test } from "node:test";
import assert from "node:assert/strict";
import { fillStandingAnswers, resolveAnswers } from "../dist/apply.js";

const questions = [
  { id: "RTW", text: "Which of the following statements best describes your right to work in New Zealand?", kind: "SingleChoiceQuestion",
    options: [{ id: "o1", text: "I&#39;m a New Zealand citizen", uri: null }, { id: "o2", text: "I have a family/partner visa with no restrictions", uri: null }], lastAnswer: null },
  { id: "NOTICE", text: "How much notice are you required to give your current employer?", kind: "SingleChoiceQuestion",
    options: [{ id: "n1", text: "None, I&#39;m ready to go now", uri: null }, { id: "n2", text: "2 weeks", uri: null }], lastAnswer: null },
  { id: "EXP", text: "How many years' experience do you have as a coordinator?", kind: "SingleChoiceQuestion",
    options: [{ id: "e1", text: "1 year", uri: null }, { id: "e2", text: "2 years", uri: null }], lastAnswer: null },
];
const standing = {
  workRights: { question: "right to work", option: "New Zealand citizen" },
  notice: { question: "notice", option: "None, I'm ready to go now" },
};

test("an explicit answer, however the caller words the question, suppresses the standing one", () => {
  const { wanted, autoFilled } = fillStandingAnswers(
    questions,
    [{ question: "Which of the following state", option: "family/partner visa" }, { question: "years' experience", option: "2 years" }],
    standing,
    null,
  );
  const forRtw = wanted.filter((w) => questions[0].text.toLowerCase().includes(w.question.toLowerCase()));
  assert.equal(forRtw.length, 1);
  assert.equal(forRtw[0].option, "family/partner visa");
  assert.deepEqual(autoFilled.map((a) => a.question), [questions[1].text]);
});

test("with nothing explicit, work rights and notice come from the standing answers", () => {
  const { wanted, autoFilled } = fillStandingAnswers(questions, [], standing, null);
  assert.equal(wanted.length, 2);
  assert.deepEqual(autoFilled.map((a) => a.answer), ["New Zealand citizen", "None, I'm ready to go now"]);
});

test("two answers for one question are refused rather than both sent", async () => {
  await assert.rejects(
    resolveAnswers({ questions }, [
      { question: "right to work", option: "New Zealand citizen" },
      { question: "Which of the following state", option: "family/partner visa" },
      { question: "notice", option: "2 weeks" },
      { question: "experience", option: "1 year" },
    ]),
    /two answers.*right to work/i,
  );
});

test("a complete, non-duplicated set resolves to option ids", async () => {
  const out = await resolveAnswers({ questions }, [
    { question: "right to work", option: "New Zealand citizen" },
    { question: "notice", option: "2 weeks" },
    { question: "experience", option: "1 year" },
  ]);
  assert.deepEqual(out.map((a) => [a.questionId, a.answers[0].id]), [["RTW", "o1"], ["NOTICE", "n2"], ["EXP", "e1"]]);
});
