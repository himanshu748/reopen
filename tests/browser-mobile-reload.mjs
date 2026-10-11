/** Held local bootstrap reproduces the old mobile-navigation readiness race. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';
import { openNotebookTab } from './browser-navigation.mjs';
const app = await createApp({ dbPath: ':memory:', noVite: true, production: false });
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let release;
try {
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.getByLabel('Your name', { exact: true }).fill('Mobile reload fixture');
  await page.getByLabel('Email', { exact: true }).fill('mobile-reload@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Disposable-mobile-2026');
  await page.getByRole('button', { name: 'Create my private account', exact: true }).click();
  await page.getByRole('button', { name: 'Create your first notebook', exact: true }).click();
  await page.getByLabel('Notebook name').fill('Mobile reload notebook');
  await page.getByRole('button', { name: 'Create notebook', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#notebook-select')?.value);
  const id = await page.getByLabel('Choose notebook').inputValue();
  await page.setViewportSize({ width: 390, height: 844 });
  let started;
  const seen = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/session', async (route) => {
    const response = await route.fetch();
    started();
    await gate;
    await route.fulfill({ response });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  let timer;
  try { await Promise.race([seen, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Bootstrap route not reached within 10 seconds')), 10000); })]); }
  finally { clearTimeout(timer); }
  await page.getByText('Opening your notebook…', { exact: true }).waitFor();
  // This is the exact condition the unchanged old helper mistakes for desktop.
  assert.equal(await page.getByRole('button', { name: 'Toggle navigation', exact: true }).isVisible(), false);
  const navigation = openNotebookTab(page, 'Sources');
  release();
  await navigation;
  assert.equal(await page.getByLabel('Choose notebook').inputValue(), id);
  assert.equal(await page.locator('nav button[aria-current="page"]').textContent(), 'Sources');
  // Once the sidebar is already open, a repeated helper call must not close it.
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Toggle navigation', exact: true }).getAttribute('aria-expanded'), 'true');
  await openNotebookTab(page, 'Checklist');
  assert.equal(await page.locator('nav button[aria-current="page"]').textContent(), 'Checklist');
  console.log('PASS: mobile tab navigation waits for held bootstrap and handles an already-open sidebar.');
} finally {
  release?.();
  await browser.close();
  await app.close();
}
