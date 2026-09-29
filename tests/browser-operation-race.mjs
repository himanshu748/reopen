/** Real UI interleaving with a disposable account and fictional example only. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { chromium } from "playwright";
import { createApp } from "../server/index.mjs";

const app = await createApp({ dbPath: ":memory:", noVite: true, production: false });
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const releases = [];
try {
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.getByLabel("Your name", { exact: true }).fill("Operation race fixture");
  await page.getByLabel("Email", { exact: true }).fill("operation-race@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Disposable-operation-2026");
  await page.getByRole("button", { name: "Create my private account", exact: true }).click();
  const example = page.getByRole("button", { name: "Explore an illustrative example", exact: true });
  await example.waitFor();
  let requests = 0;
  const started = [];
  const seen = [0, 1].map((i) => new Promise((resolve) => { started[i] = resolve; }));
  const gates = [0, 1].map((i) => new Promise((resolve) => { releases[i] = resolve; }));
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const index = requests++;
    assert.ok(index < 2, "Only the two deliberate requests should run");
    const response = index === 1 ? await route.fetch() : null;
    if (response) assert.equal(response.status(), 201);
    started[index]();
    await gates[index];
    if (response) await route.fulfill({ response });
    else await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Older example request failed" }) });
  });
  await example.click();
  await seen[0];
  await example.click();
  await seen[1];
  const olderReceived = page.waitForResponse((response) => response.url().endsWith("/api/projects") && response.status() === 409);
  releases[0]();
  await olderReceived;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole("button", { name: "Sign out", exact: true }).isDisabled(), true, "An older operation must not clear the newer operation's busy state");
  assert.equal(await page.getByRole("alert").count(), 0, "An older error must not replace the newer operation's feedback");
  const newerReceived = page.waitForResponse((response) => response.url().endsWith("/api/projects") && response.status() === 201);
  releases[1]();
  await newerReceived;
  await page.waitForFunction(() => !document.querySelector('[aria-label="Sign out"]').disabled);
  await page.getByRole("button", { name: "Explore an illustrative example", exact: true }).waitFor({ state: "hidden" });
  assert.equal(app.db.prepare("SELECT count(*) AS count FROM projects").get().count, 1);
  assert.equal(await page.getByRole("alert").count(), 0);
  console.log("PASS: older completion cannot clear a newer operation's busy state or replace its feedback.");
} finally {
  for (const release of releases) release();
  await browser.close();
  await app.close();
}
