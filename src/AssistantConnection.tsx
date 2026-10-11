import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Project } from "./types";

type Grant = {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  allowDrafts: boolean;
};
type Access = { endpoint: string; protocolVersion: string; grants: Grant[] };
type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
type McpTool = { name: string; description?: string; inputSchema?: unknown };

const when = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function McpResult({ value }: { value: unknown }) {
  const result = value && typeof value === "object" && !Array.isArray(value) ?
    value as Record<string, any> : {};
  return <>
    {(result.title || result.rationale || result.decisionSnapshot?.rationale) &&
      <div className="assistant-result-highlight">
        {result.title && <h4>{result.title}</h4>}
        {(result.rationale || result.decisionSnapshot?.rationale) &&
          <p><strong>Original rationale</strong>{result.rationale || result.decisionSnapshot.rationale}</p>}
      </div>}
    {(result.quote || result.reason || result.proposal) && <div className="assistant-result-facts">
      {result.quote && <div><strong>Evidence quote</strong><p>{result.quote}</p></div>}
      {result.reason && <div><strong>Review reason</strong><p>{result.reason}</p></div>}
      {result.proposal && <div><strong>Proposed checklist change</strong>
        <p>{result.proposal.before} → {result.proposal.after}</p>
        <small>{result.proposal.status === "pending_approval" ? "Awaiting owner approval" : result.proposal.status}</small></div>}
    </div>}
    <details><summary>Full MCP response</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>
  </>;
}

export default function AssistantConnection({
  api,
  isCurrentView,
  project,
}: {
  api: Api;
  isCurrentView: () => boolean;
  project: Project;
}) {
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [label, setLabel] = useState("");
  const [allowDrafts, setAllowDrafts] = useState(false);
  const [secret, setSecret] = useState("");
  const [secretGrantId, setSecretGrantId] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [secretEndpoint, setSecretEndpoint] = useState("");
  const [clientToken, setClientToken] = useState("");
  const [clientGrantId, setClientGrantId] = useState("");
  const [connected, setConnected] = useState(false);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [toolBusy, setToolBusy] = useState(false);
  const [toolResult, setToolResult] = useState<unknown>(null);
  const [toolName, setToolName] = useState("reopen_notebook_overview");
  const [decisionId, setDecisionId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [replacement, setReplacement] = useState("");
  const credentialEpoch = useRef(0);
  const base = `/projects/${encodeURIComponent(project.id)}/assistant-access`;

  useEffect(() => {
    let mounted = true;
    api(base)
      .then((result: Access) => {
        if (mounted && isCurrentView()) setAccess(result);
      })
      .catch((e: Error) => {
        if (mounted && isCurrentView()) setError(e.message);
      })
      .finally(() => {
        if (mounted && isCurrentView()) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [base]);

  async function createGrant(event: FormEvent) {
    event.preventDefault();
    if (busy || !label.trim()) return;
    credentialEpoch.current++;
    setBusy(true);
    setToolBusy(false);
    setError("");
    setNotice("");
    try {
      const result: { grant: Grant; token: string; endpoint: string } = await api(base, "POST", {
        expectedVersion: project.version,
        label: label.trim(),
        allowDrafts,
      });
      if (!isCurrentView()) return;
      credentialEpoch.current++;
      setAccess((current) => current && {
        ...current,
        grants: [result.grant, ...current.grants],
      });
      setSecret(result.token);
      setSecretGrantId(result.grant.id);
      setClientToken(result.token);
      setClientGrantId(result.grant.id);
      setConnected(false);
      setTools([]);
      setToolResult(null);
      setSecretEndpoint(result.endpoint);
      setRevealed(false);
      setLabel("");
      setAllowDrafts(false);
      setNotice("Access created. Copy the secret now; it cannot be shown again.");
    } catch (e) {
      if (isCurrentView()) setError((e as Error).message);
    } finally {
      if (isCurrentView()) setBusy(false);
    }
  }

  async function revokeGrant(id: string) {
    if (busy) return;
    credentialEpoch.current++;
    setBusy(true);
    setToolBusy(false);
    setError("");
    setNotice("");
    try {
      await api(`${base}/${encodeURIComponent(id)}`, "DELETE");
      if (!isCurrentView()) return;
      credentialEpoch.current++;
      setAccess((current) => current && {
        ...current,
        grants: current.grants.filter((grant) => grant.id !== id),
      });
      if (secretGrantId === id) {
        setSecret("");
        setSecretGrantId("");
        setSecretEndpoint("");
        setRevealed(false);
      }
      if (clientGrantId === id) {
        setClientToken("");
        setClientGrantId("");
        setConnected(false);
        setTools([]);
        setToolResult(null);
      }
      setNotice("Assistant access revoked.");
    } catch (e) {
      if (isCurrentView()) setError((e as Error).message);
    } finally {
      if (isCurrentView()) setBusy(false);
    }
  }

  async function copy(value: string, name: string) {
    try {
      await navigator.clipboard.writeText(value);
      if (isCurrentView()) setNotice(`${name} copied.`);
    } catch {
      if (isCurrentView()) setError(`Could not copy ${name.toLowerCase()}. Select and copy it manually.`);
    }
  }

  async function mcpRequest(method: string, params: unknown, id: number, token: string) {
    if (!access) throw new Error("Load the connection first.");
    const response = await fetch("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": access.protocolVersion,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!response.ok) {
      let message = `MCP request failed (${response.status}).`;
      try {
        const body = await response.json();
        message = body.error?.message || body.error || message;
      } catch { /* The transport can return an empty error response. */ }
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    const contentType = response.headers.get("content-type") || "";
    let result: any;
    if (contentType.includes("text/event-stream")) {
      const stream = await response.text();
      const eventData = stream.split(/\r?\n/).filter((line) => line.startsWith("data:"));
      const messages = eventData.map((line) => JSON.parse(line.slice(5).trim()));
      result = messages.find((message) => message.id === id);
    } else {
      result = await response.json();
    }
    if (!result) throw new Error("The MCP server did not return a response.");
    if (result.error) throw new Error(result.error.message || "MCP tool failed.");
    return result.result;
  }

  async function connectClient() {
    const token = clientToken.trim();
    if (!token || toolBusy || busy) return;
    const epoch = credentialEpoch.current;
    setToolBusy(true);
    setError("");
    setNotice("");
    try {
      const initialized = await mcpRequest("initialize", {
        protocolVersion: access?.protocolVersion || "2025-11-25",
        capabilities: {},
        clientInfo: { name: "Reopen browser", version: "1.0.0" },
      }, 1, token);
      if (!initialized?.protocolVersion) throw new Error("The MCP server did not initialize.");
      if (access) {
        const acknowledged = await fetch("/mcp", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "MCP-Protocol-Version": access.protocolVersion,
          },
          body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        });
        if (!acknowledged.ok) throw new Error(`MCP initialization failed (${acknowledged.status}).`);
      }
      const listed = await mcpRequest("tools/list", {}, 2, token);
      const overview = await mcpRequest("tools/call", {
        name: "reopen_notebook_overview", arguments: {},
      }, 3, token);
      const overviewData = presentResult(overview) as { projectId?: string };
      if (overviewData?.projectId !== project.id)
        throw new Error("This secret belongs to a different notebook.");
      if (!isCurrentView() || epoch !== credentialEpoch.current) return;
      setTools(Array.isArray(listed?.tools) ? listed.tools : []);
      setConnected(true);
      setToolResult(null);
      setNotice("MCP connection ready. Choose a tool to inspect this notebook.");
    } catch (e) {
      if (isCurrentView() && epoch === credentialEpoch.current) {
        setConnected(false); setError((e as Error).message);
      }
    } finally {
      if (isCurrentView() && epoch === credentialEpoch.current) setToolBusy(false);
    }
  }

  async function callTool(event: FormEvent) {
    event.preventDefault();
    if (!connected || toolBusy || busy) return;
    const epoch = credentialEpoch.current;
    const args = toolName === "reopen_explain_decision" ? { decisionId } :
      toolName === "reopen_review_evidence" ? { candidateId } :
      toolName === "reopen_draft_checklist_change" ?
        { candidateId, expectedVersion: project.version, replacement: replacement.trim() } : {};
    setToolBusy(true);
    setError("");
    setToolResult(null);
    try {
      const result = await mcpRequest("tools/call", { name: toolName, arguments: args }, 3, clientToken.trim());
      if (!isCurrentView() || epoch !== credentialEpoch.current) return;
      if (result?.isError) throw new Error(result.content?.[0]?.text || "The MCP tool returned an error.");
      setToolResult(result);
      setNotice("MCP tool returned a result. Review its evidence and proposed changes below.");
    } catch (e) {
      if (isCurrentView() && epoch === credentialEpoch.current) {
        if ((e as Error & { status?: number }).status === 401) {
          setConnected(false);
          setTools([]);
        }
        setError((e as Error).message);
      }
    } finally {
      if (isCurrentView() && epoch === credentialEpoch.current) setToolBusy(false);
    }
  }

  function presentResult(result: unknown): unknown {
    if (!result || typeof result !== "object") return result;
    const value = result as { structuredContent?: unknown; content?: { type: string; text?: string }[] };
    if (value.structuredContent) return value.structuredContent;
    if (value.content?.length) {
      return value.content.map((item) => {
        if (item.type !== "text") return item.type;
        try { return JSON.parse(item.text || ""); } catch { return item.text; }
      });
    }
    return result;
  }

  return (
    <section className="assistant-connection" aria-labelledby="assistant-heading">
      <div className="assistant-intro">
        <span className="assistant-kicker">A private bridge for your notebook</span>
        <h2 id="assistant-heading">Bring the assistant to the decision.</h2>
        <p>
          Reopen exposes this notebook through an MCP connection. An MCP client can read your
          decisions, explain the original rationale, and review later evidence. The owner still
          decides when a decision reopens and whether any checklist change is approved.
        </p>
      </div>
      <div className="assistant-journey" aria-label="How the assistant fits into a review">
        <div><span>01</span><strong>A reason is recorded</strong><p>Save a decision and the evidence behind it.</p></div>
        <div><span>02</span><strong>New evidence arrives</strong><p>Compare it with the original words and rationale.</p></div>
        <div><span>03</span><strong>You reopen the decision</strong><p>Your review, rather than a transcript alone, authorizes the next step.</p></div>
        <div><span>04</span><strong>The assistant drafts</strong><p>It can suggest exact replacement text. You review and approve the change.</p></div>
      </div>
      <div className="assistant-access-layout">
        <div className="assistant-access-main">
          <div className="assistant-section-heading">
            <div>
              <span className="assistant-kicker">Connection</span>
              <h3>Create notebook access</h3>
            </div>
            <span className="assistant-scope">Expires in 1 hour</span>
          </div>
          <p className="assistant-muted">
            Use this endpoint and secret in an MCP client that supports remote HTTP connections.
            Access applies only to <strong>{project.title}</strong>. A new secret is shown once.
          </p>
          {loading ? <p role="status" className="assistant-muted">Loading access…</p> : null}
          {error && <div className="assistant-error" role="alert">{error}</div>}
          {notice && <div className="assistant-notice" role="status">{notice}</div>}
          {access && (
            <>
              <div className="assistant-copy-field">
                <label htmlFor="assistant-endpoint">MCP endpoint</label>
                <div>
                  <input id="assistant-endpoint" value={access.endpoint} readOnly onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" className="secondary" onClick={() => copy(access.endpoint, "Endpoint")}>Copy</button>
                </div>
                <small>Protocol {access.protocolVersion}. Keep your secret private.</small>
              </div>
              <form className="assistant-grant-form" onSubmit={createGrant}>
                <label htmlFor="assistant-label">Name this connection</label>
                <input id="assistant-label" value={label} onChange={(e) => setLabel(e.target.value)}
                  placeholder="For example, my MCP client" maxLength={80} required />
                <label className="assistant-draft-choice">
                  <input type="checkbox" checked={allowDrafts} onChange={(e) => setAllowDrafts(e.target.checked)} />
                  <span><strong>Allow assistant to save unapproved checklist drafts after I reopen a decision</strong>
                    <small>Optional. Read-only access is the default. Drafts never change your checklist until you approve them.</small>
                  </span>
                </label>
                <button className="primary" type="submit" disabled={busy || !label.trim()}>
                  {busy ? "Working…" : "Create access"}
                </button>
              </form>
              {secret && (
                <div className="assistant-secret" role="region" aria-label="New access secret">
                  <span className="assistant-kicker">Shown once</span>
                  <h3>Save this secret in your MCP client.</h3>
                  <p>Once you leave this view, Reopen cannot display it again. The matching endpoint is above.</p>
                  <div className="assistant-secret-field">
                    <input aria-label="New access secret" value={secret} readOnly
                      type={revealed ? "text" : "password"} onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" className="secondary" onClick={() => setRevealed((current) => !current)}
                      aria-label={revealed ? "Hide secret" : "Reveal secret"}>{revealed ? "Hide" : "Reveal"}</button>
                    <button type="button" className="secondary" onClick={() => copy(secret, "Secret")}>Copy secret</button>
                  </div>
                  {secretEndpoint !== access.endpoint && <small>Endpoint: {secretEndpoint}</small>}
                    <button type="button" className="text-button" onClick={() => {
                      setSecret(""); setSecretGrantId(""); setSecretEndpoint("");
                    }}>
                    I saved the secret
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <aside className="assistant-boundary">
          <span className="assistant-kicker">Before you connect</span>
          <h3>You keep the final say.</h3>
          <p>Read-only grants can explain and compare. Draft access permits a proposal only after you reopen an existing review. The assistant cannot approve it.</p>
          <p>This is a real MCP endpoint for compatible clients. Alexa+ use is a proposed route and has not been verified as a live Alexa+ integration.</p>
        </aside>
      </div>
      {access && <div className="assistant-client" aria-labelledby="assistant-client-heading">
        <div className="assistant-section-heading"><div><span className="assistant-kicker">Try the real connection</span>
          <h3 id="assistant-client-heading">MCP client in this page</h3></div>
          <span className="assistant-scope">{connected ? "Connected" : "Disconnected"}</span></div>
        <p className="assistant-muted">This page sends MCP initialize, tools/list, and tools/call requests to the endpoint above. It displays the server’s returned records; it is not an Alexa+ session.</p>
        <div className="assistant-client-connect">
          <label htmlFor="assistant-client-token">Access secret</label>
          <input id="assistant-client-token" type="password" autoComplete="off" value={clientToken} disabled={busy}
            onChange={(e) => { credentialEpoch.current++; setToolBusy(false); setClientToken(e.target.value);
              setClientGrantId("");
              setConnected(false); setTools([]); setToolResult(null); }}
            placeholder="Paste an existing secret, or create access above" />
          <button type="button" className="secondary" disabled={!clientToken.trim() || toolBusy || busy}
            onClick={connectClient}>{toolBusy && !connected ? "Connecting…" : "Connect"}</button>
        </div>
        {connected && <>
          <p className="assistant-tools-count" role="status">{tools.length} tools returned by this MCP server</p>
          <form className="assistant-tool-form" onSubmit={callTool}>
            <label htmlFor="assistant-tool">Tool</label>
            <select id="assistant-tool" value={toolName} onChange={(e) => { setToolName(e.target.value); setToolResult(null); }}>
              {tools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name.replace(/^reopen_/, "").replaceAll("_", " ")}</option>)}
            </select>
            {tools.find((tool) => tool.name === toolName)?.description &&
              <p className="assistant-muted">{tools.find((tool) => tool.name === toolName)?.description}</p>}
            {toolName === "reopen_explain_decision" && <>
              <label htmlFor="assistant-decision">Decision</label>
              <select id="assistant-decision" value={decisionId} required onChange={(e) => setDecisionId(e.target.value)}>
                <option value="">Choose a decision</option>
                {project.decisions.map((decision) => <option key={decision.id} value={decision.id}>{decision.title}</option>)}
              </select>
            </>}
            {(toolName === "reopen_review_evidence" || toolName === "reopen_draft_checklist_change") && <>
              <label htmlFor="assistant-candidate">Evidence review</label>
              <select id="assistant-candidate" value={candidateId} required onChange={(e) => setCandidateId(e.target.value)}>
                <option value="">Choose evidence</option>
                {project.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>
                  {candidate.id.slice(0, 8)} · {candidate.status} · {candidate.kind}</option>)}
              </select>
            </>}
            {toolName === "reopen_draft_checklist_change" && <>
              <label htmlFor="assistant-replacement">Exact replacement checklist text</label>
              <textarea id="assistant-replacement" value={replacement} required maxLength={500}
                onChange={(e) => setReplacement(e.target.value)} placeholder="Write the proposed new checklist item" />
              <small>This creates an unapproved proposal only after you reopen the review. Refresh the notebook to inspect it in Evidence or Checklist.</small>
            </>}
            <button type="submit" className="primary" disabled={toolBusy || busy || tools.length === 0}>
              {toolBusy ? "Calling MCP tool…" : "Run tool"}</button>
          </form>
          {toolResult !== null && <div className="assistant-tool-result" role="region" aria-label="MCP tool result">
            <span className="assistant-kicker">Returned by {toolName}</span>
            <McpResult value={presentResult(toolResult)} />
          </div>}
        </>}
      </div>}
      {access && (
        <div className="assistant-grants">
          <div className="assistant-section-heading"><div><span className="assistant-kicker">Manage access</span><h3>Active connections</h3></div></div>
          {access.grants.length === 0 ? <p className="assistant-muted">No active connections for this notebook.</p> :
            <ul>{access.grants.map((grant) => (
              <li key={grant.id}>
                <div>
                  <strong>{grant.label}</strong>
                  <span>{grant.allowDrafts ? "Drafts after owner review" : "Read only"}</span>
                  <small>Created {when(grant.createdAt)} · Expires {when(grant.expiresAt)}
                    {grant.lastUsedAt ? ` · Last used ${when(grant.lastUsedAt)}` : " · Never used"}</small>
                </div>
                <button type="button" className="secondary" disabled={busy} onClick={() => revokeGrant(grant.id)}
                  aria-label={`Revoke ${grant.label}`}>Revoke</button>
              </li>
            ))}</ul>}
        </div>
      )}
    </section>
  );
}
