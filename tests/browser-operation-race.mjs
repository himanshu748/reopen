/** Production UI prevents overlapping example creation; fictional disposable account. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';
const app = await createApp({ dbPath: ':memory:', noVite: true, production: false });
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let release;
try {
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.getByLabel('Your name', { exact: true }).fill('Operation race fixture');
  await page.getByLabel('Email', { exact: true }).fill('operation-race@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Disposable-operation-2026');
  await page.getByRole('button', { name: 'Create my private account', exact: true }).click();
  const example = page.getByRole('button', { name: 'Explore an illustrative example', exact: true });
  await example.waitFor();
  let started, requests = 0, fetchedStatus;
  const seen = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    requests++;
    const response = await route.fetch();
    fetchedStatus = response.status();
    started();
    await gate;
    await route.fulfill({ response });
  });
  await example.click();
  let timer;
  try { await Promise.race([seen, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Example route not reached within 10 seconds')), 10000); })]); }
  finally { clearTimeout(timer); }
  assert.equal(await example.isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Create your first notebook', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Sign out', exact: true }).isDisabled(), true);
  assert.equal(fetchedStatus, 201);
  // Native click activation respects disabled state; no forced pointer interaction.
  await example.evaluate((element) => element.click());
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(requests, 1);
  release();
  await example.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('[aria-label="Sign out"]').disabled);
  assert.equal(app.db.prepare('SELECT count(*) AS count FROM projects').get().count, 1);
  assert.equal(await page.getByRole('alert').count(), 0);
  console.log('PASS: pending example creation disables overlapping welcome actions and persists one notebook.');
} finally {
  release?.();
  await browser.close();
  await app.close();
}
