import { test } from "node:test";
import assert from "node:assert/strict";
import { assertMutationSucceeded } from "../dist/auth.js";

test("a typed …Failure result is an error, with Seek's message", () => {
  assert.throws(
    () => assertMutationSucceeded("UpdatePreferredLocations2", {
      updatePreferredLocations2: { __typename: "UpdatePreferredLocations2Failure", error: { message: '"Preferred locations cannot be saved."' } },
    }),
    /Seek refused UpdatePreferredLocations2 \(updatePreferredLocations2\): Preferred locations cannot be saved\./,
  );
});

test("errors lists and error objects on a payload are errors too", () => {
  assert.throws(() => assertMutationSucceeded("DeleteAppliedJob", { deleteAppliedJob: { errors: [{ message: "nope" }] } }), /nope/);
  assert.throws(() => assertMutationSucceeded("X", { x: { error: { message: "bad" } } }), /bad/);
});

test("success payloads, null errors and empty lists pass", () => {
  assert.doesNotThrow(() => assertMutationSucceeded("A", { a: { __typename: "ASuccess", id: "1" } }));
  assert.doesNotThrow(() => assertMutationSucceeded("B", { b: { error: null, errors: [] } }));
  assert.doesNotThrow(() => assertMutationSucceeded("C", { c: null, d: true }));
});
