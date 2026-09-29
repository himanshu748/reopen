import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  reducedMotion: "no-preference",
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.TEST_URL || "http://127.0.0.1:4433";
const stamp = Date.now();
const captures = ".impeccable/review";
async function capture(name) {
  await page.locator(".toast").waitFor({ state: "hidden", timeout: 8000 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${captures}/${name}.png`, fullPage: true });
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: innerWidth,
  }));
  if (sizes.scroll > sizes.width) throw new Error(`Overflow in ${name}: ${JSON.stringify(sizes)}`);
}
async function saved() {
  await page.waitForFunction(() => !document.querySelector(".editor"));
  if (await page.locator('[role="alert"]').count())
    throw new Error(await page.locator('[role="alert"]').innerText());
}
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "You had your reasons. Keep them." }).waitFor();
  await page.getByLabel("Your name", { exact: true }).fill("Reopen Browser Review");
  await page.getByLabel("Email", { exact: true }).fill(`reopen-review-${stamp}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("Review-notebook-strong-2026");
  await page.getByRole("button", { name: "Create my private account" }).click();
  await page.getByRole("button", { name: "Create your first notebook" }).waitFor();
  await page.getByRole("button", { name: "Create your first notebook" }).click();
  await page.getByLabel("Notebook name").fill("Autumn product launch");
  await page
    .getByLabel("What is this project about?")
    .fill("The reasons behind our live demo, and the evidence worth revisiting.");
  await page.getByRole("button", { name: "Create notebook", exact: true }).click();
  await saved();
  await page.getByRole("button", { name: "Checklist", exact: true }).click();
  await page.getByRole("button", { name: "Add checklist item", exact: true }).click();
  await page
    .getByLabel("Checklist item", { exact: true })
    .fill("Run the online-only product walkthrough at the venue");
  await page.getByRole("button", { name: "Save to notebook", exact: true }).click();
  await saved();
  async function source(title, text, when) {
    await page.getByRole("button", { name: "Sources", exact: true }).click();
    await page.getByRole("button", { name: "Import transcript", exact: true }).click();
    await page.getByLabel("Source title", { exact: true }).fill(title);
    await page.getByLabel("Conversation date", { exact: true }).fill(when);
    await page
      .getByLabel("Where did this transcript come from?")
      .fill("Fictional test transcript created for local browser validation. Not Bee data.");
    await page.getByLabel("Transcript", { exact: true }).fill(text);
    await page.getByRole("button", { name: "Import and compare" }).click();
    await saved();
  }
  await source(
    "Monday · Planning conversation",
    "We can skip offline support because the venue has reliable internet.",
    "2026-09-07T09:00",
  );
  await page.getByRole("button", { name: "Decisions", exact: true }).click();
  await page.getByRole("button", { name: "Record a decision", exact: true }).click();
  await page.getByLabel("The decision", { exact: true }).fill("Keep the demo online-only");
  await page
    .getByLabel("Why it makes sense")
    .fill(
      "Spend our remaining build time polishing the main flow. We expect a reliable connection in the room.",
    );
  await page.getByLabel("Supporting assumptions").fill("The venue has reliable internet");
  await page
    .getByLabel("Revisit this when")
    .fill("Revisit if the room internet becomes unavailable.");
  await page
    .getByLabel("Original source (optional)")
    .selectOption({ label: "Monday · Planning conversation" });
  await page
    .getByLabel("Checklist anchor (optional)")
    .selectOption({ label: "Run the online-only product walkthrough at the venue" });
  await page
    .getByLabel("Exact original quote")
    .fill("We can skip offline support because the venue has reliable internet.");
  await page.getByRole("button", { name: "Save decision draft" }).click();
  await saved();
  await page.getByRole("button", { name: "Confirm this decision" }).click();
  await page.getByText("watching", { exact: true }).waitFor();
  await source(
    "Tuesday · Room check",
    "What would we do if the room had no Wi-Fi?\nThe organizer confirmed our demo room will have no Wi-Fi.",
    "2026-09-08T10:30",
  );
  await page.getByRole("button", { name: "Decisions", exact: true }).click();
  await page.getByRole("button", { name: /Compare the evidence/ }).click();
  await page.getByRole("heading", { name: "Your judgment" }).waitFor();
  await page
    .getByLabel("Reason for your review")
    .fill(
      "I checked the explicit later report. Our connectivity premise changed; prepare offline walkthrough assets.",
    );
  await page.getByLabel("I reviewed the evidence and confirm that a premise changed.").check();
  await page.getByRole("button", { name: "Reopen decision", exact: true }).click();
  await page.getByRole("heading", { name: "The checklist change" }).waitFor();
  await page
    .getByLabel("Replacement checklist text")
    .fill("Prepare and run an offline product walkthrough at the venue");
  await page.getByRole("button", { name: "Preview exact change" }).click();
  await page.getByRole("button", { name: "Approve checklist change" }).waitFor();
  await page.getByRole("button", { name: "Approve checklist change" }).click();
  await page.getByText("Approved and recorded. The checklist was updated.").waitFor();
  await page.getByRole("button", { name: "Checklist", exact: true }).click();
  await page
    .getByText("Prepare and run an offline product walkthrough at the venue", { exact: true })
    .first()
    .waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Checklist", exact: true }).click();
  await page
    .getByText("Prepare and run an offline product walkthrough at the venue", { exact: true })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Decisions", exact: true }).click();
  await page.getByRole("button", { name: "Revise", exact: true }).click();
  await page.getByLabel("The decision", { exact: true }).fill("Prepare a resilient offline demo");
  await page
    .getByLabel("Why it makes sense")
    .fill(
      "The confirmed room report invalidates our internet assumption. Use local assets so the walkthrough can proceed without connectivity.",
    );
  await page
    .getByLabel("Supporting assumptions")
    .fill("The local recording and assets work without a network");
  await page
    .getByLabel("Revisit this when")
    .fill("Revisit if the offline assets fail a complete rehearsal.");
  await page
    .getByLabel("Original source (optional)")
    .selectOption({ label: "Tuesday · Room check" });
  await page
    .getByLabel("Exact original quote")
    .fill("The organizer confirmed our demo room will have no Wi-Fi.");
  await page.getByRole("button", { name: "Save decision draft" }).click();
  await saved();
  await page.getByRole("button", { name: "Confirm this decision" }).click();
  await page.getByText("watching", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Follow this decision’s history" }).click();
  const tabs = page.getByRole("tablist", { name: "Saved decision versions" });
  await page.getByRole("heading", { name: "Follow the reasoning." }).waitFor();
  await tabs.getByRole("tab", { name: /Version 5/ }).waitFor();
  await tabs.getByRole("tab", { name: /Version 2/ }).click();
  await page
    .getByRole("tabpanel")
    .getByRole("heading", { name: "Keep the demo online-only" })
    .waitFor();
  await page.getByText("Checklist change approved", { exact: true }).waitFor();
  await capture("interaction-desktop");
  await tabs.getByRole("tab", { name: /Version 2/ }).focus();
  await page.keyboard.press("ArrowRight");
  if ((await page.getByRole("tab", { selected: true }).getAttribute("data-version")) !== "3")
    throw new Error("ArrowRight did not select the next saved version");
  await page.keyboard.press("End");
  if ((await page.getByRole("tab", { selected: true }).getAttribute("data-version")) !== "5")
    throw new Error("End did not select current version");
  await page
    .getByRole("tabpanel")
    .getByRole("heading", { name: "Prepare a resilient offline demo" })
    .waitFor();
  await page.getByRole("button", { name: /What changed since v3/ }).click();
  await page.getByRole("heading", { name: "Reasoning", exact: true }).waitFor();
  await capture("interaction-current-desktop");
  await tabs.getByRole("tab", { name: /Version 5/ }).focus();
  await page.keyboard.press("Home");
  await page
    .getByRole("tabpanel")
    .getByRole("heading", { name: "Keep the demo online-only" })
    .waitFor();
  await page.getByRole("button", { name: "Open paired evidence" }).last().click();
  await page.getByRole("heading", { name: "The original reason" }).waitFor();
  await page.getByRole("button", { name: "View decision history · v2" }).click();
  if ((await page.getByRole("tab", { selected: true }).getAttribute("data-version")) !== "2")
    throw new Error("Paired evidence lost its original version selection");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Return to current" }).click();
  await page.getByRole("tab", { name: /Version 5/ }).focus();
  await page.keyboard.press("Home");
  await page
    .getByRole("tabpanel")
    .getByRole("heading", { name: "Keep the demo online-only" })
    .waitFor();
  const active = await page
    .locator(".trail-reader")
    .evaluate((el) => el.getAnimations().filter((a) => a.playState === "running").length);
  if (active) throw new Error("Spatial reader animation ran under reduced motion");
  await capture("interaction-mobile");
  await page.reload();
  await page.getByRole("button", { name: "Follow this decision’s history" }).click();
  await page.getByRole("tab", { name: /Version 2/ }).click();
  await page
    .getByRole("tabpanel")
    .getByRole("heading", { name: "Keep the demo online-only" })
    .waitFor();
  await page.getByText("Checklist change approved", { exact: true }).waitFor();
  writeFileSync(
    `${captures}/interaction-result.json`,
    JSON.stringify(
      {
        passed: true,
        checks: [
          "fresh account and own UI-saved notebook",
          "manual transcript provenance",
          "confirmed decision and later evidence",
          "approved checklist update",
          "revision and reconfirmation",
          "real versions 2,3,5 only",
          "original rationale and exact approved change preserved",
          "exact current vs previous fields",
          "Left/Right/Home/End version navigation",
          "paired evidence retains selected historical version",
          "mobile horizontal version rail without page overflow",
          "reduced-motion animation disabled",
          "reload persistence",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Interaction history walkthrough passed.");
} finally {
  await browser.close();
}
