import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionTrail } from "../src/decision-trail.mjs";
const first = {
  title: "Use the online demo",
  rationale: "Venue has connectivity",
  assumptions: ["Reliable internet"],
  reviewCondition: "Internet becomes unavailable",
  sourceId: "source-a",
  quote: "The venue has connectivity.",
  version: 2,
};
const d = {
  id: "decision-a",
  ...first,
  title: "Use the offline demo",
  rationale: "Venue internet is unavailable",
  assumptions: ["Local assets work"],
  reviewCondition: "Local assets fail",
  sourceId: "source-b",
  quote: "The room has no internet.",
  status: "watching",
  version: 6,
  history: [
    { ...first, version: 3, status: "reopened", at: "2026-09-08T12:00:00Z" },
    { version: 4, status: "draft", at: "2026-09-08T12:01:00Z" },
  ],
};
const c = {
  id: "review-a",
  decisionId: "decision-a",
  decisionVersion: 2,
  decisionSnapshot: first,
  reopenedDecisionVersion: 3,
  status: "reopened",
  quote: "There is no Wi-Fi.",
  proposal: { status: "approved", before: "Run online demo", after: "Run offline demo" },
};
test("trail selects only real saved versions and preserves the original snapshot", () => {
  const result = buildDecisionTrail(d, [c]);
  assert.deepEqual(
    result.map((x) => x.version),
    [2, 3, 4, 6],
  );
  assert.equal(result[0].content.rationale, first.rationale);
  assert.equal(result.at(-1).content.rationale, d.rationale);
  assert.equal(result[0].reviews[0], c);
  assert.equal(result[1].outcomes[0], c);
  assert.equal(result[2].complete, false);
  assert.equal(result[2].content.rationale, undefined);
  assert.equal(result[3].changes.length, 0);
});
test("compares adjacent recorded fields exactly, without inferring missing words", () => {
  const result = buildDecisionTrail({ ...d, history: [{ ...first, status: "watching" }] }, [c]);
  const changes = result.at(-1).changes;
  assert.equal(result.at(-1).previousVersion, 2);
  assert.deepEqual(
    changes.find((x) => x.field === "assumptions"),
    { field: "assumptions", before: ["Reliable internet"], after: ["Local assets work"] },
  );
  assert.equal(changes.find((x) => x.field === "rationale").before, first.rationale);
});
test("merges history and evidence for the same version without duplicates or mutating saved data", () => {
  const before = JSON.stringify({ d, c });
  const result = buildDecisionTrail(
    { ...d, history: [{ ...first, status: "watching", at: "saved" }] },
    [
      c,
      { ...c, id: "foreign", decisionId: "other" },
      { ...c, id: "mismatched", decisionVersion: 99 },
    ],
  );
  assert.equal(result.filter((x) => x.version === 2).length, 1);
  assert.equal(result[0].recordType, "archive");
  assert.equal(result[0].status, "watching");
  assert.equal(result[0].reviews.length, 1);
  result[0].content.assumptions.push("Changed locally");
  assert.equal(JSON.stringify({ d, c }), before);
  assert.equal(
    result.some((x) => x.version === 99),
    false,
  );
});
