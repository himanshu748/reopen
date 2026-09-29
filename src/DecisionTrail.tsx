import { sourceOrigin } from "./types";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { buildDecisionTrail } from "./decision-trail.mjs";
import type { Candidate, Decision, Project } from "./types";
const name = (text: string) => text.replaceAll("_", " ");
const when = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const fieldNames: Record<string, string> = {
  title: "Decision",
  rationale: "Reasoning",
  assumptions: "Assumptions",
  reviewCondition: "Review condition",
  sourceId: "Original source",
  quote: "Original quote",
};
const kindNames: Record<string, string> = {
  reported_change: "Reported change",
  hypothetical: "Question / hypothetical",
  uncertain: "Uncertain report",
  correction: "Correction",
  context: "Related context",
  unrelated: "Different project",
  manual: "Manual evidence link",
};
function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={back ? "M20 12H4m6-6-6 6 6 6" : "M4 12h16m-6-6 6 6-6 6"} />
    </svg>
  );
}
export default function DecisionTrail({
  project,
  decision,
  initialVersion,
  onClose,
  onOpenEvidence,
}: {
  project: Project;
  decision: Decision;
  initialVersion?: number;
  onClose: () => void;
  onOpenEvidence: (id: string) => void;
}) {
  const nodes = useMemo(
    () => buildDecisionTrail(decision, project.candidates),
    [decision, project.candidates],
  );
  const [selected, setSelected] = useState(initialVersion ?? decision.version),
    [comparison, setComparison] = useState(false);
  const node = nodes.find((n) => n.version === selected) || nodes.at(-1)!;
  const index = nodes.indexOf(node);
  const uid = useId();
  const panel = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const previousSelection = useRef(node.version);
  const activeAnimation = useRef<Animation | null>(null);
  useEffect(() => {
    if (previousSelection.current === node.version) return;
    previousSelection.current = node.version;
    activeAnimation.current?.cancel();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches && panel.current?.animate) {
      activeAnimation.current = panel.current.animate(
        [
          { opacity: 0.65, clipPath: "inset(0 0 1% 0)" },
          { opacity: 1, clipPath: "inset(0)" },
        ],
        { duration: 180, easing: "cubic-bezier(.16,1,.3,1)" },
      );
    }
    return () => activeAnimation.current?.cancel();
  }, [node.version]);
  useEffect(() => {
    rail.current
      ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?.focus({ preventScroll: true });
  }, []);
  function choose(version: number, focus = false) {
    setSelected(version);
    setComparison(false);
    const button = rail.current?.querySelector<HTMLButtonElement>(`[data-version="${version}"]`);
    if (focus) button?.focus({ preventScroll: true });
    if (button && rail.current) {
      const left = button.offsetLeft;
      const target = Math.max(0, left - (rail.current.clientWidth - button.clientWidth) / 2);
      rail.current.scrollTo({ left: target, behavior: "instant" });
    }
  }
  function keys(event: KeyboardEvent, index: number) {
    const target =
      event.key === "ArrowRight"
        ? Math.min(nodes.length - 1, index + 1)
        : event.key === "ArrowLeft"
          ? Math.max(0, index - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? nodes.length - 1
              : -1;
    if (target < 0) return;
    event.preventDefault();
    choose(nodes[target].version, true);
  }
  const source = project.sources.find((s) => s.id === node.content.sourceId);
  function value(field: string, value: string | string[]) {
    if (Array.isArray(value))
      return (
        <ul>
          {value.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      );
    if (field === "sourceId")
      return (
        <p>
          {project.sources.find((s) => s.id === value)?.title ||
            (value ? "Source unavailable" : "Written directly in this notebook")}
        </p>
      );
    return <p>{value || "Not supplied"}</p>;
  }
  return (
    <section className="decision-trail" aria-label="Decision history">
      <button className="back-link" onClick={onClose}>
        <Arrow back />
        Back to decision journal
      </button>
      <header className="trail-heading">
        <div>
          <h1>Follow the reasoning.</h1>
          <p>Every saved version, the evidence it met, and the changes you approved.</p>
        </div>
        <span className="trail-record-count">
          {nodes.length} recorded {nodes.length === 1 ? "version" : "versions"}
        </span>
      </header>
      <div className="trail-navigation">
        <div
          className="version-rail"
          role="tablist"
          aria-label="Saved decision versions"
          ref={rail}
        >
          {nodes.map((n, i) => (
            <button
              key={n.version}
              type="button"
              role="tab"
              id={`${uid}-v${n.version}`}
              aria-controls={`${uid}-panel`}
              aria-selected={n.version === node.version}
              tabIndex={n.version === node.version ? 0 : -1}
              data-version={n.version}
              onClick={() => choose(n.version)}
              onKeyDown={(e) => keys(e, i)}
              className={"version-tab " + (n.version === node.version ? "selected" : "")}
            >
              <span className="version-point" />
              <strong>Version {n.version}</strong>
              <span>
                {n.current
                  ? "Current"
                  : n.recordType === "evidence"
                    ? "Evidence snapshot"
                    : n.status
                      ? name(n.status)
                      : "Archived"}
              </span>
            </button>
          ))}
        </div>
        <div className="version-stepper">
          <button
            className="icon-button"
            aria-label="Previous recorded version"
            disabled={index === 0}
            onClick={() => choose(nodes[index - 1].version)}
          >
            <Arrow back />
          </button>
          <button
            className="icon-button"
            aria-label="Next recorded version"
            disabled={index === nodes.length - 1}
            onClick={() => choose(nodes[index + 1].version)}
          >
            <Arrow />
          </button>
        </div>
      </div>
      <p className="trail-hint">
        Use Left and Right arrow keys to move between saved versions. Only recorded versions are
        shown.
      </p>
      <div className="sr-only" role="status" aria-live="polite">
        Viewing version {node.version}
        {node.current ? ", current decision" : ""}.
      </div>
      <div
        className="trail-reader"
        role="tabpanel"
        tabIndex={0}
        id={`${uid}-panel`}
        aria-labelledby={`${uid}-v${node.version}`}
        ref={panel}
      >
        <div className="trail-version-header">
          <span className={"badge " + (node.current ? "watching" : "context")}>
            {node.current ? "Current decision" : "Saved history"} · v{node.version}
          </span>
          {node.recordedAt && (
            <time>
              {node.recordType === "archive" ? "Archived" : "Recorded"} {when(node.recordedAt)}
            </time>
          )}
          {!node.current && (
            <button className="text-button" onClick={() => choose(decision.version)}>
              Return to current
              <Arrow />
            </button>
          )}
        </div>
        <div className="trail-columns">
          <article className="trail-reasoning">
            <h2>{node.content.title || "Wording not recorded for this version"}</h2>
            {node.content.rationale ? (
              <p className="trail-rationale">{node.content.rationale}</p>
            ) : (
              <p className="notice-box">
                Only the status was saved for this version. Reopen will not fill it with today’s
                reasoning.
              </p>
            )}
            {node.content.assumptions && (
              <section className="trail-assumptions">
                <h3>What this version assumed</h3>
                <ul>
                  {node.content.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </section>
            )}
            {node.content.reviewCondition && (
              <section className="trail-condition">
                <h3>The condition for another look</h3>
                <p>{node.content.reviewCondition}</p>
              </section>
            )}
            {source && (
              <details className="trail-source">
                <summary>
                  <span>Original source</span>
                  <strong>{source.title}</strong>
                </summary>
                {node.content.quote && <blockquote>“{node.content.quote}”</blockquote>}
                <p>
                  {when(source.occurredAt)} · {sourceOrigin(source)}
                </p>
                <p>{source.provenance}</p>
              </details>
            )}
            {index > 0 && (
              <section className="trail-difference">
                <button
                  className="difference-toggle"
                  aria-expanded={comparison}
                  aria-controls={`${uid}-changes`}
                  onClick={() => setComparison(!comparison)}
                >
                  <span>
                    <strong>What changed since v{node.previousVersion}?</strong>
                    <small>
                      {node.changes.length
                        ? `${node.changes.length} ${node.changes.length === 1 ? "field differs" : "fields differ"} in the saved wording`
                        : "No differences in the fields available for comparison"}
                    </small>
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d={comparison ? "m6 14 6-6 6 6" : "m6 10 6 6 6-6"} />
                  </svg>
                </button>
                <div id={`${uid}-changes`} hidden={!comparison}>
                  {node.changes.map((change) => (
                    <div className="field-difference" key={change.field}>
                      <h4>{fieldNames[change.field]}</h4>
                      <div>
                        <section>
                          <span>Version {node.previousVersion}</span>
                          {value(change.field, change.before)}
                        </section>
                        <section>
                          <span>Version {node.version}</span>
                          {value(change.field, change.after)}
                        </section>
                      </div>
                    </div>
                  ))}
                  {!node.changes.length && (
                    <p className="difference-empty">
                      Some versions record a status change without a wording change. Missing
                      historical fields are not inferred.
                    </p>
                  )}
                </div>
              </section>
            )}
          </article>
          <aside className="trail-evidence">
            <h2>The review trail</h2>
            <p className="trail-evidence-intro">
              Sources and outcomes linked to this recorded version.
            </p>
            {node.reviews.length === 0 && node.outcomes.length === 0 ? (
              <div className="trail-no-evidence">
                <span className="rule-mark" />
                <p>No evidence links were saved against this version.</p>
                <p>You can select an earlier version to follow its original reviews.</p>
              </div>
            ) : (
              <>
                {node.reviews.map((c) => (
                  <ReviewTrace
                    key={c.id}
                    candidate={c}
                    project={project}
                    onOpen={() => onOpenEvidence(c.id)}
                  />
                ))}
                {node.outcomes
                  .filter((c) => !node.reviews.some((r) => r.id === c.id))
                  .map((c) => (
                    <ReviewTrace
                      key={"outcome-" + c.id}
                      candidate={c}
                      project={project}
                      onOpen={() => onOpenEvidence(c.id)}
                      outcome
                    />
                  ))}
              </>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
function ReviewTrace({
  candidate: c,
  project,
  onOpen,
  outcome = false,
}: {
  candidate: Candidate;
  project: Project;
  onOpen: () => void;
  outcome?: boolean;
}) {
  const source = project.sources.find((s) => s.id === c.sourceId);
  return (
    <article className="trace-entry">
      <div className="trace-entry-top">
        <span className={"badge " + c.kind}>
          {outcome ? "Reopened from v" + c.decisionVersion : kindNames[c.kind] || name(c.kind)}
        </span>
        <span>{name(c.status)}</span>
      </div>
      <blockquote>“{c.quote}”</blockquote>
      <p className="trace-source">
        {source?.title || "Source unavailable"}
        {source ? " · " + when(source.occurredAt) : ""}
      </p>
      {(c.reasonForDisposition || c.retirementReason) && (
        <div className="trace-judgment">
          <strong>{c.reasonForDisposition ? "Your judgment" : "Review retired"}</strong>
          <p>{c.reasonForDisposition || c.retirementReason}</p>
          {c.reviewedAt && <time>{when(c.reviewedAt)}</time>}
        </div>
      )}
      {c.proposal && (
        <div className={"trace-checklist " + (c.proposal.status === "approved" ? "approved" : "")}>
          <strong>
            {c.proposal.status === "approved"
              ? "Checklist change approved"
              : "Checklist change " + name(c.proposal.status)}
          </strong>
          <div>
            <span>Before</span>
            <p>{c.proposal.before}</p>
            <span>After</span>
            <p>{c.proposal.after || "No replacement drafted"}</p>
          </div>
          {c.proposal.approvedAt && <time>{when(c.proposal.approvedAt)}</time>}
        </div>
      )}
      <button className="text-button" onClick={onOpen}>
        Open paired evidence
        <Arrow />
      </button>
    </article>
  );
}
