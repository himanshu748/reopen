import assert from "node:assert/strict";
import test from "node:test";
import { classify } from "../server/domain.mjs";

const decision = { assumptions: ["The venue has reliable internet"], reviewCondition: "Review when connectivity becomes unavailable" };
const check = (text) => classify(text, decision, {}, "Demo");

test("conditional connectivity reports remain hypothetical even without a question mark", () => {
  for (const text of ["If connectivity changes, prepare a backup.", "Unless internet is available, cancel the demo.", "Assuming the Wi-Fi is unavailable, use the offline plan."])
    assert.equal(check(text).kind, "hypothetical", text);
});

test("negated certainty and hedged corrections cannot suggest a confirmed change", () => {
  for (const text of ["The venue internet outage is not confirmed.", "We haven’t confirmed that the Wi-Fi is unavailable.", "We cannot confirm the network changed.", "Actually, maybe the venue internet is unavailable.", "Nobody said the venue internet is unavailable.", "No one confirmed the network changed.", "The venue outage has not yet been confirmed."])
    assert.equal(check(text).kind, "uncertain", text);
});

test("an explicitly unchanged premise is context rather than a change suggestion", () => {
  for (const text of ["The network has not changed.", "The Wi-Fi is unchanged and available now.", "The venue is not cancelled.", "The internet is not unavailable.", "The venue has not been cancelled.", "The venue hasn’t been cancelled.", "The venue internet was never unavailable.", "The venue is not going to be cancelled."])
    assert.equal(check(text).kind, "context", text);
});

test("curly apostrophes preserve explicit reports without rewriting their source text", () => {
  assert.equal(check("The venue Wi-Fi won’t be available.").kind, "reported_change");
  assert.equal(check("The venue Wi-Fi can’t be used.").kind, "reported_change");
});

test("topic aliases match whole words rather than revenue or newsroom substrings", () => {
  assert.equal(check("Confirmed: revenue changed.").kind, "unrelated");
  assert.equal(check("Confirmed: newsroom staffing changed.").kind, "unrelated");
  assert.equal(check("Confirmed: the room internet is unavailable.").kind, "reported_change");
});
