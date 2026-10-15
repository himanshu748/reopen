// Official SDK client against an actual deployed origin; receipts contain no credentials or notebook content.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const base = process.env.REOPEN_JUDGE_ORIGIN || 'https://localhost:8443';
const origin = new URL(base);
const localHttp = origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname);
if ((origin.protocol !== 'https:' && !localHttp) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || base.endsWith('/'))
  throw new Error('Use an exact HTTPS origin, or HTTP loopback for the explicitly local check, without a trailing slash.');
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must remain enabled.');
const password = process.env.REOPEN_JUDGE_PASSWORD;
if (!password || password.length < 12) {
  console.error('Set REOPEN_JUDGE_PASSWORD to a private 12+ character password in the environment.');
  process.exit(2);
}
let cookie, csrf, accountCreated = false, client, grant, project;
const receipt = { checked_at: new Date().toISOString(), origin: base, transport: 'Streamable HTTP',
  source_commit: process.env.GITHUB_SHA || null, tls_verified: false, protocol_version: null, client: 'official @modelcontextprotocol/sdk',
  data: 'explicit fictional illustrative notebook; not Bee data', checks: [], passed: false };
async function api(path, method = 'GET', body, expected = 200) {
  const response = await fetch(base + '/api' + path, { method, redirect: 'error', headers: {
    'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (origin.protocol === 'https:') receipt.tls_verified = true;
  assert.equal(response.status, expected, `Unexpected HTTP status for ${method} ${path.split('/')[1]}`);
  const data = await response.json();
  if (path === '/register') { cookie = response.headers.get('set-cookie')?.split(';')[0]; csrf = data.csrf; }
  return data;
}
try {
  await api('/register', 'POST', { name: 'Disposable MCP judge', email: `judge-${randomUUID()}@example.test`, password });
  accountCreated = true;
  project = (await api('/projects', 'POST', { illustrative: true }, 201)).project;
  grant = await api(`/projects/${project.id}/assistant-access`, 'POST', { expectedVersion: project.version, label: 'External judge SDK client', allowDrafts: false }, 201);
  assert.equal(grant.endpoint, base + '/mcp');
  const protocolFetch = async (url, options) => {
    const response = await fetch(url, { ...options, redirect: 'error' });
    if (options?.body && JSON.parse(options.body).method === 'initialize') {
      const initialized = await response.clone().json();
      receipt.protocol_version = initialized.result?.protocolVersion;
      assert.equal(receipt.protocol_version, '2025-11-25');
    }
    return response;
  };
  client = new Client({ name: 'reopen-https-judge', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(grant.endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${grant.token}`, Origin: base } }, fetch: protocolFetch,
  }));
  receipt.checks.push('Official client initialized and negotiated 2025-11-25');
  const tools = (await client.listTools()).tools.map(t => t.name).sort();
  assert.deepEqual(tools, ['reopen_draft_checklist_change', 'reopen_explain_decision', 'reopen_notebook_overview', 'reopen_review_evidence']);
  receipt.checks.push('Discovered all four implemented tools');
  const overview = await client.callTool({ name: 'reopen_notebook_overview', arguments: {} });
  assert.equal(overview.isError, undefined);
  assert.equal(overview.structuredContent.projectId, project.id);
  const decision = project.decisions[0];
  const explained = await client.callTool({ name: 'reopen_explain_decision', arguments: { decisionId: decision.id } });
  assert.equal(explained.structuredContent.rationale, decision.rationale);
  receipt.checks.push('Read scoped notebook and preserved decision rationale through real tool calls');
  const methodCheck = await fetch(grant.endpoint, { headers: { Authorization: `Bearer ${grant.token}`, Accept: 'text/event-stream' }, redirect: 'error' });
  assert.equal(methodCheck.status, 405); await methodCheck.body?.cancel();
  const denied = await fetch(grant.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${grant.token}`, Origin: 'https://invalid-origin.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 403); await denied.body?.cancel();
  receipt.checks.push('GET explicitly returns 405; invalid Origin returns 403');
  await api(`/projects/${project.id}/assistant-access/${grant.grant.id}`, 'DELETE', {});
  const revoked = await fetch(grant.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(revoked.status, 401); await revoked.body?.cancel();
  receipt.checks.push('Revocation rejects further MCP access');
  receipt.passed = true;
} catch {
  console.error('MCP judge verification failed. Inspect transport/TLS, configured origin and server status; no credential or notebook content is logged.');
  process.exitCode = 1;
} finally {
  await client?.close();
  if (accountCreated) {
    try { await api('/account', 'DELETE', { password }); receipt.checks.push('Disposable judge account and notebook removed'); }
    catch { receipt.cleanup_required = true; receipt.passed = false; process.exitCode = 1; }
  }
  const folder = resolve('.judge'); await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(resolve(folder, 'mcp-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(`MCP judge receipt saved at ${folder}/mcp-receipt.json; passed=${receipt.passed}, tls=${receipt.tls_verified}, protocol=${receipt.protocol_version}`);
}
