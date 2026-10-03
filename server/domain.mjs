import { createHash, randomUUID } from "node:crypto";
export class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (message, status = 400) => {
  throw new Problem(status, message);
};
export const str = (value, label, max = 1000, min = 1) => {
  if (typeof value !== "string" || value.trim().length < min || value.length > max)
    fail(`${label} must contain ${min}–${max} characters.`);
  return value.trim();
};
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
const find = (xs, key, label) =>
  xs.find((x) => x.id === key) || fail(`${label} was not found.`, 404);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const stop = new Set(
  "a an the is are was were be been to for of in on at with we our this that and or it has have had will would because can should may project decision change review confirmed statement says said source".split(
    " ",
  ),
);
// Normalize only the comparison text. Stored source quotes remain verbatim.
const comparisonText = (text) => text.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'");
const topicText = (text) => comparisonText(text)
  .replace(/\b(?:wi[ -]?fi|internet|network)\b/g, "connectivity")
  .replace(/\b(?:venue|room)\b/g, "location");
const tokens = (text) =>
  new Set(
    topicText(text)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((x) => x.length > 2 && !stop.has(x)),
  );
export function classify(sentence, decision, source, projectTitle) {
  const t = comparisonText(sentence);
  const ds = tokens([...decision.assumptions, decision.reviewCondition].join(" "));
  const overlap = [...tokens(sentence)].filter((x) => ds.has(x));
  if (source.projectLabel && source.projectLabel.toLowerCase() !== projectTitle.toLowerCase())
    return {
      kind: "unrelated",
      reason: `Source is labeled for ${source.projectLabel}, a different project.`,
      overlap,
    };
  if (!overlap.length)
    return {
      kind: "unrelated",
      reason: "No shared assumption topic was found. Link manually if relevant.",
      overlap,
    };
  if (
    /\?|\b(if|unless|assuming|provided that|suppose|imagine|hypothetical|hypothetically|would happen)\b/.test(
      t,
    )
  )
    return {
      kind: "hypothetical",
      reason: "A question or conditional scenario does not establish a changed premise.",
      overlap,
    };
  if (
    /\b(maybe|might|perhaps|possibly|probably|i think|i heard|not sure|uncertain|unconfirmed|likely|could|(?:nobody|no one)\s+(?:said|confirmed|verified)|(?:not|never)\s+(?:yet\s+)?(?:been\s+)?(?:confirmed|verified|certain)|(?:isn't|wasn't|aren't|weren't|hasn't|haven't|hadn't|can't|cannot|couldn't|don't|doesn't|didn't)\s+(?:yet\s+)?(?:been\s+)?(?:confirm|confirmed|verify|verified|know|known))\b/.test(
      t,
    )
  )
    return {
      kind: "uncertain",
      reason: "The statement contains uncertainty; clarify before acting.",
      overlap,
    };
  if (/\b(unchanged|no changes?|(?:not|never)\s+(?:yet\s+)?(?:(?:been|being|be|going to be)\s+)?(?:changed|cancelled|canceled|unavailable)|(?:isn't|wasn't|aren't|weren't|hasn't|haven't|hadn't|didn't)\s+(?:yet\s+)?(?:(?:been|being|be|going to be)\s+)?(?:changed|change|cancelled|canceled|unavailable))\b/.test(t))
    return {
      kind: "context",
      reason: "The statement explicitly denies a change. Link a separate confirmed report if another premise changed.",
      overlap,
    };
  if (/\b(correction|correcting|i was wrong|actually|retract|ignore what|misunderstood)\b/.test(t))
    return {
      kind: "correction",
      reason: "A correction needs the owner to check which earlier statement it supersedes.",
      overlap,
    };
  if (
    /\b(confirmed|no longer|will not|cannot|can't|changed|cancelled|canceled|unavailable|now|not available|won't|no connectivity|without connectivity)\b/.test(
      topicText(t),
    )
  )
    return {
      kind: "reported_change",
      reason:
        "An explicit report shares an assumption topic. This is a review suggestion, not verified truth.",
      overlap,
    };
  return {
    kind: "context",
    reason: "Related context without an explicit changed-premise report.",
    overlap,
  };
}
function audit(p, action, detail) {
  p.audit.push({ id: id(), at: now(), action, detail });
}
export function newProject(title, description = "") {
  const p = {
    id: id(),
    title: str(title, "Project name", 100),
    description: str(description, "Description", 500, 0),
    version: 1,
    createdAt: now(),
    updatedAt: now(),
    decisions: [],
    sources: [],
    candidates: [],
    checklist: [],
    audit: [],
  };
  audit(p, "project_created", "Private notebook created.");
  return p;
}
function decisionSnapshot(decision) {
  return {
    title: decision.title,
    rationale: decision.rationale,
    assumptions: [...decision.assumptions],
    reviewCondition: decision.reviewCondition,
    sourceId: decision.sourceId,
    quote: decision.quote,
    version: decision.version,
  };
}
function evidenceKey(decision, source, quote) {
  return hash(`${decision.id}|${decision.version}|${source.id}|${quote.toLowerCase()}`);
}
function hasEvidence(p, decision, source, quote) {
  // Match metadata too so older saved notebooks keep same-version deduplication.
  return p.candidates.some(
    (candidate) =>
      candidate.decisionId === decision.id &&
      candidate.decisionVersion === decision.version &&
      (candidate.sourceId === source.id ||
        (source.provider &&
          p.sources.some(
            (prior) =>
              prior.id === candidate.sourceId &&
              prior.origin === source.origin &&
              prior.provider?.conversationId === source.provider.conversationId,
          ))) &&
      candidate.quote.toLowerCase() === quote.toLowerCase(),
  );
}
function retireStaleReviews(p, decision, reason) {
  for (const candidate of p.candidates) {
    if (
      candidate.decisionId !== decision.id ||
      candidate.status !== "pending" ||
      candidate.decisionVersion === decision.version
    )
      continue;
    candidate.status = "retired";
    candidate.retiredAt = now();
    candidate.retiredByDecisionVersion = decision.version;
    candidate.retirementReason = reason;
  }
}
function effectiveDate(p, decision) {
  return (
    decision.effectiveAt ||
    p.sources.find((source) => source.id === decision.sourceId)?.occurredAt ||
    decision.createdAt
  );
}
function scan(p, source, onlyDecision) {
  const ds = p.decisions.filter(
    (d) =>
      (d.status === "watching" || d.status === "review_suggested") &&
      (!onlyDecision || d.id === onlyDecision) &&
      // Import order is not event order. Earlier or simultaneous evidence can
      // still be linked explicitly, but cannot suggest a later premise changed.
      Date.parse(source.occurredAt) > Date.parse(effectiveDate(p, d)),
  );
  const sentences = source.text.match(/[^.!?\n]+[.!?]?/g) || [];
  for (const d of ds)
    for (const raw of sentences) {
      const quote = raw.trim();
      if (quote.length < 12) continue;
      const result = classify(quote, d, source, p.title);
      if (result.kind === "unrelated" && !result.overlap.length) continue;
      const key = evidenceKey(d, source, quote);
      if (hasEvidence(p, d, source, quote)) continue;
      if (p.candidates.length >= 1000)
        fail("This notebook has reached 1,000 evidence links. Export or create a new notebook.");
      p.candidates.push({
        id: id(),
        key,
        decisionId: d.id,
        decisionVersion: d.version,
        decisionSnapshot: decisionSnapshot(d),
        sourceId: source.id,
        quote,
        ...result,
        status: "pending",
        manual: false,
        createdAt: now(),
        reasonForDisposition: "",
        proposal: null,
      });
      if (result.kind === "reported_change") d.status = "review_suggested";
    }
}
function decisionInput(p, input) {
  const assumptions = Array.isArray(input.assumptions)
    ? input.assumptions.map((x) => str(x, "Assumption", 600))
    : fail("Add at least one assumption.");
  if (!assumptions.length || assumptions.length > 10) fail("Use 1–10 assumptions.");
  const sourceId = input.sourceId || "";
  const quote = str(input.quote || "", "Source quote", 2000, 0);
  if (sourceId) {
    const s = find(p.sources, sourceId, "Source");
    if (!quote || !s.text.includes(quote))
      fail("The original quote must appear exactly in the selected source.");
  } else if (quote) fail("Choose a source for the original quote.");
  const anchorId = input.anchorId || "";
  if (anchorId) find(p.checklist, anchorId, "Checklist item");
  return {
    title: str(input.title, "Decision", 200),
    rationale: str(input.rationale, "Rationale", 2000),
    assumptions,
    reviewCondition: str(input.reviewCondition, "Review condition", 1000),
    sourceId,
    quote,
    anchorId,
    effectiveAt: sourceId ? find(p.sources, sourceId, "Source").occurredAt : now(),
  };
}
export function applyCommand(original, command) {
  if (!command || typeof command !== "object") fail("Send a valid command.");
  if (command.expectedVersion !== original.version)
    fail("This notebook changed in another session. Refresh and review the latest version.", 409);
  const p = structuredClone(original);
  const a = command.payload || {};
  switch (command.type) {
    case "add_decision": {
      if (p.decisions.length >= 50) fail("This notebook has reached 50 decisions.");
      const d = {
        id: id(),
        ...decisionInput(p, a),
        version: 1,
        status: "draft",
        createdAt: now(),
        history: [],
      };
      p.decisions.push(d);
      audit(p, "decision_drafted", d.title);
      break;
    }
    case "confirm_decision": {
      const d = find(p.decisions, a.id, "Decision");
      if (d.status !== "draft") fail("Only a draft decision can be confirmed.", 409);
      const source = p.sources.find((s) => s.id === d.sourceId);
      if (source?.provider && a.sourceChecked !== true)
        fail("Check the Bee transcript and processed context before confirming this decision.");
      if (source?.provider)
        audit(
          p,
          "source_wording_checked",
          `${d.title}; source ${source.id}; draft v${d.version}. Owner checked ASR wording against context.`,
        );
      d.status = "watching";
      d.version++;
      retireStaleReviews(p, d, "A new decision version was confirmed.");
      audit(p, "decision_confirmed", d.title);
      for (const s of p.sources) {
        if (s.id !== d.sourceId) scan(p, s, d.id);
      }
      break;
    }
    case "revise_decision": {
      const d = find(p.decisions, a.id, "Decision");
      d.history.push({
        version: d.version,
        at: now(),
        title: d.title,
        rationale: d.rationale,
        assumptions: d.assumptions,
        reviewCondition: d.reviewCondition,
        status: d.status,
        sourceId: d.sourceId,
        quote: d.quote,
        effectiveAt: effectiveDate(p, d),
      });
      Object.assign(d, decisionInput(p, a));
      d.status = "draft";
      d.version++;
      retireStaleReviews(p, d, "The decision was revised and needs confirmation.");
      audit(p, "decision_revised", `${d.title}; confirmation is required again.`);
      break;
    }
    case "supersede_decision": {
      const d = find(p.decisions, a.id, "Decision");
      if (d.status === "superseded") fail("This decision is already superseded.", 409);
      d.history.push({ version: d.version, at: now(), status: d.status });
      d.status = "superseded";
      d.version++;
      retireStaleReviews(p, d, "The decision was superseded.");
      audit(p, "decision_superseded", `${d.title}: ${str(a.reason, "Reason", 1000)}`);
      break;
    }
    case "add_checklist": {
      if (p.checklist.length >= 100) fail("This notebook has reached 100 checklist items.");
      p.checklist.push({
        id: id(),
        text: str(a.text, "Checklist item", 500),
        done: false,
        version: 1,
      });
      audit(p, "checklist_added", a.text);
      break;
    }
    case "toggle_checklist": {
      const item = find(p.checklist, a.id, "Checklist item");
      item.done = !item.done;
      item.version++;
      audit(p, "checklist_toggled", item.text);
      break;
    }
    case "import_sources": {
      if (!Array.isArray(a.sources) || !a.sources.length || a.sources.length > 20)
        fail("Import between 1 and 20 transcripts at a time.");
      let added = 0,
        duplicates = 0;
      for (const raw of a.sources) {
        const text = str(raw.text, "Transcript", 100000);
        const digest = hash(text.replace(/\s+/g, " ").trim());
        if (p.sources.some((s) => s.digest === digest)) {
          duplicates++;
          continue;
        }
        if (p.sources.length >= 200) fail("This notebook has reached 200 sources.");
        const date = str(raw.occurredAt, "Conversation date", 40);
        if (!Number.isFinite(Date.parse(date))) fail("Enter a valid conversation date.");
        const source = {
          id: id(),
          title: str(raw.title, "Source title", 160),
          text,
          occurredAt: new Date(date).toISOString(),
          importedAt: now(),
          origin: "manual_import",
          provenance: str(
            raw.provenance || "Manually supplied transcript; origin not independently verified.",
            "Provenance",
            1000,
          ),
          projectLabel: str(raw.projectLabel || "", "Project label", 100, 0),
          digest,
          externalId: str(raw.externalId || "", "External reference", 200, 0),
          beeVerified: false,
        };
        p.sources.push(source);
        scan(p, source);
        added++;
      }
      audit(
        p,
        "sources_imported",
        `${added} imported; ${duplicates} duplicate transcripts skipped. Manual origin; provider provenance is not verified.`,
      );
      break;
    }
    case "link_evidence": {
      const d = find(p.decisions, a.decisionId, "Decision");
      if (!["watching", "review_suggested"].includes(d.status))
        fail("Confirm an active decision before linking evidence.", 409);
      const s = find(p.sources, a.sourceId, "Source");
      const quote = str(a.quote, "Evidence quote", 2000);
      if (!s.text.includes(quote))
        fail("The quote must appear exactly in the selected transcript.");
      const key = evidenceKey(d, s, quote);
      if (hasEvidence(p, d, s, quote))
        fail("This exact evidence is already linked to this decision.", 409);
      if (p.candidates.length >= 1000)
        fail("This notebook has reached 1,000 evidence links. Export or create a new notebook.");
      p.candidates.push({
        id: id(),
        key,
        decisionId: d.id,
        decisionVersion: d.version,
        decisionSnapshot: decisionSnapshot(d),
        sourceId: s.id,
        quote,
        kind: "manual",
        reason: str(a.reason, "Why it matters", 1000),
        overlap: [],
        status: "pending",
        manual: true,
        createdAt: now(),
        reasonForDisposition: "",
        proposal: null,
      });
      audit(p, "evidence_linked", `Manual link for ${d.title}`);
      break;
    }
    case "disposition": {
      const c = find(p.candidates, a.id, "Review");
      const d = find(p.decisions, c.decisionId, "Decision");
      if (c.status !== "pending") fail("This review has already been dispositioned.", 409);
      if (d.version !== c.decisionVersion || !["watching", "review_suggested"].includes(d.status))
        fail(
          "The decision changed after this evidence was linked. Re-link relevant evidence against the current decision.",
          409,
        );
      const reason = str(a.reason, "Review reason", 1500);
      if (!["reopen", "dismiss", "clarify"].includes(a.action))
        fail("Choose reopen, dismiss or clarify.");
      if (a.action === "reopen" && a.confirmedChange !== true)
        fail("Confirm that you reviewed a changed premise before reopening.");
      if (
        a.action === "reopen" &&
        ["hypothetical", "unrelated", "context", "uncertain"].includes(c.kind)
      )
        fail(
          "This evidence is not an explicit changed-premise report. Obtain clarification or manually link a confirmed statement first.",
        );
      c.status =
        a.action === "reopen"
          ? "reopened"
          : a.action === "dismiss"
            ? "dismissed"
            : "clarification_requested";
      c.reasonForDisposition = reason;
      c.reviewedAt = now();
      if (a.action === "reopen") {
        d.status = "reopened";
        d.version++;
        c.reopenedDecisionVersion = d.version;
        retireStaleReviews(p, d, "Another evidence review reopened this decision.");
        if (d.anchorId) {
          const item = find(p.checklist, d.anchorId, "Checklist item");
          c.proposal = {
            id: id(),
            itemId: item.id,
            itemVersion: item.version,
            before: item.text,
            after: null,
            status: "needs_draft",
          };
        }
      } else if (
        !p.candidates.some(
          (x) =>
            x.decisionId === d.id &&
            x.decisionVersion === d.version &&
            x.status === "pending" &&
            x.kind === "reported_change",
        )
      )
        d.status = "watching";
      audit(p, `review_${a.action}`, `${d.title}: ${reason}`);
      break;
    }
    case "draft_checklist_change": {
      const c = find(p.candidates, a.id, "Review");
      const d = find(p.decisions, c.decisionId, "Decision");
      if (c.status !== "reopened" || !c.proposal || c.proposal.status === "approved")
        fail("Reopen a decision with a checklist anchor before drafting a change.", 409);
      if (d.version !== c.reopenedDecisionVersion)
        fail("The decision changed after reopening. Reassess the checklist proposal.", 409);
      const item = find(p.checklist, c.proposal.itemId, "Checklist item");
      if (item.version !== c.proposal.itemVersion)
        fail("The checklist changed. Reopen review against the current item.", 409);
      const after = str(a.after, "Replacement checklist text", 500);
      if (after === item.text) fail("The replacement must change the checklist text.");
      c.proposal.after = after;
      c.proposal.status = "pending_approval";
      audit(p, "checklist_change_drafted", `${item.text} → ${after}`);
      break;
    }
    case "approve_checklist_change": {
      const c = find(p.candidates, a.id, "Review");
      const d = find(p.decisions, c.decisionId, "Decision");
      const v = c.proposal;
      if (!v || v.status !== "pending_approval" || !v.after)
        fail("A concrete checklist change must be drafted before approval.", 409);
      if (d.version !== c.reopenedDecisionVersion)
        fail("The decision changed. Review a fresh proposal.", 409);
      const item = find(p.checklist, v.itemId, "Checklist item");
      if (item.version !== v.itemVersion || item.text !== v.before)
        fail("The checklist has changed since this proposal. It was not overwritten.", 409);
      item.text = v.after;
      item.done = false;
      item.version++;
      v.status = "approved";
      v.approvedAt = now();
      audit(p, "checklist_change_approved", `${v.before} → ${v.after}`);
      break;
    }
    default:
      fail("Unknown notebook action.");
  }
  if (JSON.stringify(p).length > 2000000)
    fail("This notebook has reached its 2 MB storage limit. Export and create a new notebook.");
  p.version++;
  p.updatedAt = now();
  return p;
}
/** Server-only ingestion: exposed HTTP commands cannot supply provider records. */
export function importBeeSources(original, sources, expectedVersion) {
  if (original.version !== expectedVersion)
    fail("The notebook changed. Refresh before importing.", 409);
  const p = structuredClone(original);
  const receipt = { added: 0, unchanged: 0, revised: 0 };
  for (const incoming of sources) {
    const origin = incoming.provider.transport === "test_fixture" ? "bee_fixture" : "bee_api";
    const previous = p.sources
      .filter(
        (s) =>
          s.origin === origin && s.provider?.conversationId === incoming.provider.conversationId,
      )
      .at(-1);
    if (previous?.digest === incoming.digest) {
      receipt.unchanged++;
      continue;
    }
    if (p.sources.length >= 200) fail("This notebook has reached 200 sources.");
    const source = {
      ...incoming,
      id: id(),
      importedAt: now(),
      origin,
      provenance:
        origin === "bee_fixture"
          ? "Explicit connector test fixture. Not recorded by Bee and not hackathon device evidence."
          : "Retrieved through the official Bee CLI proxy. Processed ASR can contain errors; compare Bee context before confirming a decision. Device type is provider-reported, not independently verified.",
      externalId: `bee conversations get ${incoming.provider.conversationId}`,
      projectLabel: "",
      beeVerified: false,
      supersedesSourceId: previous?.id || null,
      sourceRevision: (previous?.sourceRevision || 0) + 1,
    };
    p.sources.push(source);
    // A same-conversation correction is a source revision, not a later event.
    // The normal chronology guard keeps earlier/same-time context out of alerts.
    scan(p, source);
    previous ? receipt.revised++ : receipt.added++;
  }
  audit(
    p,
    "bee_import_checked",
    `${receipt.added} new; ${receipt.revised} revised; ${receipt.unchanged} unchanged. ${sources[0]?.provider.transport === "test_fixture" ? "Explicit test fixture transport." : "Selected processed conversations retrieved through Bee CLI proxy."}`,
  );
  p.version++;
  p.updatedAt = now();
  if (Buffer.byteLength(JSON.stringify(p)) > 2000000)
    fail("This notebook exceeds 2 MB. Export it and start another.");
  return { project: p, receipt };
}
export function illustrativeProject() {
  let p = newProject(
    "The demo room",
    "An illustrative example. Every statement below is fictional.",
  );
  const run = (type, payload) =>
    (p = applyCommand(p, { type, payload, expectedVersion: p.version }));
  run("add_checklist", {
    text: "Run the online-only product walkthrough at the venue",
  });
  run("import_sources", {
    sources: [
      {
        title: "Monday · Planning conversation",
        text: "We can skip offline support because the venue has reliable internet. We will run the online-only product walkthrough.",
        occurredAt: "2026-09-07T09:00:00Z",
        provenance:
          "Illustrative fixture authored for product explanation. Not a real conversation and not Bee data.",
      },
    ],
  });
  run("add_decision", {
    title: "Keep the demo online-only",
    rationale:
      "Spend our remaining build time polishing the main flow. We expect a reliable connection in the room.",
    assumptions: ["The venue has reliable internet"],
    reviewCondition: "Revisit if the room internet becomes unavailable.",
    sourceId: p.sources[0].id,
    quote: "We can skip offline support because the venue has reliable internet.",
    anchorId: p.checklist[0].id,
  });
  run("confirm_decision", { id: p.decisions[0].id });
  run("import_sources", {
    sources: [
      {
        title: "Tuesday · Room check",
        text: "What would we do if the room had no Wi-Fi?\nThe organizer confirmed our demo room will have no Wi-Fi.",
        occurredAt: "2026-09-08T10:30:00Z",
        provenance:
          "Illustrative fixture authored for product explanation. Not a real conversation and not Bee data.",
      },
    ],
  });
  return p;
}
