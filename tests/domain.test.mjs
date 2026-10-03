import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../server/index.mjs";

const ORIGIN = "http://localhost";
const BASELINE = "2026-09-05T12:00:00.000Z";
const originalQuote = "The venue has reliable internet for the walkthrough.";
const decisionInput = {
  title: "Keep the walkthrough online",
  rationale: "Use the working online flow at the venue.",
  assumptions: ["The venue has reliable internet"],
  reviewCondition: "Review if the venue internet becomes unavailable.",
  quote: originalQuote,
};
const source = (title, occurredAt, text) => ({ title, occurredAt, text });

async function notebook(t) {
  const app = await createApp({
    dbPath: ":memory:",
    noVite: true,
    production: false,
    origin: ORIGIN,
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = "";
  let csrf = "";
  let project;
  async function request(path, body) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { response, body: await response.json() };
  }
  const registration = await request("/api/register", {
    name: "Notebook Owner",
    email: "owner@example.test",
    password: "A private notebook passphrase",
  });
  assert.equal(registration.response.status, 200);
  cookie = registration.response.headers.get("set-cookie").split(";")[0];
  csrf = registration.body.csrf;
  const created = await request("/api/projects", { title: "The demo room" });
  assert.equal(created.response.status, 201);
  project = created.body.project;
  const persisted = () =>
    JSON.parse(
      app.db.prepare("SELECT document FROM projects WHERE id=?").get(project.id)
        .document,
    );
  return {
    get project() {
      return project;
    },
    async run(type, payload, expectedStatus = 200, version = project.version) {
      const before = persisted();
      const result = await request(`/api/projects/${project.id}/commands`, {
        type,
        payload,
        expectedVersion: version,
      });
      assert.equal(
        result.response.status,
        expectedStatus,
        JSON.stringify(result.body),
      );
      if (expectedStatus === 200) {
        project = result.body.project;
        assert.equal(project.version, before.version + 1);
        assert.deepEqual(
          persisted(),
          project,
          "command persisted the returned document",
        );
      } else {
        assert.deepEqual(
          persisted(),
          before,
          "rejected command did not change SQLite",
        );
      }
      return result.body;
    },
  };
}

async function draft(n, { anchor = false } = {}) {
  await n.run("import_sources", {
    sources: [source("Original planning", BASELINE, originalQuote)],
  });
  if (anchor) {
    await n.run("add_checklist", { text: "Run the online-only walkthrough" });
  }
  await n.run("add_decision", {
    ...decisionInput,
    sourceId: n.project.sources[0].id,
    anchorId: n.project.checklist[0]?.id || "",
  });
  return n.project.decisions[0].id;
}

async function revised(n, decisionId, overrides = {}) {
  const current = n.project.decisions.find(
    (decision) => decision.id === decisionId,
  );
  await n.run("revise_decision", { ...current, ...overrides, id: decisionId });
}

async function reopened(t) {
  const n = await notebook(t);
  const decisionId = await draft(n, { anchor: true });
  await n.run("confirm_decision", { id: decisionId });
  await n.run("import_sources", {
    sources: [
      source(
        "Venue update",
        "2026-09-05T13:00:00Z",
        "The venue confirmed internet is unavailable for the walkthrough.",
      ),
    ],
  });
  const reviewId = n.project.candidates[0].id;
  await n.run("disposition", {
    id: reviewId,
    action: "reopen",
    confirmedChange: true,
    reason: "The organizer verified that the connection is unavailable.",
  });
  return { n, decisionId, reviewId, itemId: n.project.checklist[0].id };
}

test("automatic scan uses strict event time, including out-of-order imports and confirmation rescans", async (t) => {
  const n = await notebook(t);
  const decisionId = await draft(n);
  await n.run("import_sources", {
    sources: [
      source(
        "Latest event imported first",
        "2026-09-05T14:00:00Z",
        "The venue confirmed internet is unavailable at two.",
      ),
      source(
        "Older event imported second",
        "2026-09-05T11:00:00Z",
        "The venue confirmed internet is unavailable at eleven.",
      ),
      source(
        "Simultaneous event",
        BASELINE,
        "The venue confirmed internet is unavailable at noon.",
      ),
    ],
  });
  assert.equal(
    n.project.candidates.length,
    0,
    "drafts do not generate reviews",
  );
  await n.run("confirm_decision", { id: decisionId });
  assert.equal(n.project.candidates.length, 1);
  assert.equal(n.project.candidates[0].sourceId, n.project.sources[1].id);
  await n.run("import_sources", {
    sources: [
      source(
        "Late import of old event",
        "2026-09-05T11:59:59.999Z",
        "The venue confirmed internet was unavailable earlier.",
      ),
      source(
        "One millisecond newer",
        "2026-09-05T12:00:00.001Z",
        "The venue confirmed internet is now unavailable.",
      ),
      source(
        "Earlier than first import, later than decision",
        "2026-09-05T13:00:00Z",
        "The venue confirmed internet is unavailable at one.",
      ),
    ],
  });
  assert.equal(n.project.candidates.length, 3);
  for (const candidate of n.project.candidates) {
    const evidence = n.project.sources.find((s) => s.id === candidate.sourceId);
    assert.ok(Date.parse(evidence.occurredAt) > Date.parse(BASELINE));
  }
});

test("revision retires pending evidence and rescans each quote against the new decision version", async (t) => {
  const n = await notebook(t);
  const decisionId = await draft(n);
  await n.run("confirm_decision", { id: decisionId });
  await n.run("import_sources", {
    sources: [
      source(
        "Reviewable reports",
        "2026-09-05T13:00:00Z",
        "The venue confirmed internet is unavailable. The room network is no longer reliable.",
      ),
    ],
  });
  const [dismissed, pending] = structuredClone(n.project.candidates);
  await n.run("disposition", {
    id: dismissed.id,
    action: "dismiss",
    reason: "The owner checked this first statement and dismissed it.",
  });
  await revised(n, decisionId, {
    rationale: "The owner revised the decision rationale.",
  });
  assert.equal(n.project.decisions[0].status, "draft");
  assert.equal(n.project.candidates[0].status, "dismissed");
  const retired = n.project.candidates.find((c) => c.id === pending.id);
  assert.equal(retired.status, "retired");
  assert.equal(retired.quote, pending.quote);
  assert.equal(retired.decisionVersion, pending.decisionVersion);
  assert.ok(retired.retiredAt && retired.retirementReason);
  assert.equal(
    n.project.candidates.filter((c) => c.status === "pending").length,
    0,
  );
  await n.run("confirm_decision", { id: decisionId });
  const current = n.project.candidates.filter((c) => c.status === "pending");
  assert.equal(current.length, 2);
  assert.equal(
    n.project.candidates.length,
    4,
    "reviewed and retired history remains",
  );
  assert.equal(new Set(n.project.candidates.map((c) => c.key)).size, 4);
  for (const c of current)
    assert.equal(c.decisionVersion, n.project.decisions[0].version);
  await n.run(
    "link_evidence",
    {
      decisionId,
      sourceId: current[0].sourceId,
      quote: current[0].quote,
      reason: "Duplicate current-version review",
    },
    409,
  );
  await n.run(
    "disposition",
    {
      id: pending.id,
      action: "reopen",
      confirmedChange: true,
      reason: "This old version must not be actionable.",
    },
    409,
  );
});

test("manual historical links remain possible and can be linked again after revision", async (t) => {
  const n = await notebook(t);
  const decisionId = await draft(n);
  await n.run("confirm_decision", { id: decisionId });
  const quote =
    "The venue confirmed internet is unavailable in the previous planning notes.";
  await n.run("import_sources", {
    sources: [source("Historical evidence", "2026-09-04T10:00:00Z", quote)],
  });
  assert.equal(n.project.candidates.length, 0);
  const payload = {
    decisionId,
    sourceId: n.project.sources[1].id,
    quote,
    reason: "The owner explicitly links an older statement for context.",
  };
  await n.run("link_evidence", payload);
  const old = n.project.candidates[0];
  assert.equal(old.manual, true);
  await revised(n, decisionId);
  await n.run("confirm_decision", { id: decisionId });
  assert.equal(
    n.project.candidates.length,
    1,
    "the historical source is still not automatically rescanned",
  );
  await n.run("link_evidence", payload);
  const current = n.project.candidates[1];
  assert.equal(n.project.candidates[0].status, "retired");
  assert.notEqual(current.key, old.key);
  assert.notEqual(current.decisionVersion, old.decisionVersion);
  await n.run("link_evidence", payload, 409);
});

test("automatic and manual reviews preserve the decision snapshot after later revisions", async (t) => {
  const n = await notebook(t);
  const decisionId = await draft(n);
  await n.run("confirm_decision", { id: decisionId });
  await n.run("import_sources", {
    sources: [
      source(
        "Later report",
        "2026-09-05T13:00:00Z",
        "The venue confirmed internet is unavailable for the walkthrough.",
      ),
    ],
  });
  const manualLink = {
    decisionId,
    sourceId: n.project.sources[0].id,
    quote: originalQuote,
    reason: "Keep the original planning statement available for owner review.",
  };
  await n.run("link_evidence", manualLink);
  assert.equal(n.project.candidates.length, 2);
  const originalDecision = n.project.decisions[0];
  const expectedSnapshot = {
    title: originalDecision.title,
    rationale: originalDecision.rationale,
    assumptions: [...originalDecision.assumptions],
    reviewCondition: originalDecision.reviewCondition,
    sourceId: originalDecision.sourceId,
    quote: originalDecision.quote,
    version: originalDecision.version,
  };
  const oldIds = n.project.candidates.map((candidate) => candidate.id);
  for (const candidate of n.project.candidates) {
    assert.deepEqual(candidate.decisionSnapshot, expectedSnapshot);
  }
  await revised(n, decisionId, {
    title: "Keep the revised online plan",
    rationale:
      "A revised rationale must not replace the old paired explanation.",
    assumptions: [
      "The venue internet is reliable after the organizer checks it",
    ],
    reviewCondition: "Review if the checked internet becomes unavailable.",
  });
  await n.run("confirm_decision", { id: decisionId });
  await n.run("link_evidence", manualLink);
  for (const candidate of n.project.candidates) {
    if (oldIds.includes(candidate.id)) {
      assert.equal(candidate.status, "retired");
      assert.deepEqual(candidate.decisionSnapshot, expectedSnapshot);
    } else {
      assert.equal(
        candidate.decisionSnapshot.rationale,
        n.project.decisions[0].rationale,
      );
      assert.deepEqual(
        candidate.decisionSnapshot.assumptions,
        n.project.decisions[0].assumptions,
      );
      assert.equal(
        candidate.decisionSnapshot.version,
        n.project.decisions[0].version,
      );
    }
  }
  assert.equal(n.project.candidates.length, 4);
});

test("revising with a later source advances the baseline while preserving manual review", async (t) => {
  const n = await notebook(t);
  const decisionId = await draft(n);
  await n.run("confirm_decision", { id: decisionId });
  const report = "The venue confirmed internet is unavailable for this event.";
  const laterDecisionQuote =
    "The owner decided to keep the online flow after reviewing the connectivity report.";
  await n.run("import_sources", {
    sources: [
      source("Earlier report", "2026-09-05T13:00:00Z", report),
      source("Later decision", "2026-09-05T14:00:00Z", laterDecisionQuote),
    ],
  });
  await revised(n, decisionId, {
    sourceId: n.project.sources[2].id,
    quote: laterDecisionQuote,
  });
  await n.run("confirm_decision", { id: decisionId });
  assert.equal(n.project.decisions[0].effectiveAt, "2026-09-05T14:00:00.000Z");
  assert.equal(n.project.decisions[0].history[0].effectiveAt, BASELINE);
  assert.equal(n.project.decisions[0].status, "watching");
  assert.equal(
    n.project.candidates.filter((c) => c.status === "pending").length,
    0,
  );
  await n.run("link_evidence", {
    decisionId,
    sourceId: n.project.sources[1].id,
    quote: report,
    reason: "The owner wants to revisit this known earlier report.",
  });
  assert.equal(n.project.candidates.at(-1).manual, true);
});

test("source-less decisions use their recorded effective date, not arbitrary import order", async (t) => {
  const n = await notebook(t);
  await n.run("add_decision", { ...decisionInput, quote: "" });
  const decision = n.project.decisions[0];
  const baseline = Date.parse(decision.effectiveAt);
  assert.ok(Number.isFinite(baseline));
  await n.run("confirm_decision", { id: decision.id });
  await n.run("import_sources", {
    sources: [
      source(
        "Before",
        new Date(baseline - 1).toISOString(),
        "The venue confirmed internet was unavailable before the decision.",
      ),
      source(
        "Equal",
        new Date(baseline).toISOString(),
        "The venue confirmed internet was unavailable at the decision.",
      ),
      source(
        "After",
        new Date(baseline + 1).toISOString(),
        "The venue confirmed internet was unavailable after the decision.",
      ),
    ],
  });
  assert.equal(n.project.candidates.length, 1);
  assert.equal(n.project.candidates[0].sourceId, n.project.sources[2].id);
});

test("confirmation, evidence verdict, drafting and patch approval are distinct persistent actions", async (t) => {
  const n = await notebook(t);
  const decisionId = await draft(n, { anchor: true });
  const quote = "The venue confirmed internet is unavailable for the event.";
  await n.run("import_sources", {
    sources: [source("Reported change", "2026-09-05T13:00:00Z", quote)],
  });
  const before = structuredClone(n.project.checklist[0]);
  await n.run(
    "link_evidence",
    {
      decisionId,
      sourceId: n.project.sources[1].id,
      quote,
      reason: "A draft decision is not active.",
    },
    409,
  );
  await n.run("confirm_decision", { id: decisionId });
  const reviewId = n.project.candidates[0].id;
  assert.equal(n.project.decisions[0].status, "review_suggested");
  assert.equal(n.project.candidates[0].status, "pending");
  assert.deepEqual(n.project.checklist[0], before);
  await n.run(
    "disposition",
    {
      id: reviewId,
      action: "reopen",
      reason: "A change needs explicit confirmation.",
    },
    400,
  );
  await n.run("disposition", {
    id: reviewId,
    action: "reopen",
    confirmedChange: true,
    reason: "The owner verified the connection is unavailable.",
  });
  assert.equal(n.project.decisions[0].status, "reopened");
  assert.equal(n.project.candidates[0].proposal.status, "needs_draft");
  assert.deepEqual(n.project.checklist[0], before);
  await n.run("approve_checklist_change", { id: reviewId }, 409);
  await n.run("draft_checklist_change", {
    id: reviewId,
    after: "Prepare and run the offline walkthrough",
  });
  assert.equal(n.project.candidates[0].proposal.status, "pending_approval");
  assert.deepEqual(n.project.checklist[0], before);
  await n.run("approve_checklist_change", { id: reviewId });
  assert.equal(
    n.project.checklist[0].text,
    "Prepare and run the offline walkthrough",
  );
  assert.equal(n.project.checklist[0].version, before.version + 1);
  assert.equal(n.project.candidates[0].proposal.status, "approved");
  await n.run("approve_checklist_change", { id: reviewId }, 409);
});

test("a decision revision blocks both drafting and approval against an older reopened version", async (t) => {
  const { n, decisionId, reviewId } = await reopened(t);
  await n.run("draft_checklist_change", {
    id: reviewId,
    after: "Run the offline walkthrough",
  });
  const before = structuredClone(n.project.checklist[0]);
  await revised(n, decisionId);
  await n.run("approve_checklist_change", { id: reviewId }, 409);
  await n.run(
    "draft_checklist_change",
    { id: reviewId, after: "Use another offline walkthrough" },
    409,
  );
  assert.deepEqual(n.project.checklist[0], before);
});

test("checklist patches require the exact item version even when its visible state returns to the original", async (t) => {
  const { n, reviewId, itemId } = await reopened(t);
  await n.run("draft_checklist_change", {
    id: reviewId,
    after: "Run the offline walkthrough",
  });
  const originalText = n.project.checklist[0].text;
  await n.run("toggle_checklist", { id: itemId });
  await n.run("toggle_checklist", { id: itemId });
  assert.equal(n.project.checklist[0].done, false);
  assert.equal(n.project.checklist[0].text, originalText);
  assert.equal(n.project.checklist[0].version, 3);
  await n.run("approve_checklist_change", { id: reviewId }, 409);
  await n.run(
    "draft_checklist_change",
    { id: reviewId, after: "Run a different offline walkthrough" },
    409,
  );
});

test("reopening retires competing pending reviews and superseding retires remaining active evidence", async (t) => {
  const n = await notebook(t);
  const decisionId = await draft(n);
  await n.run("confirm_decision", { id: decisionId });
  await n.run("import_sources", {
    sources: [
      source(
        "Two reports",
        "2026-09-05T13:00:00Z",
        "The venue confirmed internet is unavailable. The room network is no longer reliable.",
      ),
    ],
  });
  const first = n.project.candidates[0].id;
  const other = n.project.candidates[1].id;
  await n.run("disposition", {
    id: first,
    action: "reopen",
    confirmedChange: true,
    reason: "The owner verified the first report.",
  });
  assert.equal(
    n.project.candidates.find((c) => c.id === other).status,
    "retired",
  );
  assert.equal(
    n.project.candidates.find((c) => c.id === first).status,
    "reopened",
  );
  await revised(n, decisionId);
  await n.run("confirm_decision", { id: decisionId });
  assert.equal(
    n.project.candidates.filter((c) => c.status === "pending").length,
    2,
  );
  await n.run("supersede_decision", {
    id: decisionId,
    reason: "A replacement decision owns the workflow now.",
  });
  assert.equal(
    n.project.candidates.filter((c) => c.status === "pending").length,
    0,
  );
  assert.equal(n.project.candidates.length, 4);
  assert.equal(
    n.project.candidates.find((c) => c.id === first).status,
    "reopened",
  );
});

test("negated and conditional evidence cannot reopen a decision or rewrite its source quote", async (t) => {
  const n = await notebook(t);
  const decisionId = await draft(n);
  await n.run("confirm_decision", { id: decisionId });
  const quotes = ["The venue internet outage is not confirmed.", "The venue internet has not changed.", "Unless the venue internet is available, cancel the demo.", "The venue has not been cancelled.", "The venue hasn’t been cancelled.", "The venue internet was never unavailable.", "Nobody said the venue internet is unavailable."];
  await n.run("import_sources", { sources: quotes.map((text, i) => source(`Conservative triage ${i}`, "2026-09-05T13:00:00Z", text)) });
  assert.equal(n.project.decisions[0].status, "watching");
  assert.deepEqual(n.project.candidates.map(c => c.kind), ["uncertain", "context", "hypothetical", "context", "context", "context", "uncertain"]);
  for (const c of n.project.candidates) {
    assert(quotes.includes(c.quote));
    await n.run("disposition", { id: c.id, action: "reopen", confirmedChange: true, reason: "This statement must not bypass clarification." }, 400);
  }
  assert.equal(n.project.decisions[0].status, "watching");
  assert.equal(n.project.candidates.every(c => c.status === "pending"), true);
});

test("hypothetical evidence cannot reopen a decision and stale notebook versions reject atomically", async (t) => {
  const n = await notebook(t);
  const decisionId = await draft(n);
  await n.run("confirm_decision", { id: decisionId });
  await n.run("import_sources", {
    sources: [
      source(
        "A question",
        "2026-09-05T13:00:00Z",
        "What if the venue internet became unavailable?",
      ),
    ],
  });
  const reviewId = n.project.candidates[0].id;
  assert.equal(n.project.candidates[0].kind, "hypothetical");
  await n.run(
    "disposition",
    {
      id: reviewId,
      action: "reopen",
      confirmedChange: true,
      reason: "A question is not verified evidence.",
    },
    400,
  );
  const staleVersion = n.project.version;
  await n.run("add_checklist", { text: "A separate owner action" });
  await n.run(
    "disposition",
    {
      id: reviewId,
      action: "clarify",
      reason: "Ask the organizer about the connection.",
    },
    409,
    staleVersion,
  );
  await n.run("disposition", {
    id: reviewId,
    action: "clarify",
    reason: "Ask the organizer about the connection.",
  });
  assert.equal(n.project.decisions[0].status, "watching");
  assert.equal(n.project.candidates[0].status, "clarification_requested");
});
