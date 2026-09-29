import { useEffect, useRef, useState } from "react";
import type { Project } from "./types";
type Status = {
  configured: boolean;
  connected: boolean;
  lastChecked: string | null;
  lastError: string;
  reason: string;
  accountId: string;
  fixture: boolean;
  lastImport: { added: number; revised: number; unchanged: number; at: string } | null;
};
type Conversation = {
  id: number;
  title: string;
  summary: string;
  occurredAt: string;
  state: string;
  ready: boolean;
};
type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
export default function BeeConnection({
  api,
  project,
  onImported,
  isCurrentView,
}: {
  api: Api;
  project: Project;
  onImported: (p: Project) => void;
  isCurrentView: () => boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [records, setRecords] = useState<Conversation[]>([]);
  const [next, setNext] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [permission, setPermission] = useState(false);
  const [savePermission, setSavePermission] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  // An old request must not update even parent state after this view disappears.
  const lifecycle = useRef({ mounted: false, generation: 0 });
  const viewIdentity = useRef(project.id);
  viewIdentity.current = project.id;
  function currentRequest() {
    const generation = lifecycle.current.generation;
    const projectId = project.id;
    return () =>
      lifecycle.current.mounted &&
      lifecycle.current.generation === generation &&
      viewIdentity.current === projectId &&
      isCurrentView();
  }
  async function loadStatus() {
    const current = currentRequest();
    try {
      const result = await api("/bee/status");
      if (current()) {
        setStatus(result.status);
        setError("");
      }
    } catch (e) {
      if (current()) setError((e as Error).message);
    }
  }
  useEffect(() => {
    lifecycle.current.mounted = true;
    lifecycle.current.generation++;
    void loadStatus();
    return () => {
      lifecycle.current.mounted = false;
      lifecycle.current.generation++;
    };
  }, []);
  async function run(action: string) {
    const current = currentRequest();
    setBusy(action);
    setError("");
    setReceipt("");
    try {
      const result = await api(
        "/bee/" + (action === "more" ? "conversations" : action),
        "POST",
        action === "import"
          ? {
              ids: selected,
              projectId: project.id,
              expectedVersion: project.version,
              consent: savePermission,
            }
          : { consent: permission, cursor: action === "more" ? next : "" },
      );
      if (!current()) return;
      setStatus(result.status);
      if (result.conversations) {
        setRecords(result.conversations);
        setNext(result.nextCursor);
        setSelected([]);
        setSavePermission(false);
        if (!result.conversations.length)
          setReceipt(
            "No conversations were returned. Record a conversation in Bee, let processing finish, then refresh.",
          );
      }
      if (action === "disconnect") {
        setRecords([]);
        setSelected([]);
        setPermission(false);
        setSavePermission(false);
        setReceipt("Disconnected. Existing notebook evidence is retained.");
      }
      if (result.project) {
        onImported(result.project);
        setSelected([]);
        setSavePermission(false);
        setReceipt(
          `${result.receipt.added} new · ${result.receipt.revised} revised · ${result.receipt.unchanged} unchanged. Your evidence is ready to review.`,
        );
      }
    } catch (e) {
      if (!current()) return;
      setError((e as Error).message);
      const latest = await api("/bee/status").catch(() => null);
      if (current() && latest) setStatus(latest.status);
    } finally {
      if (current()) setBusy("");
    }
  }
  return (
    <section className="bee-connection" aria-labelledby="bee-heading" aria-busy={Boolean(busy)}>
      <div className="bee-heading">
        <div>
          <p className="eyebrow">FROM CONVERSATION TO CONTEXT</p>
          <h2 id="bee-heading">Bring your Bee conversations.</h2>
        </div>
        <span className={"bee-state " + (status?.connected ? "is-connected" : "")}>
          {status ? (status.connected ? "Connected" : "Not connected") : "Checking setup…"}
        </span>
      </div>
      <p className="bee-intro">
        Choose the conversations that matter to this notebook. Keep processed context and original
        words together, then decide what they change.
      </p>
      {status?.fixture && (
        <p className="bee-fixture">
          Explicit test transport. These records are fixtures, not Bee device evidence.
        </p>
      )}
      {error && (
        <p role="alert" className="bee-error">
          {error}
        </p>
      )}
      {!status && error && (
        <button className="secondary" onClick={() => void loadStatus()}>
          Retry connection status
        </button>
      )}
      {status && !status.configured && (
        <details className="bee-setup">
          <summary>Set up a private connection</summary>
          <p>
            Enable Developer Mode in Bee, sign in with the official Bee CLI, and run its loopback
            proxy on this server. The operator then binds that proxy to your account. No Bee
            credentials go into this page.
          </p>
          <p>Reopen account ID</p>
          <code>{status.accountId}</code>
          <p>
            <a href="https://docs.bee.computer/docs/proxy" target="_blank" rel="noreferrer">
              Official Bee setup instructions ↗
            </a>
          </p>
          <small>
            Real Bee or Apple Watch recordings are still needed to demonstrate device-based use.
            Manual imports remain available below.
          </small>
        </details>
      )}
      {status?.configured && !status.connected && (
        <div className="bee-consent">
          <label>
            <input
              type="checkbox"
              checked={permission}
              onChange={(e) => setPermission(e.target.checked)}
              disabled={Boolean(busy)}
            />
            <span>
              I have permission to read this Bee account’s conversation titles and summaries.
            </span>
          </label>
          <button
            className="primary"
            disabled={!permission || Boolean(busy)}
            onClick={() => run("connect")}
          >
            {busy === "connect" ? "Connecting…" : "Connect and browse"}
          </button>
        </div>
      )}
      {status?.connected && (
        <>
          <div className="bee-toolbar">
            <button
              className="secondary"
              disabled={Boolean(busy)}
              onClick={() => run("conversations")}
            >
              {busy === "conversations"
                ? "Checking Bee…"
                : records.length
                  ? "Refresh conversations"
                  : "Browse conversations"}
            </button>
            <button
              className="text-button"
              disabled={Boolean(busy)}
              onClick={() => run("disconnect")}
            >
              Disconnect
            </button>
          </div>
          <p className="bee-privacy">
            Browsing reads titles and summaries. Only selected transcripts are saved. No background
            sync or writes to Bee.
          </p>
          {!!records.length && (
            <>
              <div className="bee-records">
                {records.map((c) => {
                  const existing = project.sources
                    .filter((s) => s.provider?.conversationId === c.id)
                    .at(-1);
                  return (
                    <label
                      className={"bee-record " + (selected.includes(c.id) ? "is-selected" : "")}
                      key={c.id}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        disabled={
                          Boolean(busy) ||
                          !c.ready ||
                          (!selected.includes(c.id) && selected.length >= 5)
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, c.id]
                              : selected.filter((id) => id !== c.id),
                          )
                        }
                      />
                      <span>
                        <span className="bee-record-meta">
                          {new Date(c.occurredAt).toLocaleString()} ·{" "}
                          {c.ready
                            ? existing
                              ? `Saved · revision ${existing.sourceRevision || 1}`
                              : "Ready to import"
                            : "Still processing"}
                        </span>
                        <strong>{c.title}</strong>
                        <span className="bee-summary">
                          {c.summary || "No processed summary available yet."}
                        </span>
                        <small>
                          Conversation {c.id} · {c.state}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="bee-pagination">
                <span>{selected.length} of 5 selected</span>
                {next && (
                  <button
                    className="text-button"
                    disabled={Boolean(busy)}
                    onClick={() => run("more")}
                  >
                    Next conversations →
                  </button>
                )}
              </div>
            </>
          )}
          {!!selected.length && (
            <div className="bee-import-action">
              <label>
                <input
                  type="checkbox"
                  checked={savePermission}
                  onChange={(e) => setSavePermission(e.target.checked)}
                  disabled={Boolean(busy)}
                />
                <span>
                  Save these transcripts and Bee’s processed context in this private notebook. I
                  will check transcription errors before confirming decisions.
                </span>
              </label>
              <button
                className="primary"
                disabled={!savePermission || Boolean(busy)}
                onClick={() => run("import")}
              >
                {busy === "import"
                  ? "Importing selected conversations…"
                  : `Import ${selected.length} and compare`}
              </button>
              <small>Re-importing preserves previous evidence and skips unchanged content.</small>
            </div>
          )}
        </>
      )}
      {receipt && (
        <p className="bee-receipt" role="status">
          {receipt}
        </p>
      )}
      {status?.lastChecked && (
        <p className="bee-checked">
          Last checked {new Date(status.lastChecked).toLocaleString()}
          {status.lastError ? " · Last request needs attention" : ""}
        </p>
      )}
      {status?.lastImport && !receipt && (
        <p className="bee-checked">
          Last import: {status.lastImport.added} new, {status.lastImport.revised} revised,{" "}
          {status.lastImport.unchanged} unchanged.
        </p>
      )}
      <p className="bee-boundary">
        Disconnect stops future reads. Deleting this notebook removes its saved copies; it never
        deletes the original Bee conversations.
      </p>
    </section>
  );
}
