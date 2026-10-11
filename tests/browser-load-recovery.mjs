/** Local production UI; disposable account and fictional notebooks only. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createApp } from '../server/index.mjs';
const app = await createApp({ dbPath: ':memory:', noVite: true, production: false });
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const button = (name) => page.getByRole('button', { name, exact: true });
const choose = page.getByLabel('Choose notebook');
const settled = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' was not reached within 10 seconds')), 10000); })]);
  } finally { clearTimeout(timer); }
}
let release;
try {
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.getByLabel('Your name', { exact: true }).fill('Load recovery fixture');
  await page.getByLabel('Email', { exact: true }).fill('load-recovery@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Disposable-load-2026');
  await button('Create my private account').click();
  await button('Create your first notebook').click();
  await page.getByLabel('Notebook name').fill('First fixture notebook');
  await button('Create notebook').click();
  await page.waitForFunction(() => document.querySelector('#notebook-select').selectedOptions[0]?.textContent === 'First fixture notebook');
  const first = await choose.inputValue();
  await button('New notebook').click();
  await page.getByLabel('Notebook name').fill('Second fixture notebook');
  await button('Create notebook').click();
  await page.waitForFunction(() => document.querySelector('#notebook-select').selectedOptions[0]?.textContent === 'Second fixture notebook');
  const second = await choose.inputValue();
  const snapshot = app.db.prepare('SELECT document FROM projects WHERE id=?').get(second).document;
  const refresh = page.getByRole('button', { name: 'Refresh notebook', exact: true });
  // A preceding success must not remain visible beside the next load failure.
  await page.route(`**/api/projects/${second}`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Service temporarily unavailable' }) }));
  await refresh.click();
  await page.getByRole('alert').filter({ hasText: 'Service temporarily unavailable' }).waitFor();
  assert.equal(await page.getByRole('status').filter({ hasText: /Notebook refreshed|Notebook created/ }).count(), 0);
  assert.equal(await choose.inputValue(), second);
  assert.equal(app.db.prepare('SELECT document FROM projects WHERE id=?').get(second).document, snapshot);
  await page.unroute(`**/api/projects/${second}`);
  await refresh.click();
  await page.getByRole('status').filter({ hasText: 'Notebook refreshed.' }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  // Check the stale-switch outcome, guarded by both stale-epoch false return and interactionEpoch; neither guard is isolated.
  for (const failure of [false, true]) {
    let started;
    const seen = new Promise((resolve) => { started = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route(`**/api/projects/${second}`, async (route) => {
      const response = failure ? null : await route.fetch();
      started();
      await gate;
      if (response) await route.fulfill({ response });
      else await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Stale notebook error' }) });
    });
    await refresh.click();
    await within(seen, 'Delayed refresh route');
    await choose.selectOption(first);
    await page.waitForFunction((id) => document.querySelector('#notebook-select').value === id, first);
    const received = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${second}`));
    release();
    await received;
    await page.waitForFunction(() => !document.querySelector('[aria-label="Sign out"]').disabled);
    await settled();
    assert.equal(await choose.inputValue(), first);
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await page.getByRole('status').filter({ hasText: 'Notebook refreshed.' }).count(), 0);
    await page.unroute(`**/api/projects/${second}`);
    await choose.selectOption(second);
    await page.waitForFunction((id) => document.querySelector('#notebook-select').value === id, second);
  }
  // Failed switch must retry its requested notebook, not the notebook still on screen.
  await page.route(`**/api/projects/${first}`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Requested notebook unavailable' }) }));
  await choose.selectOption(first);
  await page.getByRole('alert').filter({ hasText: 'Requested notebook unavailable' }).waitFor();
  assert.equal(await choose.inputValue(), second);
  await page.unroute(`**/api/projects/${first}`);
  await button('Refresh latest').click();
  await page.waitForFunction((id) => document.querySelector('#notebook-select').value === id, first);
  await page.getByRole('status').filter({ hasText: 'Notebook refreshed.' }).waitFor();
  // A dismissed failed-load target cannot redirect a later editor save recovery.
  await choose.selectOption(second);
  await page.waitForFunction((id) => document.querySelector('#notebook-select').value === id, second);
  const firstBeforeEditor = app.db.prepare('SELECT document FROM projects WHERE id=?').get(first).document;
  await button('Checklist').click();
  await page.route(`**/api/projects/${first}`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Earlier switch failed' }) }));
  await choose.selectOption(first);
  await page.getByRole('alert').filter({ hasText: 'Earlier switch failed' }).waitFor();
  await page.unroute(`**/api/projects/${first}`);
  await button('Add checklist item').click();
  await page.getByLabel('Checklist item', { exact: true }).fill('Keep recovery writes in the second notebook');
  await page.route(`**/api/projects/${second}/commands`, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Notebook version changed' }) }));
  await button('Save to notebook').click();
  await page.getByRole('alert').filter({ hasText: 'Notebook version changed' }).waitFor();
  await page.unroute(`**/api/projects/${second}/commands`);
  await button('Refresh latest').click();
  await page.getByRole('status').filter({ hasText: 'Notebook refreshed.' }).waitFor();
  assert.equal(await choose.inputValue(), second);
  assert.equal(await page.getByLabel('Checklist item', { exact: true }).inputValue(), 'Keep recovery writes in the second notebook');
  await button('Save to notebook').click();
  await page.getByLabel('Checklist item', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(app.db.prepare('SELECT document FROM projects WHERE id=?').get(first).document, firstBeforeEditor);
  assert.equal(JSON.parse(app.db.prepare('SELECT document FROM projects WHERE id=?').get(second).document).checklist.length, 1);
  // Actual logout/login with saved notebooks; a failed load is not an empty account.
  await button('Sign out').click();
  await button('Sign in').click();
  await page.getByLabel('Email', { exact: true }).fill('load-recovery@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Disposable-load-2026');
  let signInStarted;
  const signInSeen = new Promise((resolve) => { signInStarted = resolve; });
  const signInGate = new Promise((resolve) => { release = resolve; });
  await page.route(`**/api/projects/${first}`, async (route) => {
    signInStarted();
    await signInGate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Sign-in notebook unavailable' }) });
  });
  await page.locator('form').getByRole('button', { name: 'Sign in', exact: true }).click();
  await within(signInSeen, 'Sign-in notebook route');
  await page.getByRole('heading', { name: 'Opening your notebook…', exact: true }).waitFor();
  assert.equal(await button('New notebook').isDisabled(), true);
  assert.equal(await button('Create your first notebook').count(), 0);
  assert.equal(await button('Explore an illustrative example').count(), 0);
  release();
  await page.getByRole('alert').filter({ hasText: 'Sign-in notebook unavailable' }).waitFor();
  assert.equal(await page.getByRole('status').filter({ hasText: 'Your private notebook is ready.' }).count(), 0);
  assert.equal(await button('Create your first notebook').count(), 0);
  await page.getByRole('heading', { name: 'Your notebook hasn’t opened yet.' }).waitFor();
  await page.unroute(`**/api/projects/${first}`);
  await button('Refresh latest').click();
  await page.waitForFunction((id) => document.querySelector('#notebook-select').value === id, first);
  await page.getByRole('status').filter({ hasText: 'Notebook refreshed.' }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  // A failed logout cancels a pending load without leaving a permanent opening state.
  await button('Sign out').click();
  await button('Sign in').click();
  await page.getByLabel('Email', { exact: true }).fill('load-recovery@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Disposable-load-2026');
  await page.route(`**/api/projects/${first}`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Load unavailable before logout test' }) }));
  await page.locator('form').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Load unavailable before logout test' }).waitFor();
  await page.unroute(`**/api/projects/${first}`);
  let pendingStarted;
  const pendingSeen = new Promise((resolve) => { pendingStarted = resolve; });
  const pendingGate = new Promise((resolve) => { release = resolve; });
  await page.route(`**/api/projects/${first}`, async (route) => {
    const response = await route.fetch();
    pendingStarted();
    await pendingGate;
    await route.fulfill({ response });
  });
  await choose.selectOption(first);
  await within(pendingSeen, 'Pending notebook route');
  await page.getByRole('heading', { name: 'Opening your notebook…', exact: true }).waitFor();
  await page.route('**/api/logout', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Logout temporarily unavailable' }) }));
  await button('Sign out').click();
  await page.getByRole('alert').filter({ hasText: 'Logout temporarily unavailable' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Opening your notebook…', exact: true }).count(), 0);
  await page.getByRole('heading', { name: 'Your notebook hasn’t opened yet.', exact: true }).waitFor();
  await page.getByText('Choose a notebook from the list to open your saved work.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Choose a notebook from the list or retry the failed request with Refresh latest.', { exact: true }).count(), 0);
  const cancelledResponse = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${first}`));
  release();
  await cancelledResponse;
  await settled();
  assert.equal(await choose.inputValue(), '');
  await page.unroute(`**/api/projects/${first}`);
  await page.unroute('**/api/logout');
  await choose.selectOption(first);
  await page.waitForFunction((id) => document.querySelector('#notebook-select').value === id, first);
  assert.deepEqual(errors, []);
  console.log('PASS: refresh/sign-in failure recovery targets the correct notebook; dismissed load errors cannot redirect editor writes. Existing notebook-switch race guards remain intact.');
} finally {
  release?.();
  await browser.close();
  await app.close();
}
