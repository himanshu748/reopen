/** Fictional, disposable Chromium checks of stale proposals and approval history. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { chromium } from "playwright";
import { createApp } from "../server/index.mjs";

const app = await createApp({ dbPath: ":memory:", noVite: true, production: false });
app.server.listen(0, "127.0.0.1");
await once(app.server, "listening");
const browser = await chromium.launch({ headless: true });
const errors = [];
async function setup(name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.getByLabel("Your name", { exact: true }).fill("Fictional proposal review");
  await page.getByLabel("Email", { exact: true }).fill(`${name}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("Disposable-proposal-2026");
  await page.getByRole("button", { name: "Create my private account", exact: true }).click();
  await page.getByRole("button", { name: "Explore an illustrative example", exact: true }).click();
  await page.getByRole("button", { name: /Compare the evidence/ }).click();
  await page.locator(".candidate-row").filter({ hasText: "Reported change" }).click();
  await page.getByLabel("Reason for your review").fill("Fictional example: the confirmed report changes the premise.");
  await page.getByLabel("I reviewed the evidence and confirm that a premise changed.").check();
  await page.getByRole("button", { name: "Reopen decision", exact: true }).click();
  await page.getByLabel("Replacement checklist text").fill("Prepare the offline walkthrough");
  await page.getByRole("button", { name: "Preview exact change", exact: true }).click();
  await page.getByRole("button", { name: "Approve checklist change", exact: true }).waitFor();
  return page;
}
async function toggle(page) {
  await page.getByRole("button", { name: "Checklist", exact: true }).click();
  await page.locator(".checklist-row input").click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Sign out"]').disabled);
}
async function evidence(page) {
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page.locator(".candidate-row").filter({ hasText: "Reported change" }).click();
}
try {
  const checklist = await setup("checklist-stale");
  await toggle(checklist);
  // Returning to the same visible task still changes its version and invalidates approval.
  await checklist.locator(".checklist-row input").click();
  await checklist.waitForFunction(() => !document.querySelector('[aria-label="Sign out"]').disabled);
  await evidence(checklist);
  await checklist.getByRole("heading", { name: "This proposal needs a new review." }).waitFor();
  assert.match(await checklist.locator(".change-editor .notice-box").innerText(), /Current item · v3:.*incomplete/);
  assert.equal(await checklist.getByRole("button", { name: "Approve checklist change", exact: true }).count(), 0);
  assert.equal(await checklist.getByRole("button", { name: "Preview exact change", exact: true }).count(), 0);
  await checklist.getByRole("button", { name: "Return to decisions", exact: true }).scrollIntoViewIfNeeded();
  assert.ok(await checklist.evaluate(() => scrollY > 0), "Recovery begins below the top of the review");
  await checklist.getByRole("button", { name: "Return to decisions", exact: true }).click();
  await checklist.waitForFunction(() => scrollY === 0 && document.activeElement === document.querySelector(".page-heading h1"));
  await checklist.getByRole("button", { name: "Revise", exact: true }).click();
  await checklist.getByRole("button", { name: "Save decision draft", exact: true }).click();
  await checklist.getByRole("button", { name: "Confirm this decision", exact: true }).click();
  await checklist.getByRole("button", { name: /Compare the evidence/ }).click();
  await checklist.locator(".candidate-row").filter({ hasText: "Reported change" }).filter({ hasText: "pending" }).click();
  await checklist.getByRole("heading", { name: "Your judgment", exact: true }).waitFor();
  await checklist.getByLabel("Reason for your review").fill("Reassessed the fictional evidence against the current checklist.");
  await checklist.getByLabel("I reviewed the evidence and confirm that a premise changed.").check();
  await checklist.getByRole("button", { name: "Reopen decision", exact: true }).click();
  await checklist.getByLabel("Replacement checklist text").fill("Rehearse the current offline walkthrough");
  await checklist.getByRole("button", { name: "Preview exact change", exact: true }).click();
  await checklist.getByRole("button", { name: "Approve checklist change", exact: true }).click();
  await checklist.getByText("Approved and recorded. The checklist was updated.").waitFor();
  await checklist.getByRole("button", { name: "Checklist", exact: true }).click();
  await checklist.locator(".checklist-row").getByText("Rehearse the current offline walkthrough", { exact: true }).waitFor();

  const decision = await setup("decision-stale");
  await decision.getByRole("button", { name: "Decisions", exact: true }).click();
  await decision.getByRole("button", { name: "Revise", exact: true }).click();
  await decision.getByRole("button", { name: "Save decision draft", exact: true }).click();
  await evidence(decision);
  await decision.getByRole("heading", { name: "This proposal needs a new review." }).waitFor();
  assert.match(await decision.locator(".change-editor .notice-box").innerText(), /now v4 \(draft\)/);
  assert.equal(await decision.getByRole("button", { name: "Approve checklist change", exact: true }).count(), 0);
  await decision.locator(".change-editor").scrollIntoViewIfNeeded();
  if (process.env.SCREENSHOT_PATH) await decision.screenshot({ path: process.env.SCREENSHOT_PATH });
  await decision.setViewportSize({ width: 390, height: 844 });
  assert.equal(await decision.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Recovery text must fit mobile");

  const approved = await setup("approved-history");
  await approved.getByRole("button", { name: "Approve checklist change", exact: true }).click();
  await approved.getByText("Approved and recorded. The checklist was updated.").waitFor();
  await toggle(approved);
  await evidence(approved);
  assert.equal(await approved.getByRole("heading", { name: "This proposal needs a new review." }).count(), 0);
  await approved.getByText("This records the exact change approved at the time.").waitFor();
  assert.equal(await approved.getByRole("button", { name: "Approve checklist change", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: checklist and decision changes invalidate proposal actions; fresh review recovery works; approved history stays historical; mobile fits.");
} finally {
  await browser.close();
  await app.close();
}
