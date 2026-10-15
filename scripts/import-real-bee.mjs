// Imports only explicitly selected real provider conversations. No transcript is logged or placed in a receipt.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBeeAdapter } from '../server/adapters.mjs';
import { importBeeSources } from '../server/domain.mjs';

let db;
try {
  const { DATA_PATH, REOPEN_BEE_OWNER_ID, REOPEN_BEE_PROJECT_ID, BEE_CONVERSATION_IDS, BEE_TOKEN, BEE_PROXY_URL } = process.env;
  if (!DATA_PATH || !existsSync(DATA_PATH) || !REOPEN_BEE_OWNER_ID || !REOPEN_BEE_PROJECT_ID || !BEE_CONVERSATION_IDS || (!BEE_TOKEN && !BEE_PROXY_URL))
    throw new Error('Set DATA_PATH to your existing Reopen SQLite database, REOPEN_BEE_OWNER_ID, REOPEN_BEE_PROJECT_ID, BEE_CONVERSATION_IDS and either BEE_TOKEN or BEE_PROXY_URL.');
  const ids = BEE_CONVERSATION_IDS.split(',').map(v => Number(v.trim()));
  if (!ids.length || ids.length > 5 || ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length)
    throw new Error('BEE_CONVERSATION_IDS must select 1–5 distinct positive IDs.');
  db = new DatabaseSync(DATA_PATH);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const row = db.prepare('SELECT document,version FROM projects WHERE id=? AND owner_id=?').get(REOPEN_BEE_PROJECT_ID, REOPEN_BEE_OWNER_ID);
  if (!row) throw new Error('The selected notebook does not belong to that owner.');
  const adapter = createBeeAdapter({ apiToken: BEE_TOKEN, proxyUrl: BEE_PROXY_URL });
  const sources = await Promise.all(ids.map(id => adapter.detail(id)));
  const { project, receipt } = importBeeSources(JSON.parse(row.document), sources, row.version);
  const changed = db.prepare('UPDATE projects SET version=?,document=? WHERE id=? AND owner_id=? AND version=?')
    .run(project.version, JSON.stringify(project), REOPEN_BEE_PROJECT_ID, REOPEN_BEE_OWNER_ID, row.version);
  if (!changed.changes) throw new Error('The notebook changed during retrieval. Nothing was imported; refresh before retrying.');
  const at = new Date().toISOString();
  const sanitized = { at, notebook_id: REOPEN_BEE_PROJECT_ID, conversation_ids: ids,
    source_ids: project.sources.filter(s => s.origin === 'bee_api' && ids.includes(s.provider?.conversationId)).map(s => s.id),
    counts: { selected: ids.length, added: receipt.added, revised: receipt.revised, unchanged: receipt.unchanged } };
  const folder = resolve('.impeccable/review/bee-receipts');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = resolve(folder, at.replaceAll(':', '-') + '.json');
  writeFileSync(file, JSON.stringify(sanitized, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log('Selected Bee conversations imported. A dated counts-and-IDs-only receipt was saved under .impeccable/review/bee-receipts/.');
  console.log('API retrieval does not independently verify a Bee device or Apple Watch recording. Keep hardware evidence separate.');
} catch (error) {
  console.error(error?.message || 'Bee import did not complete. No conversation content is printed.');
  process.exitCode = 1;
} finally { db?.close(); }
