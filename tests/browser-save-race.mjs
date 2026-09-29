/** Disposable local UI regression; all notebook content is fictional. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { chromium } from "playwright";
import { createApp } from "../server/index.mjs";

const app = await createApp({ dbPath: ":memory:", noVite: true, production: false });
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const choose = page.getByLabel("Choose notebook");
const section = (name) => page.getByRole("button", { name, exact: true }).click();
async function selectNotebook(id) {
  const loaded = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${id}`));
  await choose.selectOption(id);
  await loaded;
  await page.waitForFunction((value) => document.querySelector("#notebook-select").value === value, id);
}
let release;
try {
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.getByLabel("Your name", { exact: true }).fill("Save race fixture");
  await page.getByLabel("Email", { exact: true }).fill("save-race@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Disposable-notebook-2026");
  await section("Create my private account");
  await section("Create your first notebook");
  await page.getByLabel("Notebook name").fill("First fixture notebook");
  await section("Create notebook");
  await page.waitForFunction(() => document.querySelector("#notebook-select").selectedOptions[0]?.textContent === "First fixture notebook");
  const firstId = await choose.inputValue();
  await section("New notebook");
  await page.getByLabel("Notebook name").fill("Second fixture notebook");
  await section("Create notebook");
  await page.waitForFunction(() => document.querySelector("#notebook-select").selectedOptions[0]?.textContent === "Second fixture notebook");
  const secondId = await choose.inputValue();
  assert.notEqual(firstId, secondId);

  for (const failure of [false, true]) {
    await selectNotebook(firstId);
    await section("Checklist");
    await section("Add checklist item");
    await page.getByLabel("Checklist item", { exact: true }).fill("Saved only in the first notebook");
    let started;
    const seen = new Promise((resolve) => { started = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const handler = async (route) => {
      const response = failure ? null : await route.fetch();
      if (response) assert.equal(response.status(), 200);
      started();
      await gate;
      if (response) await route.fulfill({ response });
      else await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Delayed error from the first notebook" }),
      });
    };
    await page.route("**/api/projects/*/commands", handler);
    await section("Save to notebook");
    await seen;
    await selectNotebook(secondId);
    await section("New notebook");
    await page.getByLabel("Notebook name").fill("Keep this unsaved notebook draft");
    const received = page.waitForResponse((response) => response.url().includes("/commands"));
    release();
    await received;
    await page.waitForFunction(() => !document.querySelector('[aria-label="Sign out"]').disabled);
    assert.equal(await choose.inputValue(), secondId, "An old save must not switch the notebook back");
    assert.equal(await page.getByLabel("Notebook name").inputValue(), "Keep this unsaved notebook draft");
    assert.equal(await page.getByRole("alert").count(), 0, "An old failure belongs to the old notebook");
    await page.unroute("**/api/projects/*/commands", handler);
    await page.getByRole("button", { name: "Back to checklist", exact: true }).click();
  }
  const first = JSON.parse(app.db.prepare("SELECT document FROM projects WHERE id=?").get(firstId).document);
  const second = JSON.parse(app.db.prepare("SELECT document FROM projects WHERE id=?").get(secondId).document);
  assert.equal(first.checklist.length, 1, "Successful save remains persisted in its original notebook");
  assert.equal(second.checklist.length, 0, "The new notebook draft remains unsaved");
  assert.deepEqual(errors, []);
  console.log("PASS: delayed save and failure preserve the selected notebook and its unsaved draft; original save persists.");
} finally {
  release?.();
  await browser.close();
  await app.close();
}
