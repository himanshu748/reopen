import {
  useEffect,
  useRef,
  useState,
  useId,
  cloneElement,
  type ReactElement,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Candidate, Decision, Project, Summary, User } from "./types";
import DecisionTrail from "./DecisionTrail";
import BeeConnection from "./BeeConnection";
import AssistantConnection from "./AssistantConnection";
import { sourceOrigin } from "./types";
type Tab = "Decisions" | "Evidence" | "Checklist" | "Sources" | "Assistant" | "Activity";
type Panel = { type: string; decision?: Decision };
const kinds: Record<string, string> = {
  reported_change: "Reported change",
  hypothetical: "Question / hypothetical",
  uncertain: "Needs clarification",
  correction: "Correction",
  unrelated: "Different project",
  context: "Related context",
  manual: "Manually linked",
};
const date = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const labels = (text: string) => text.replaceAll("_", " ");
function consumeReviewLink() {
  const url = new URL(window.location.href);
  url.searchParams.delete("project");
  url.searchParams.delete("review");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}
const projectSummary = (p: Project): Summary => ({
  id: p.id,
  title: p.title,
  description: p.description,
  version: p.version,
  updatedAt: p.updatedAt,
  decisions: p.decisions.length,
  reviews: p.candidates.filter(
    (c) => c.status === "pending" && ["reported_change", "correction", "manual"].includes(c.kind),
  ).length,
});
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    book: (
      <>
        <path d="M4 3h14a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V3Z" />
        <path d="M4 17h16M8 3v14" />
      </>
    ),
    evidence: (
      <>
        <path d="M7 3h10v18H7zM3 7h4m10 0h4M3 17h4m10 0h4M10 8h4m-4 4h4m-4 4h2" />
      </>
    ),
    check: (
      <>
        <path d="M9 5h11M9 12h11M9 19h11m-16-14 1 1 2-3m-3 9 1 1 2-3m-3 9 1 1 2-3" />
      </>
    ),
    source: (
      <>
        <path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6" />
      </>
    ),
    activity: (
      <>
        <path d="M4 5h16M4 12h16M4 19h16M8 3v4m7 3v4m-5 3v4" />
      </>
    ),
    assistant: <><path d="M5 7h14v10H5zM9 17v3m6-3v3M9 11h.01M15 11h.01M9 14h6" /><path d="M9 4h6m-3 0V2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    out: (
      <>
        <path d="M9 4H4v16h5m4-12 4 4-4 4m-5-4h13" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 3v4" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" />
      </>
    ),
    chevron: <path d="m8 10 4 4 4-4" />,
    download: (
      <>
        <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    back: <path d="M20 12H4m6-6-6 6 6 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.book}
    </svg>
  );
}
function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M7 26V6h10c11 0 11 14 0 14H7m10 0 9 6" stroke="currentColor" strokeWidth="2.5" />
      </svg>
    </span>
  );
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const fieldId = useId();
  return (
    <label className="field" htmlFor={fieldId}>
      <span id={fieldId + "-label"}>{label}</span>
      {cloneElement(children as ReactElement<any>, {
        id: fieldId,
        "aria-labelledby": fieldId + "-label",
        "aria-describedby": hint ? fieldId + "-hint" : undefined,
      })}
      {hint && <small id={fieldId + "-hint"}>{hint}</small>}
    </label>
  );
}
function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-rule" />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
function App() {
  const [user, setUser] = useState<User | null>(null),
    [csrf, setCsrf] = useState(""),
    [loading, setLoading] = useState(true),
    [projects, setProjects] = useState<Summary[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [tab, setTab] = useState<Tab>("Decisions"),
    [panel, setPanel] = useState<Panel | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState(""),
    [mobile, setMobile] = useState(false),
    [filter, setFilter] = useState("all"),
    [trail, setTrail] = useState<{ id: string; version?: number } | null>(null);
  const [sourceChecks, setSourceChecks] = useState<Record<string, boolean>>({});
  const [failedLoad, setFailedLoad] = useState("");
  const [notebookLoading, setNotebookLoading] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const notebookHeading = useRef<HTMLHeadingElement>(null);
  const viewEpoch = useRef(0);
  const interactionEpoch = useRef(0);
  const operationEpoch = useRef(0);
  const activeView = useRef("");
  const viewKey = `${user?.id || ""}:${csrf}:${project?.id || ""}`;
  activeView.current = viewKey;
  const renderedEpoch = viewEpoch.current;
  const isCurrentView = () => activeView.current === viewKey && viewEpoch.current === renderedEpoch;

  async function api(path: string, method = "GET", body?: unknown) {
    const res = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await res.json();
    if (!res.ok) throw new Error(value.error || "The request could not be completed.");
    return value;
  }
  async function loadProject(id: string) {
    const epoch = ++viewEpoch.current;
    setError("");
    setNotice("");
    setFailedLoad("");
    setNotebookLoading(true);
    try {
      const result = await api("/projects/" + id);
      if (epoch !== viewEpoch.current) return false;
      setProject(result.project);
      setFailedLoad("");
      localStorage.setItem("reopen:last-notebook", id);
      const link = new URLSearchParams(window.location.search);
      const linkedReview = link.get("review");
      if (link.get("project") === id && linkedReview &&
        result.project.candidates.some((candidate: Candidate) => candidate.id === linkedReview)) {
        setTab("Evidence");
        setSelected(linkedReview);
        consumeReviewLink();
      }
      return true;
    } catch (e) {
      if (epoch === viewEpoch.current) {
        setFailedLoad(id);
        setError((e as Error).message);
      }
      return false;
    } finally {
      if (epoch === viewEpoch.current) setNotebookLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    fetch("/api/session")
      .then((r) => r.json())
      .then(async (s) => {
        if (!active) return;
        setUser(s.user);
        setCsrf(s.csrf || "");
        if (s.user) {
          const r = await fetch("/api/projects").then((r) => r.json());
          if (!active) return;
          setProjects(r.projects);
          const last = localStorage.getItem("reopen:last-notebook");
          const link = new URLSearchParams(window.location.search);
          const linkedProject = link.get("project");
          const linkedReview = link.get("review");
          const id = r.projects.find((p: Summary) => p.id === linkedProject)?.id ||
            r.projects.find((p: Summary) => p.id === last)?.id || r.projects[0]?.id;
          if (id) {
            const p = await fetch("/api/projects/" + id).then((r) => r.json());
            if (active) {
              setProject(p.project);
              if (id === linkedProject && p.project?.candidates.some((c: Candidate) => c.id === linkedReview)) {
                setTab("Evidence");
                setSelected(linkedReview || "");
                consumeReviewLink();
              }
            }
          }
        }
      })
      .catch(() => setError("Reopen could not reach the server. Check the connection and reload."))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (panel) formRef.current?.querySelector<HTMLInputElement>("input,textarea,select")?.focus();
  }, [panel]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5500);
    return () => clearTimeout(t);
  }, [notice]);
  async function perform(action: () => Promise<void | boolean>, message: string, close = false) {
    const interaction = interactionEpoch.current;
    const operation = ++operationEpoch.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if ((await action()) === false || interaction !== interactionEpoch.current ||
        operation !== operationEpoch.current) return;
      setNotice(message);
      if (close) setPanel(null);
    } catch (e) {
      if (interaction === interactionEpoch.current && operation === operationEpoch.current) {
        setFailedLoad("");
        setError((e as Error).message);
      }
    } finally {
      if (operation === operationEpoch.current) setBusy(false);
    }
  }
  async function command(type: string, payload: unknown) {
    if (!project) return;
    try {
      const result = await api("/projects/" + project.id + "/commands", "POST", {
        type,
        payload,
        expectedVersion: project.version,
      });
      // A save may finish after the owner switches notebooks or opens another view.
      // Keep its server result, but never restore its old notebook or close a new editor.
      if (!isCurrentView()) return false;
      const saved: Project = result.project;
      setProject((current) =>
        current?.id === saved.id && current.version <= saved.version ? saved : current,
      );
      setProjects((current) => current.map((summary) =>
        summary.id === saved.id && summary.version <= saved.version ? projectSummary(saved) : summary,
      ));
    } catch (error) {
      if (!isCurrentView()) return false;
      throw error;
    }
  }
  async function createProject(data: any) {
    try {
      const r = await api("/projects", "POST", data);
      if (!isCurrentView()) return false;
      setProject(r.project);
      setFailedLoad("");
      localStorage.setItem("reopen:last-notebook", r.project.id);
      setProjects((current) => [...current, projectSummary(r.project)]);
      setTab("Decisions");
    } catch (error) {
      if (!isCurrentView()) return false;
      throw error;
    }
  }
  const openPanel = (type: string, decision?: Decision) => {
    interactionEpoch.current++;
    setPanel({ type, decision });
    setTrail(null);
    setError("");
    setFailedLoad("");
    setMobile(false);
  };
  const navigate = (t: Tab) => {
    interactionEpoch.current++;
    setTrail(null);
    setTab(t);
    setPanel(null);
    setError("");
    setFailedLoad("");
    setMobile(false);
  };
  const candidate = project?.candidates.find((c) => c.id === selected);
  const trailDecision = project?.decisions.find((d) => d.id === trail?.id);
  function openTrail(id: string, version?: number) {
    setTab("Decisions");
    setTrail({ id, version });
    setPanel(null);
    setMobile(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const pending =
    project?.candidates.filter(
      (c) => c.status === "pending" && ["reported_change", "correction", "manual"].includes(c.kind),
    ).length || 0;
  if (loading)
    return (
      <div className="loading-screen">
        <Mark />
        <p>Opening your notebook…</p>
      </div>
    );
  if (!user)
    return (
      <Auth
        error={error}
        busy={busy}
        submit={(data, mode) =>
          perform(async () => {
            viewEpoch.current++;
            setFailedLoad("");
            setNotebookLoading(false);
            const s = await api("/" + mode, "POST", data);
            setUser(s.user);
            setCsrf(s.csrf);
            const r = await api("/projects");
            setProjects(r.projects);
            const link = new URLSearchParams(window.location.search);
            const linkedProject = link.get("project");
            const target = r.projects.find((p: Summary) => p.id === linkedProject) || r.projects[0];
            if (target) return loadProject(target.id);
          }, "Your private notebook is ready.")
        }
      />
    );
  return (
    <div className="app-shell">
      <a className="skip" href="#workspace">
        Skip to notebook
      </a>
      <header className="mobile-header">
        <a className="wordmark" href="/" aria-label="Reopen home">
          <Mark />
          Reopen
        </a>
        <button
          className="icon-button"
          onClick={() => setMobile(!mobile)}
          aria-label="Toggle navigation"
          aria-expanded={mobile}
        >
          <Icon name={mobile ? "close" : "menu"} />
        </button>
      </header>
      <aside className={"sidebar " + (mobile ? "is-open" : "")}>
        <a className="wordmark" href="/" aria-label="Reopen home">
          <Mark />
          Reopen
        </a>
        <div className="notebook-picker">
          <label htmlFor="notebook-select">Your notebooks</label>
          <select
            id="notebook-select"
            value={project?.id || ""}
            onChange={(e) => {
              interactionEpoch.current++;
              loadProject(e.target.value);
              setSelected("");
              setPanel(null);
            }}
            aria-label="Choose notebook"
          >
            <option value="" disabled>
              Choose a notebook
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <button className="text-button" disabled={busy && !project} onClick={() => openPanel("project")}>
            <Icon name="plus" size={15} />
            New notebook
          </button>
        </div>
        <nav aria-label="Notebook sections">
          {(["Decisions", "Evidence", "Checklist", "Sources", "Assistant", "Activity"] as Tab[]).map((t, i) => (
            <button
              key={t}
              className={tab === t ? "nav-link active" : "nav-link"}
              onClick={() => navigate(t)}
              aria-current={tab === t ? "page" : undefined}
            >
              <Icon name={["book", "evidence", "check", "source", "assistant", "activity"][i]} />
              <span>{t}</span>
              {t === "Evidence" && pending > 0 && <span className="count">{pending}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="small-label">
            <span className="status-dot" />
            Private notebook
          </span>
          <p>Keep the reasoning here. Connect a compatible assistant when you want help reviewing it.</p>
        </div>
        <div className="account">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.name}</strong>
            <button className="text-button" onClick={() => openPanel("account")}>
              Private account
            </button>
          </div>
          <button
            className="icon-button"
            title="Sign out"
            aria-label="Sign out"
            disabled={busy}
            onClick={() =>
              perform(async () => {
                viewEpoch.current++;
                setNotebookLoading(false);
                await api("/logout", "POST", {});
                setUser(null);
                setProject(null);
                setFailedLoad("");
                setNotebookLoading(false);
                setProjects([]);
                setCsrf("");
              }, "Signed out.")
            }
          >
            <Icon name="out" size={18} />
          </button>
        </div>
      </aside>
      <main className="workspace" id="workspace">
        <div className="topline">
          <span>
            <Icon name="lock" size={14} />
            Only you can read this notebook
          </span>
          <div>
            {project && (
              <>
                <span className="save-state">Saved · v{project.version}</span>
                <button
                  className="icon-button"
                  disabled={busy}
                  title="Refresh notebook"
                  aria-label="Refresh notebook"
                  onClick={() => perform(() => loadProject(project.id), "Notebook refreshed.")}
                >
                  <Icon name="refresh" size={17} />
                </button>
                <a
                  className="icon-button"
                  title="Export notebook"
                  aria-label="Export notebook"
                  href={"/api/projects/" + project.id + "/export"}
                  download
                >
                  <Icon name="download" size={17} />
                </a>
              </>
            )}
          </div>
        </div>
        {error && (
          <div role="alert" className="alert">
            <strong>We couldn’t complete that request.</strong>
            <span>{error}</span>
            <button
              className="text-button"
              onClick={() => {
                setError("");
                const id = failedLoad || project?.id;
                if (id && id !== project?.id) {
                  interactionEpoch.current++;
                  setPanel(null);
                  setSelected("");
                  setTrail(null);
                }
                if (id) void perform(() => loadProject(id), "Notebook refreshed.");
              }}
            >
              Refresh latest
            </button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <Icon name="check" size={18} />
            {notice}
          </div>
        )}
        {panel ? (
          <div className="editor" ref={formRef}>
            <button className="back-link" onClick={() => setPanel(null)} disabled={busy}>
              <Icon name="back" size={17} />
              Back to {tab.toLowerCase()}
            </button>
            <Editor
              key={panel.type + (panel.decision?.id || "")}
              panel={panel}
              project={project}
              busy={busy}
              user={user}
              submit={async (data) => {
                const type = panel.type;
                if (type === "project")
                  return perform(() => createProject(data), "Notebook created.", true);
                if (type === "example")
                  return perform(
                    () => createProject({ illustrative: true }),
                    "Illustrative notebook created. All transcripts are fictional.",
                    true,
                  );
                if (type === "delete")
                  return perform(
                    async () => {
                      await api("/projects/" + project?.id, "DELETE", {
                        expectedVersion: project?.version,
                      });
                      if (!isCurrentView()) return false;
                      setProject(null);
                      setFailedLoad("");
                      setProjects((current) => current.filter((p) => p.id !== project?.id));
                    },
                    "Notebook deleted.",
                    true,
                  );
                if (type === "account")
                  return perform(
                    async () => {
                      viewEpoch.current++;
                      setNotebookLoading(false);
                      await api("/account", "DELETE", data);
                      setUser(null);
                      setProject(null);
                      setProjects([]);
                      setFailedLoad("");
                      setNotebookLoading(false);
                    },
                    "Account and notebooks deleted.",
                    true,
                  );
                const commands: Record<string, string> = {
                  decision: panel.decision ? "revise_decision" : "add_decision",
                  checklist: "add_checklist",
                  import: "import_sources",
                  manual: "link_evidence",
                  supersede: "supersede_decision",
                };
                await perform(
                  () => command(commands[type], data),
                  type === "import"
                    ? "Import processed. The activity log records duplicate handling."
                    : "Saved to your notebook.",
                  true,
                );
              }}
            />
          </div>
        ) : project && trailDecision ? (
          <DecisionTrail
            key={trailDecision.id + "-" + trail?.version}
            project={project}
            decision={trailDecision}
            initialVersion={trail?.version}
            onClose={() => navigate("Decisions")}
            onOpenEvidence={(id) => {
              navigate("Evidence");
              setFilter("all");
              setSelected(id);
              window.scrollTo({ top: 0, behavior: "instant" });
            }}
          />
        ) : !project && projects.length > 0 ? (
          <Empty title={notebookLoading ? "Opening your notebook…" : "Your notebook hasn’t opened yet."}>
            {notebookLoading
              ? "Your saved notebooks are being loaded."
              : error && failedLoad
                ? "Choose a notebook from the list or retry the failed request with Refresh latest."
                : "Choose a notebook from the list to open your saved work."}
          </Empty>
        ) : !project ? (
          <div className="welcome">
            <div className="welcome-copy">
              <p className="date-line">A place for the reasons behind your work.</p>
              <h1>
                Good decisions
                <br />
                deserve a memory.
              </h1>
              <p>Keep what you decided, why it made sense, and what would make you reconsider.</p>
              <div className="actions">
                <button className="primary" disabled={busy} onClick={() => openPanel("project")}>
                  Create your first notebook
                  <Icon name="arrow" />
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    perform(
                      () => createProject({ illustrative: true }),
                      "Illustrative notebook created. All transcripts are fictional.",
                    )
                  }
                >
                  Explore an illustrative example
                </button>
              </div>
            </div>
            <div className="welcome-detail">
              <span className="folio">A decision has a before and an after.</span>
              <h3>The reason you chose it.</h3>
              <p>A confirmed decision, its assumptions, and a clear review condition.</p>
              <div className="join-line" />
              <h3>The evidence that changes it.</h3>
              <p>The original words beside the new statement. You decide what follows.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <p className="date-line">
                  {date(project.updatedAt)} <span className="divider">/</span>{" "}
                  {tab === "Decisions" ? "Decision journal" : tab}
                </p>
                <h1 ref={notebookHeading} tabIndex={-1}>
                  {tab === "Decisions"
                    ? project.title
                    : tab === "Evidence"
                      ? "What changed?"
                      : tab === "Checklist"
                        ? "The work that follows."
                        : tab === "Sources"
                          ? "Keep the original words."
                          : tab === "Assistant"
                            ? "A second look, on your terms."
                          : "A record of your judgment."}
                </h1>
                <p>
                  {tab === "Decisions"
                    ? project.description ||
                      "Your reasons, assumptions, and the conditions worth revisiting."
                    : tab === "Evidence"
                      ? "Read the original rationale beside later evidence. Decide what deserves another look."
                      : tab === "Checklist"
                        ? "Checklist changes are proposed first. Nothing is replaced without your approval."
                        : tab === "Sources"
                          ? "Keep each source’s origin and processed context. Check the words before you act on them."
                          : tab === "Assistant"
                            ? "Give an MCP client scoped access to this notebook, then keep each decision in your hands."
                          : "Every decision, review, and approved change keeps a place in the notebook."}
                </p>
              </div>
              {tab !== "Assistant" && <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  openPanel(
                    tab === "Decisions"
                      ? "decision"
                      : tab === "Checklist"
                        ? "checklist"
                        : tab === "Evidence"
                          ? "manual"
                          : "import",
                  )
                }
              >
                <Icon name="plus" size={18} />
                {tab === "Decisions"
                  ? "Record a decision"
                  : tab === "Checklist"
                    ? "Add checklist item"
                    : tab === "Evidence"
                      ? "Link evidence"
                      : "Import transcript"}
              </button>}
            </div>
            {tab === "Decisions" && (
              <div className="journal-grid">
                <section className="decision-list" aria-label="Decisions">
                  {project.decisions.length === 0 ? (
                    <Empty
                      title="Start with one decision."
                      action={
                        <button className="text-button" onClick={() => openPanel("decision")}>
                          Record your reasoning <Icon name="arrow" size={17} />
                        </button>
                      }
                    >
                      Write what you chose and the assumptions holding it up. Confirm it when the
                      wording is right.
                    </Empty>
                  ) : (
                    project.decisions.map((d, i) => (
                      <article className="decision" key={d.id}>
                        <div className="entry-meta">
                          <span className="entry-index">
                            Decision {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className={"badge " + d.status}>{labels(d.status)}</span>
                          <span>v{d.version}</span>
                        </div>
                        <h2>{d.title}</h2>
                        <p className="rationale">{d.rationale}</p>
                        <div className="decision-notes">
                          <div>
                            <h3>What we’re assuming</h3>
                            <ul>
                              {d.assumptions.map((a, j) => (
                                <li key={j}>{a}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <h3>Revisit when</h3>
                            <p>{d.reviewCondition}</p>
                          </div>
                        </div>
                        {d.quote && (
                          <blockquote>
                            <p>“{d.quote}”</p>
                            <cite>
                              {project.sources.find((s) => s.id === d.sourceId)?.title} ·{" "}
                              {project.sources.find((s) => s.id === d.sourceId)?.provider
                                ? "Bee transcript"
                                : "Manual source"}
                            </cite>
                          </blockquote>
                        )}
                        {d.anchorId && (
                          <div className="anchor">
                            <Icon name="check" size={16} />
                            {project.checklist.find((x) => x.id === d.anchorId)?.text}
                          </div>
                        )}
                        {project.sources.find((s) => s.id === d.sourceId)?.provider && (
                          <section className="bee-source-context">
                            <h4>Read the processed context</h4>
                            <p>
                              {project.sources.find((s) => s.id === d.sourceId)?.provider?.summary}
                            </p>
                            {d.status === "draft" && (
                              <label className="source-confirmation">
                                <input
                                  type="checkbox"
                                  checked={sourceChecks[d.id + d.version] || false}
                                  onChange={(e) =>
                                    setSourceChecks({
                                      ...sourceChecks,
                                      [d.id + d.version]: e.target.checked,
                                    })
                                  }
                                />
                                <span>
                                  I checked the transcript and surrounding context for recognition
                                  errors. This wording reflects the decision I intend to confirm.
                                </span>
                              </label>
                            )}
                          </section>
                        )}
                        <div className="decision-actions">
                          {d.status === "draft" ? (
                            <button
                              className="primary compact"
                              disabled={
                                busy ||
                                (Boolean(
                                  project.sources.find((s) => s.id === d.sourceId)?.provider,
                                ) &&
                                  !sourceChecks[d.id + d.version])
                              }
                              onClick={() =>
                                perform(
                                  () =>
                                    command("confirm_decision", {
                                      id: d.id,
                                      sourceChecked: sourceChecks[d.id + d.version] === true,
                                    }),
                                  "Decision confirmed. Later evidence can now be reviewed.",
                                )
                              }
                            >
                              Confirm this decision
                            </button>
                          ) : (
                            <button
                              className="text-button"
                              onClick={() => {
                                navigate("Evidence");
                                setSelected(
                                  project.candidates.find((c) => c.decisionId === d.id)?.id || "",
                                );
                              }}
                            >
                              View evidence <Icon name="arrow" size={16} />
                            </button>
                          )}
                          <button className="text-button" onClick={() => openPanel("decision", d)}>
                            Revise
                          </button>
                          {d.status !== "superseded" && (
                            <button
                              className="text-button muted"
                              onClick={() => openPanel("supersede", d)}
                            >
                              Supersede
                            </button>
                          )}
                        </div>
                        <button
                          className="text-button history-entry-link"
                          onClick={() => openTrail(d.id)}
                        >
                          <Icon name="activity" size={17} />
                          Follow this decision’s history
                          <Icon name="arrow" size={16} />
                        </button>
                      </article>
                    ))
                  )}
                </section>
                <aside className="margin-note">
                  <div className="margin-heading">
                    <Icon name="evidence" />
                    <h2>Worth another look</h2>
                  </div>
                  {pending ? (
                    <>
                      <p className="margin-lead">
                        {pending === 1 ? "One piece of evidence" : `${pending} pieces of evidence`}{" "}
                        waiting for your judgment.
                      </p>
                      {project.candidates
                        .filter(
                          (c) =>
                            c.status === "pending" &&
                            ["reported_change", "correction", "manual"].includes(c.kind),
                        )
                        .slice(0, 3)
                        .map((c) => (
                          <button
                            className="evidence-preview"
                            key={c.id}
                            onClick={() => {
                              navigate("Evidence");
                              setSelected(c.id);
                            }}
                          >
                            <span className="badge reported_change">{kinds[c.kind]}</span>
                            <p>“{c.quote}”</p>
                            <span className="text-button">
                              Compare the evidence <Icon name="arrow" size={16} />
                            </span>
                          </button>
                        ))}
                    </>
                  ) : (
                    <p>
                      No explicit change reports to review. Import a later conversation when there’s
                      something new.
                    </p>
                  )}
                  <div className="principle">
                    <span className="rule-mark" />
                    <h3>A question isn’t a changed fact.</h3>
                    <p>
                      Hypotheticals and uncertain reports stay separate from changes. Your judgment
                      makes the final call.
                    </p>
                  </div>
                  <button className="secondary" onClick={() => openPanel("import")}>
                    <Icon name="plus" size={16} />
                    Import a conversation
                  </button>
                </aside>
              </div>
            )}
            {tab === "Evidence" && (
              <div className="evidence-workspace">
                <div className="evidence-selector">
                  <div className="section-bar">
                    <label htmlFor="evidence-filter">Show</label>
                    <select
                      id="evidence-filter"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">All evidence</option>
                      <option value="pending">Pending review</option>
                      <option value="reported_change">Reported changes</option>
                      <option value="hypothetical">Questions / hypotheticals</option>
                      <option value="uncertain">Uncertain reports</option>
                      <option value="reviewed">Reviewed</option>
                    </select>
                  </div>
                  {project.candidates
                    .filter(
                      (c) =>
                        filter === "all" ||
                        (filter === "pending"
                          ? c.status === "pending"
                          : filter === "reviewed"
                            ? c.status !== "pending"
                            : c.kind === filter),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        className={"candidate-row " + (selected === c.id ? "selected" : "")}
                        onClick={() => setSelected(c.id)}
                      >
                        <span className={"badge " + c.kind}>{kinds[c.kind]}</span>
                        <h3>{project.decisions.find((d) => d.id === c.decisionId)?.title}</h3>
                        <p>“{c.quote}”</p>
                        <span className="candidate-foot">
                          {labels(c.status)} <Icon name="arrow" size={16} />
                        </span>
                      </button>
                    ))}
                  {project.candidates.length === 0 && (
                    <Empty title="Nothing to compare yet.">
                      Confirm a decision, then import a later conversation. You can also link exact
                      evidence yourself.
                    </Empty>
                  )}
                </div>
                {candidate ? (
                  <Review
                    key={candidate.id + "-" + candidate.status}
                    project={project}
                    candidate={candidate}
                    onOpenHistory={() => openTrail(candidate.decisionId, candidate.decisionVersion)}
                    onOpenCurrentDecision={() => {
                      navigate("Decisions");
                      window.scrollTo({ top: 0, behavior: "instant" });
                      requestAnimationFrame(() => notebookHeading.current?.focus({ preventScroll: true }));
                    }}
                    busy={busy}
                    submit={(type, payload, message) =>
                      perform(() => command(type, payload), message)
                    }
                  />
                ) : (
                  <Empty title="Put the two moments together.">
                    Choose an evidence item to compare the original reason and the later statement.
                  </Empty>
                )}
              </div>
            )}
            {tab === "Checklist" && (
              <section className="checklist-page">
                {project.checklist.length === 0 ? (
                  <Empty
                    title="Give the decision somewhere to land."
                    action={
                      <button className="text-button" onClick={() => openPanel("checklist")}>
                        Add your first item <Icon name="arrow" size={16} />
                      </button>
                    }
                  >
                    Add a concrete piece of work, then anchor a decision to it. Reopened decisions
                    can propose an exact change here.
                  </Empty>
                ) : (
                  project.checklist.map((item) => (
                    <div className={"checklist-row " + (item.done ? "done" : "")} key={item.id}>
                      <input
                        type="checkbox"
                        aria-label={
                          "Mark " + item.text + " " + (item.done ? "incomplete" : "complete")
                        }
                        checked={item.done}
                        disabled={busy}
                        onChange={() =>
                          perform(
                            () => command("toggle_checklist", { id: item.id }),
                            "Checklist updated.",
                          )
                        }
                      />
                      <div>
                        <p>{item.text}</p>
                        <span>
                          {project.decisions.filter((d) => d.anchorId === item.id).length} linked
                          decisions · v{item.version}
                        </span>
                      </div>
                    </div>
                  ))
                )}
                {project.candidates
                  .filter((c) => c.proposal)
                  .map((c) => (
                    <div key={c.id} className="change-summary">
                      <span className={"badge " + c.proposal!.status}>
                        {labels(c.proposal!.status)}
                      </span>
                      <h3>{c.proposal!.before}</h3>
                      {c.proposal!.after && <p className="replacement">{c.proposal!.after}</p>}
                      <button
                        className="text-button"
                        onClick={() => {
                          navigate("Evidence");
                          setSelected(c.id);
                        }}
                      >
                        Review the change <Icon name="arrow" size={16} />
                      </button>
                    </div>
                  ))}
              </section>
            )}
            {tab === "Sources" && (
              <section className="sources-page">
                <BeeConnection
                  key={`${viewKey}:${renderedEpoch}`}
                  api={api}
                  isCurrentView={isCurrentView}
                  project={project}
                  onImported={(p) => {
                    if (!isCurrentView() || p.id !== project.id) return;
                    setProject((current) =>
                      current?.id === p.id && current.version <= p.version ? p : current,
                    );
                    // Update this row from the response; an extra asynchronous list refresh
                    // could otherwise arrive after a different account has signed in.
                    setProjects((current) =>
                      current.map((summary) =>
                        summary.id === p.id && summary.version <= p.version
                          ? {
                              ...summary,
                              version: p.version,
                              updatedAt: p.updatedAt,
                              decisions: p.decisions.length,
                              reviews: p.candidates.filter(
                                (c) =>
                                  c.status === "pending" &&
                                  ["reported_change", "correction", "manual"].includes(c.kind),
                              ).length,
                            }
                          : summary,
                      ),
                    );
                  }}
                />
                {project.sources.length === 0 ? (
                  <Empty
                    title="Bring the conversation with you."
                    action={
                      <button className="text-button" onClick={() => openPanel("import")}>
                        Import text or JSON <Icon name="arrow" size={16} />
                      </button>
                    }
                  >
                    Paste a transcript or choose a file. Keep its date, source label, and provenance
                    alongside the original words.
                  </Empty>
                ) : (
                  project.sources.map((s) => (
                    <details className="source-record" key={s.id}>
                      <summary>
                        <Icon name="source" />
                        <div>
                          <h3>{s.title}</h3>
                          <span>
                            {date(s.occurredAt)} · {sourceOrigin(s)} ·{" "}
                            {s.text.length.toLocaleString()} characters
                          </span>
                        </div>
                        <Icon name="chevron" size={17} />
                      </summary>
                      <div className="source-body">
                        <p className="provenance">{s.provenance}</p>
                        <dl>
                          <dt>Imported</dt>
                          <dd>{date(s.importedAt)}</dd>
                          <dt>Source reference</dt>
                          <dd>{s.externalId || "Not supplied"}</dd>
                          <dt>Project label</dt>
                          <dd>{s.projectLabel || "This notebook"}</dd>
                          <dt>Retrieval origin</dt>
                          <dd>{sourceOrigin(s)}</dd>
                          {s.provider && (
                            <>
                              <dt>Provider-reported device</dt>
                              <dd>{s.provider.deviceType} · not independently verified</dd>
                              <dt>Source revision</dt>
                              <dd>
                                {s.sourceRevision || 1}
                                {s.supersedesSourceId ? " · Earlier source retained" : ""}
                              </dd>
                              <dt>Retrieved</dt>
                              <dd>{new Date(s.provider.fetchedAt).toLocaleString()}</dd>
                            </>
                          )}
                          <dt>Content SHA-256</dt>
                          <dd className="hash">{s.digest}</dd>
                        </dl>
                        {s.provider && (
                          <section className="bee-source-context">
                            <h4>Bee’s processed context</h4>
                            <p>{s.provider.summary}</p>
                            <small>
                              Generated context can contain errors. Use the transcript and
                              surrounding conversation when confirming a decision.
                            </small>
                          </section>
                        )}
                        <pre>{s.text}</pre>
                      </div>
                    </details>
                  ))
                )}
              </section>
            )}
            {tab === "Assistant" && (
              <AssistantConnection
                key={`${viewKey}:${renderedEpoch}`}
                api={api}
                isCurrentView={isCurrentView}
                project={project}
              />
            )}
            {tab === "Activity" && (
              <section className="activity-page">
                {[...project.audit].reverse().map((a) => (
                  <div className="activity-row" key={a.id}>
                    <span className="timeline-dot" />
                    <div>
                      <h3>{labels(a.action)}</h3>
                      <p>{a.detail}</p>
                      <time>{new Date(a.at).toLocaleString()}</time>
                    </div>
                  </div>
                ))}
                <div className="danger-zone">
                  <h3>Delete this notebook</h3>
                  <p>Export a copy first if you need to keep its history.</p>
                  <button className="text-button danger" onClick={() => openPanel("delete")}>
                    Delete notebook
                  </button>
                </div>
              </section>
            )}
          </>
        )}
        <footer className="workspace-footer">
          <span>Reopen. Keep your reasons close.</span>
          <span>Private by account · Evidence before action</span>
        </footer>
      </main>
    </div>
  );
}
function Auth({
  error,
  busy,
  submit,
}: {
  error: string;
  busy: boolean;
  submit: (data: any, mode: string) => void;
}) {
  const [mode, setMode] = useState("register");
  return (
    <div className="auth-page">
      <header>
        <a className="wordmark" href="/">
          <Mark />
          Reopen
        </a>
        <span>Your private decision notebook</span>
      </header>
      <main className="auth-main">
        <section className="auth-story">
          <h1>
            You had
            <br />
            your reasons.
            <br />
            <em>Keep them.</em>
          </h1>
          <p>
            Remember why a decision made sense. Recognize when the evidence changes. Choose what
            happens next.
          </p>
          <div className="story-pair">
            <div>
              <span className="folio">An illustrative decision</span>
              <h3>“We can keep the demo online-only.”</h3>
              <p>Because the venue has reliable internet.</p>
            </div>
            <div>
              <span className="folio">A later statement</span>
              <h3>“The room will have no Wi-Fi.”</h3>
              <p>A reason to review. You approve what changes.</p>
            </div>
          </div>
          <p className="auth-footnote">
            Record decisions yourself, import optional Bee context, or review them through an MCP assistant connection.
          </p>
        </section>
        <section className="auth-form">
          <h2>{mode === "register" ? "Make room for better judgment." : "Welcome back."}</h2>
          <p>
            {mode === "register"
              ? "Create a private account to start your notebook."
              : "Your reasons are right where you left them."}
          </p>
          <div className="auth-tabs">
            <button
              className={mode === "register" ? "active" : ""}
              onClick={() => setMode("register")}
            >
              Create account
            </button>
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
              Sign in
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(Object.fromEntries(new FormData(e.currentTarget)), mode);
            }}
          >
            {mode === "register" && (
              <Field label="Your name">
                <input
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="How should we address you?"
                />
              </Field>
            )}
            <Field label="Email">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                maxLength={254}
              />
            </Field>
            <Field label="Password" hint="At least 12 characters. Use a unique password.">
              <input
                name="password"
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                required
                minLength={12}
                maxLength={200}
              />
            </Field>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy
                ? "Opening your notebook…"
                : mode === "register"
                  ? "Create my private account"
                  : "Sign in"}
              <Icon name="arrow" size={18} />
            </button>
          </form>
          <div className="privacy-note">
            <Icon name="lock" size={17} />
            <p>
              Only your account can access your notebooks. Email verification and password recovery
              are not available yet; keep your password safe.
            </p>
          </div>
        </section>
      </main>
      <footer>
        <span>Remember what would make you change your mind.</span>
        <span>Reopen · 2026</span>
      </footer>
    </div>
  );
}
function Editor({
  panel,
  project,
  busy,
  user,
  submit,
}: {
  panel: Panel;
  project: Project | null;
  busy: boolean;
  user: User;
  submit: (data: any) => Promise<void>;
}) {
  const d = panel.decision;
  const [type, setType] = useState("text"),
    [text, setText] = useState(""),
    [fileError, setFileError] = useState(""),
    [deleteText, setDeleteText] = useState("");
  const titles: Record<string, string> = {
    project: "A new notebook.",
    decision: d ? "Reconsider the wording." : "Give the decision a memory.",
    checklist: "The next piece of work.",
    import: "Bring the original words.",
    manual: "Make the connection yourself.",
    supersede: "Close this decision.",
    delete: "Delete this notebook?",
    account: "Your private account.",
  };
  const descriptions: Record<string, string> = {
    project: "Keep one project’s reasoning and evidence together.",
    decision: "Save a draft first. Only your explicit confirmation activates it.",
    checklist: "Write the concrete task an approved decision might affect.",
    import:
      "Text and JSON imports retain their date and provenance. They never become verified Bee data.",
    manual: "Select an active decision and an exact quote from an imported transcript.",
    supersede: "The original reasoning and review history stay in your notebook.",
    delete:
      "This removes the notebook, transcripts, evidence and history from the active database. Export first if you need a copy.",
    account: `Signed in as ${user.email}. Email verification and recovery are not configured.`,
  };
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFileError("");
    const data: any = Object.fromEntries(new FormData(e.currentTarget));
    if (panel.type === "decision") {
      data.assumptions = data.assumptions.split("\n").filter((s: string) => s.trim());
      if (d) data.id = d.id;
    }
    if (panel.type === "supersede") data.id = d?.id;
    if (panel.type === "import") {
      if (type === "json") {
        try {
          const raw = JSON.parse(text);
          const sources = Array.isArray(raw) ? raw : raw.sources;
          if (!Array.isArray(sources))
            throw new Error("Use an array or an object containing a sources array.");
          data.sources = sources;
        } catch (err) {
          setFileError((err as Error).message);
          return;
        }
      } else
        data.sources = [
          {
            title: data.title,
            text,
            occurredAt: data.occurredAt,
            provenance: data.provenance,
            projectLabel: data.projectLabel,
            externalId: data.externalId,
          },
        ];
    }
    await submit(data);
  }
  return (
    <>
      <h1>{titles[panel.type]}</h1>
      <p className="editor-intro">{descriptions[panel.type]}</p>
      <form onSubmit={onSubmit}>
        {panel.type === "project" && (
          <>
            <Field label="Notebook name">
              <input
                name="title"
                required
                maxLength={100}
                placeholder="e.g. Autumn product launch"
              />
            </Field>
            <Field label="What is this project about?">
              <textarea
                name="description"
                maxLength={500}
                rows={3}
                placeholder="A little context for future you."
              />
            </Field>
          </>
        )}
        {panel.type === "decision" && (
          <>
            <Field label="The decision">
              <input
                name="title"
                defaultValue={d?.title}
                required
                maxLength={200}
                placeholder="What have you chosen to do?"
              />
            </Field>
            <Field label="Why it makes sense">
              <textarea
                name="rationale"
                defaultValue={d?.rationale}
                required
                maxLength={2000}
                rows={3}
                placeholder="The reasoning you want to preserve."
              />
            </Field>
            <Field label="Supporting assumptions" hint="One assumption per line; up to ten.">
              <textarea
                name="assumptions"
                defaultValue={d?.assumptions.join("\n")}
                required
                maxLength={6000}
                rows={3}
                placeholder="What needs to remain true?"
              />
            </Field>
            <Field label="Revisit this when">
              <textarea
                name="reviewCondition"
                defaultValue={d?.reviewCondition}
                required
                maxLength={1000}
                rows={2}
                placeholder="The specific condition that would change your mind."
              />
            </Field>
            <div className="field-pair">
              <Field label="Original source (optional)">
                <select name="sourceId" defaultValue={d?.sourceId || ""}>
                  <option value="">Written directly in this notebook</option>
                  {project?.sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Checklist anchor (optional)">
                <select name="anchorId" defaultValue={d?.anchorId || ""}>
                  <option value="">No checklist anchor</option>
                  {project?.checklist.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.text}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              label="Exact original quote"
              hint="Required only when you select a source. Copy the words exactly."
            >
              <textarea name="quote" defaultValue={d?.quote} maxLength={2000} rows={2} />
            </Field>
          </>
        )}
        {panel.type === "checklist" && (
          <Field label="Checklist item">
            <textarea
              name="text"
              required
              maxLength={500}
              rows={3}
              placeholder="The concrete next step."
            />
          </Field>
        )}
        {panel.type === "import" && (
          <>
            <div className="field-pair">
              <Field label="Import format">
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="text">Plain text transcript</option>
                  <option value="json">JSON transcripts</option>
                </select>
              </Field>
              <Field label="Choose a file (optional)">
                <input
                  type="file"
                  accept={type === "json" ? ".json,application/json" : ".txt,text/plain"}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 200000) {
                      setFileError("Choose a file smaller than 200 KB.");
                      return;
                    }
                    setText(await file.text());
                    setFileError("");
                  }}
                />
              </Field>
            </div>
            {type === "text" && (
              <>
                <div className="field-pair">
                  <Field label="Source title">
                    <input
                      name="title"
                      required
                      maxLength={160}
                      placeholder="e.g. Tuesday room check"
                    />
                  </Field>
                  <Field label="Conversation date">
                    <input name="occurredAt" type="datetime-local" required />
                  </Field>
                </div>
                <Field label="Where did this transcript come from?">
                  <textarea
                    name="provenance"
                    required
                    maxLength={1000}
                    rows={2}
                    placeholder="How it was recorded or transcribed, and what permission you have to use it."
                  />
                </Field>
                <div className="field-pair">
                  <Field
                    label="Project label (optional)"
                    hint="A different project name prevents an automatic change suggestion."
                  >
                    <input name="projectLabel" maxLength={100} placeholder={project?.title} />
                  </Field>
                  <Field label="External reference (optional)">
                    <input
                      name="externalId"
                      maxLength={200}
                      placeholder="Your own source ID or reference"
                    />
                  </Field>
                </div>
              </>
            )}
            <Field
              label={type === "json" ? "JSON content" : "Transcript"}
              hint={
                type === "json"
                  ? 'Use [{"title":"…","text":"…","occurredAt":"2026-09-08T10:00:00Z","provenance":"…"}]. Maximum 20 sources.'
                  : "Up to 100,000 characters per transcript. Only import material you have permission to use."
              }
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                required
                maxLength={200000}
                rows={10}
                spellCheck={type !== "json"}
                placeholder={
                  type === "json"
                    ? '[{"title":"Room check","text":"The original words…","occurredAt":"2026-09-08T10:00:00Z","provenance":"Manual notes with permission"}]'
                    : "Paste the original transcript here."
                }
              />
            </Field>
          </>
        )}
        {panel.type === "manual" && (
          <>
            <Field label="Active decision">
              <select name="decisionId" required>
                <option value="">Choose a decision</option>
                {project?.decisions
                  .filter((d) => ["watching", "review_suggested"].includes(d.status))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} · v{d.version}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Source transcript">
              <select name="sourceId" required>
                <option value="">Choose an imported source</option>
                {project?.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Exact evidence quote">
              <textarea
                name="quote"
                required
                maxLength={2000}
                rows={4}
                placeholder="Copy the exact relevant words from the transcript."
              />
            </Field>
            <Field label="Why it matters">
              <textarea
                name="reason"
                required
                maxLength={1000}
                rows={3}
                placeholder="Explain the connection and any uncertainty."
              />
            </Field>
          </>
        )}
        {panel.type === "supersede" && (
          <Field label="Why is this decision superseded?">
            <textarea name="reason" required maxLength={1000} rows={3} />
          </Field>
        )}
        {panel.type === "delete" && (
          <Field label={`Type “${project?.title}” to confirm deletion`}>
            <input
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              required
              autoComplete="off"
            />
          </Field>
        )}
        {panel.type === "account" && (
          <div className="danger-zone">
            <h2>Delete your account</h2>
            <p>
              This permanently removes your account, all notebooks and sessions from the active
              database.
            </p>
            <Field label="Confirm your password">
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={12}
                maxLength={200}
              />
            </Field>
            <Field label="Type DELETE to confirm">
              <input
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                required
                autoComplete="off"
              />
            </Field>
          </div>
        )}
        {fileError && (
          <p className="form-error" role="alert">
            {fileError}
          </p>
        )}
        <div className="editor-actions">
          <button
            className={
              "primary " + (["delete", "account"].includes(panel.type) ? "destructive" : "")
            }
            disabled={
              busy ||
              (panel.type === "delete" && deleteText !== project?.title) ||
              (panel.type === "account" && deleteText !== "DELETE")
            }
          >
            {busy
              ? "Saving…"
              : panel.type === "decision"
                ? "Save decision draft"
                : panel.type === "import"
                  ? "Import and compare"
                  : panel.type === "delete"
                    ? "Delete notebook"
                    : panel.type === "account"
                      ? "Delete account and notebooks"
                      : panel.type === "project"
                        ? "Create notebook"
                        : panel.type === "supersede"
                          ? "Supersede decision"
                          : "Save to notebook"}
            <Icon name="arrow" size={17} />
          </button>
        </div>
      </form>
    </>
  );
}
function Review({
  project,
  candidate: c,
  onOpenHistory,
  onOpenCurrentDecision,
  busy,
  submit,
}: {
  project: Project;
  candidate: Candidate;
  onOpenHistory: () => void;
  onOpenCurrentDecision: () => void;
  busy: boolean;
  submit: (type: string, data: any, message: string) => Promise<void>;
}) {
  const d = project.decisions.find((d) => d.id === c.decisionId)!;
  const s = project.sources.find((s) => s.id === c.sourceId)!;
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    reviewHeading.current?.focus({ preventScroll: true });
  }, [c.id]);
  const original =
    c.decisionSnapshot ||
    d.history
      .filter((h) => h.version >= c.decisionVersion && h.rationale)
      .sort((a, b) => a.version - b.version)[0] ||
    d;
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [after, setAfter] = useState(c.proposal?.after || "");
  const stale = d.version !== c.decisionVersion && c.status === "pending";
  const reopenAllowed = ["reported_change", "correction", "manual"].includes(c.kind);
  const checklistItem = project.checklist.find((item) => item.id === c.proposal?.itemId);
  const decisionChanged = Boolean(c.proposal && d.version !== c.reopenedDecisionVersion);
  const checklistChanged = Boolean(c.proposal && (!checklistItem ||
    checklistItem.version !== c.proposal.itemVersion || checklistItem.text !== c.proposal.before));
  const proposalStale = c.proposal?.status !== "approved" && (decisionChanged || checklistChanged);
  return (
    <article className="review-detail">
      <div className="review-title">
        <span className={"badge " + c.kind}>{kinds[c.kind]}</span>
        <span className="small-label">{labels(c.status)}</span>
      </div>
      <h2 ref={reviewHeading} tabIndex={-1}>
        {original.title}
      </h2>
      <button className="text-button review-history-link" onClick={onOpenHistory}>
        <Icon name="activity" size={16} />
        View decision history · v{c.decisionVersion}
        <Icon name="arrow" size={16} />
      </button>
      <section className="paired-original">
        <h3>The original reason</h3>
        <p>{original.rationale}</p>
        <ul>
          {original.assumptions?.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
        <p className="review-condition">
          <strong>Revisit when</strong> {original.reviewCondition}
        </p>
      </section>
      <section className="paired-later">
        <h3>The later statement</h3>
        <blockquote>“{c.quote}”</blockquote>
        <p className="source-citation">
          {s.title} · {date(s.occurredAt)} · {sourceOrigin(s)}
        </p>
        <details>
          <summary>Source and provenance</summary>
          <p>{s.provenance}</p>
          {s.provider && (
            <section className="bee-source-context">
              <h4>Bee’s processed context</h4>
              <p>{s.provider.summary}</p>
              <small>
                Generated context can contain errors. Use the transcript and surrounding
                conversation when confirming a decision.
              </small>
            </section>
          )}
          <pre>{s.text}</pre>
        </details>
      </section>
      <p className="triage-reason">{c.reason}</p>
      {stale ? (
        <div className="notice-box">
          <h3>This review belongs to an earlier decision.</h3>
          <p>
            The decision is now version {d.version}. Confirm the current version to rescan, or link
            the evidence to it manually.
          </p>
        </div>
      ) : c.status === "pending" ? (
        <div className="disposition">
          <h3>Your judgment</h3>
          <Field label="Reason for your review">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              maxLength={1500}
              rows={3}
              placeholder="What did you establish, and what should happen next?"
            />
          </Field>
          {reopenAllowed ? (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>I reviewed the evidence and confirm that a premise changed.</span>
            </label>
          ) : (
            <p className="small-label">
              A hypothetical, uncertain report, or context cannot reopen a decision. Clarify or link
              a confirmed statement first.
            </p>
          )}
          <div className="review-buttons">
            <button
              className="primary"
              disabled={busy || !reason.trim() || !confirmed || !reopenAllowed}
              onClick={() =>
                submit(
                  "disposition",
                  { id: c.id, action: "reopen", reason, confirmedChange: confirmed },
                  "Decision reopened. Checklist changes still require separate approval.",
                )
              }
            >
              Reopen decision
            </button>
            <button
              className="secondary"
              disabled={busy || !reason.trim()}
              onClick={() =>
                submit(
                  "disposition",
                  { id: c.id, action: "clarify", reason },
                  "Clarification recorded. Nothing else changed.",
                )
              }
            >
              Ask for clarification
            </button>
            <button
              className="text-button"
              disabled={busy || !reason.trim()}
              onClick={() =>
                submit(
                  "disposition",
                  { id: c.id, action: "dismiss", reason },
                  "Evidence dismissed with your reason.",
                )
              }
            >
              Dismiss
            </button>
          </div>
          <small>Clarification is recorded here; no message is sent to anyone.</small>
        </div>
      ) : (
        <div className="review-outcome">
          <h3>{c.status === "retired" ? "Review retired" : "Your recorded judgment"}</h3>
          <p>
            {c.reasonForDisposition ||
              (c as Candidate & { retirementReason?: string }).retirementReason ||
              "This review is preserved in the notebook history."}
          </p>
        </div>
      )}
      {c.proposal && (
        <section className="change-editor">
          <h3>The checklist change</h3>
          <p>{c.proposal.status === "approved"
            ? "This records the exact change approved at the time."
            : proposalStale
              ? "This saved proposal is preserved for reference and can no longer be approved."
              : "The original task remains unchanged until you approve its replacement."}</p>
          {proposalStale && (
            <div className="notice-box" role="status">
              <h3>This proposal needs a new review.</h3>
              {decisionChanged && <p>The decision changed after reopening: it is now v{d.version} ({labels(d.status)}).</p>}
              {checklistChanged && <p>The checklist item changed after this proposal was created.
                {checklistItem && <> Current item · v{checklistItem.version}: {checklistItem.text} ({checklistItem.done ? "complete" : "incomplete"}).</>}
              </p>}
              <p>Review the current decision, revise and confirm it to compare the source again, then reopen fresh evidence before drafting a replacement. This proposal cannot overwrite the current checklist.</p>
              <button className="text-button" onClick={onOpenCurrentDecision}>
                Return to decisions <Icon name="arrow" size={16} />
              </button>
            </div>
          )}
          <div className="diff">
            <span>Before</span>
            <p>{c.proposal.before}</p>
            <span>After</span>
            {c.proposal.status === "needs_draft" ? (
              <p className="muted">No replacement drafted yet.</p>
            ) : (
              <p className="replacement">{c.proposal.after}</p>
            )}
          </div>
          {c.proposal.status !== "approved" && !proposalStale && (
            <>
              <Field label="Replacement checklist text">
                <textarea
                  value={after}
                  onChange={(e) => setAfter(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Write the exact replacement task."
                />
              </Field>
              <div className="review-buttons">
                <button
                  className="secondary"
                  disabled={busy || !after.trim() || after === c.proposal.before}
                  onClick={() =>
                    submit(
                      "draft_checklist_change",
                      { id: c.id, after },
                      "Exact checklist change drafted. Review it before approval.",
                    )
                  }
                >
                  Preview exact change
                </button>
                {c.proposal.status === "pending_approval" && (
                  <button
                    className="primary"
                    disabled={busy || after !== c.proposal.after}
                    onClick={() =>
                      submit(
                        "approve_checklist_change",
                        { id: c.id },
                        "Checklist change approved and recorded.",
                      )
                    }
                  >
                    Approve checklist change
                  </button>
                )}
              </div>
            </>
          )}
          {c.proposal.status === "approved" && (
            <p className="approved-note">
              <Icon name="check" size={18} />
              Approved and recorded. The checklist was updated.
            </p>
          )}
        </section>
      )}
    </article>
  );
}
export default App;
