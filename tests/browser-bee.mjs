/** Real UI walkthrough; upstream data is an explicit fixture transport. */
import { chromium } from "playwright";
import { once } from "node:events";
import { scryptSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createApp } from "../server/index.mjs";
import { baseline, later, conversation, fixtureFetch } from "./bee-fixtures.mjs";
const calls = [],
  records = new Map([
    [101, conversation(101)],
    [102, conversation(102, later)],
  ]);
const app = await createApp({
  dbPath: ":memory:",
  noVite: true,
  production: false,
  beeProxyUrl: "http://127.0.0.1:8787",
  beeOwnerId: "browser-fixture-owner",
  beeFetch: fixtureFetch(records, calls),
});
app.db
  .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
  .run(
    "browser-fixture-owner",
    "browser-bee@example.test",
    "Bee Browser Review",
    "browser-fixture",
    scryptSync("Fixture-bee-browser-2026", "browser-fixture", 64).toString("hex"),
    new Date().toISOString(),
  );
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = `http://127.0.0.1:${app.server.address().port}`;
const out = ".impeccable/review/bee-";
async function capture(name) {
  await page.locator(".toast").waitFor({ state: "hidden", timeout: 8000 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out + name + ".png", fullPage: true });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "No horizontal overflow",
  );
}
async function tab(name) {
  if (
    await page
      .getByRole("button", { name: "Toggle navigation", exact: true })
      .isVisible()
      .catch(() => false)
  )
    await page.getByRole("button", { name: "Toggle navigation", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
try {
  await page.goto(base);
  await page.locator(".auth-tabs").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("browser-bee@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Fixture-bee-browser-2026");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Create your first notebook" }).click();
  await page.getByLabel("Notebook name").fill("Launch decisions · fixture walkthrough");
  await page
    .getByLabel("What is this project about?")
    .fill("Explicit connector fixtures; no real Bee recordings used.");
  await page.getByRole("button", { name: "Create notebook", exact: true }).click();
  await tab("Checklist");
  await page.getByRole("button", { name: "Add checklist item", exact: true }).click();
  await page
    .getByLabel("Checklist item", { exact: true })
    .fill("Run the online product walkthrough");
  await page.getByRole("button", { name: "Save to notebook", exact: true }).click();
  await tab("Sources");
  const connect = page.getByRole("button", { name: "Connect and browse" });
  assert.equal(await connect.isDisabled(), true);
  assert.equal(calls.length, 0);
  await page
    .getByLabel("I have permission to read this Bee account’s conversation titles and summaries.")
    .check();
  await connect.click();
  await page.locator(".bee-record").first().waitFor();
  await capture("browse-desktop");
  await page
    .locator(".bee-record")
    .filter({ hasText: "Fixture · Launch planning" })
    .getByRole("checkbox")
    .check();
  assert.equal(await page.getByRole("button", { name: "Import 1 and compare" }).isDisabled(), true);
  await page.getByLabel(/Save these transcripts and Bee’s processed context/).check();
  await page.getByRole("button", { name: "Import 1 and compare" }).click();
  await page.getByRole("status").filter({ hasText: "1 new" }).waitFor();
  await page.locator(".source-record").first().locator("summary").click();
  await page.getByRole("heading", { name: "Bee’s processed context" }).waitFor();
  await capture("source-desktop");
  await tab("Decisions");
  await page.getByRole("button", { name: "Record a decision", exact: true }).click();
  await page.getByLabel("The decision", { exact: true }).fill("Keep the walkthrough online");
  await page.getByLabel("Why it makes sense").fill("Use the working online flow at the venue.");
  await page.getByLabel("Supporting assumptions").fill("The venue has reliable internet");
  await page.getByLabel("Revisit this when").fill("Review if venue internet becomes unavailable.");
  await page
    .getByLabel("Original source (optional)")
    .selectOption({ label: "Fixture · Launch planning" });
  await page
    .getByLabel("Checklist anchor (optional)")
    .selectOption({ label: "Run the online product walkthrough" });
  await page.getByLabel("Exact original quote").fill(baseline);
  await page.getByRole("button", { name: "Save decision draft" }).click();
  const confirm = page.getByRole("button", { name: "Confirm this decision" });
  await confirm.waitFor();
  assert.equal(await confirm.isDisabled(), true);
  const wording = page.getByLabel(/I checked the transcript and surrounding context/);
  await wording.focus();
  await page.keyboard.press("Space");
  assert.equal(await wording.isChecked(), true);
  await confirm.click();
  await page.getByText("watching", { exact: true }).waitFor();
  await tab("Sources");
  await page.getByRole("button", { name: "Browse conversations" }).click();
  await page
    .locator(".bee-record")
    .filter({ hasText: "Fixture · Venue check" })
    .getByRole("checkbox")
    .check();
  await page.getByLabel(/Save these transcripts and Bee’s processed context/).check();
  await page.getByRole("button", { name: "Import 1 and compare" }).click();
  await page.getByRole("status").filter({ hasText: "1 new" }).waitFor();
  await tab("Decisions");
  await page.getByRole("button", { name: /Compare the evidence/ }).click();
  await page.getByRole("heading", { name: "Your judgment" }).waitFor();
  await capture("review-desktop");
  await page
    .getByLabel("Reason for your review")
    .fill("Fixture review: the later report changes our connectivity assumption.");
  await page.getByLabel("I reviewed the evidence and confirm that a premise changed.").check();
  await page.getByRole("button", { name: "Reopen decision", exact: true }).click();
  await page
    .getByLabel("Replacement checklist text")
    .fill("Prepare an offline product walkthrough");
  await page.getByRole("button", { name: "Preview exact change" }).click();
  await page.getByRole("button", { name: "Approve checklist change" }).click();
  await page.getByText("Approved and recorded. The checklist was updated.").waitFor();
  await tab("Sources");
  await page.getByRole("button", { name: "Browse conversations" }).click();
  await page
    .locator(".bee-record")
    .filter({ hasText: "Fixture · Venue check" })
    .getByRole("checkbox")
    .check();
  await page.getByLabel(/Save these transcripts and Bee’s processed context/).check();
  await page.getByRole("button", { name: "Import 1 and compare" }).click();
  await page.getByRole("status").filter({ hasText: "1 unchanged" }).waitFor();
  // Hold the HTTP response after the server has committed the import. Releasing
  // it in another view reproduces the stale callback without faking app state.
  const originalId = await page.getByLabel("Choose notebook").inputValue();
  await page.getByRole("button", { name: "New notebook", exact: true }).click();
  await page.getByLabel("Notebook name").fill("Second notebook · keep this selection");
  await page.getByRole("button", { name: "Create notebook", exact: true }).click();
  const secondId = await page.getByLabel("Choose notebook").inputValue();
  assert.notEqual(secondId, originalId);
  async function prepareDelayedImport() {
    await page.getByLabel("Choose notebook").selectOption(originalId);
    await tab("Sources");
    await page.getByRole("button", { name: "Browse conversations" }).click();
    await page
      .locator(".bee-record")
      .filter({ hasText: "Fixture · Venue check" })
      .getByRole("checkbox")
      .check();
    await page.getByLabel(/Save these transcripts and Bee’s processed context/).check();
    let release, started, completed;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const seen = new Promise((resolve) => {
      started = resolve;
    });
    const delivered = new Promise((resolve) => {
      completed = resolve;
    });
    const handler = async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      started();
      await gate;
      await route.fulfill({ response });
      completed();
    };
    await page.route("**/api/bee/import", handler);
    await page.getByRole("button", { name: "Import 1 and compare" }).click();
    await seen;
    return async () => {
      const received = page.waitForResponse((r) => r.url().endsWith("/api/bee/import"));
      release();
      await delivered;
      await received;
      await page.unroute("**/api/bee/import", handler);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    };
  }
  const finishSwitch = await prepareDelayedImport();
  await page.getByLabel("Choose notebook").selectOption(secondId);
  await page.waitForFunction(
    (id) => document.querySelector('[aria-label="Choose notebook"]').value === id,
    secondId,
  );
  await finishSwitch();
  assert.equal(await page.getByLabel("Choose notebook").inputValue(), secondId);
  assert.equal(await page.locator(".source-record").count(), 0);
  assert.equal(await page.locator(".bee-receipt").count(), 0);
  await capture("delayed-notebook-switch");

  const finishAccount = await prepareDelayedImport();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Your name", { exact: true }).fill("Independent second account");
  await page.getByLabel("Email", { exact: true }).fill("second-bee-browser@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Fixture-second-account-2026");
  await page.getByRole("button", { name: "Create my private account" }).click();
  await page.getByRole("button", { name: "Create your first notebook" }).click();
  await page.getByLabel("Notebook name").fill("Second account private notebook");
  await page.getByRole("button", { name: "Create notebook", exact: true }).click();
  await tab("Sources");
  const otherId = await page.getByLabel("Choose notebook").inputValue();
  await finishAccount();
  assert.equal(await page.getByLabel("Choose notebook").inputValue(), otherId);
  assert.equal(await page.locator(".source-record").count(), 0);
  assert.equal(await page.getByText("Fixture · Launch planning", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Fixture · Venue check", { exact: true }).count(), 0);
  assert.equal(await page.locator(".bee-record").count(), 0);
  assert.equal(await page.locator(".bee-receipt").count(), 0);
  await page.getByText("Set up a private connection", { exact: true }).waitFor();
  await capture("delayed-account-switch");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.locator(".auth-tabs").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("browser-bee@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Fixture-bee-browser-2026");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Choose notebook").selectOption(originalId);
  await tab("Sources");
  await page.getByRole("button", { name: "Browse conversations" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await capture("sources-mobile");
  assert.equal(
    await page
      .locator(".bee-record")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Disconnected." }).waitFor();
  const saved = JSON.parse(
    app.db.prepare("SELECT document FROM projects WHERE id=?").get(originalId).document,
  );
  assert.equal(saved.sources.length, 2);
  assert.equal(saved.checklist[0].text, "Prepare an offline product walkthrough");
  assert.ok(saved.sources.every((s) => s.origin === "bee_fixture"));
  assert.equal(
    saved.audit.some((a) => a.action === "source_wording_checked"),
    true,
  );
  await page.reload();
  await tab("Sources");
  await page.getByText("Not connected", { exact: true }).waitFor();
  await capture("disconnected-mobile");
  assert.equal(errors.length, 0, errors.join("\n"));
  writeFileSync(
    out + "browser-result.json",
    JSON.stringify(
      {
        passed: true,
        date: new Date().toISOString(),
        source: "Explicit fixtures only; no Bee device or live upstream API used",
        checks: [
          "consent-before-provider-read",
          "selected-finalized-import",
          "source-context",
          "keyboard-ASR-confirmation",
          "later-evidence",
          "reopen-and-separate-checklist-approval",
          "repeat-import-dedup",
          "delayed-import-notebook-switch",
          "delayed-import-logout-second-account",
          "mobile-no-overflow",
          "reduced-motion",
          "disconnect-retains-copies",
          "reload-retains-disconnection",
        ],
        requests: calls,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await app.close();
}
