// Browser regression fixture for ?bead=<ID>#<section> anchors and app launches
// (hooks/use-launch-queue.ts). It intercepts every project request.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.SCOTTY_TEST_URL;
assert.ok(base, "Set SCOTTY_TEST_URL to the running demo server");

const long = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} of a long description.`).join("\n\n");
const bead = (id, extra = {}) => ({
  id, title: `Bead ${id}`, status: "open", issue_type: "task", priority: 2, labels: [], dependencies: [],
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", description: long,
  // Every section is taller than the drawer, so each one can scroll to the top.
  notes: long, design: long, acceptance_criteria: long,
  comments: [{ id: 1, author: "reviewer", text: long, created_at: "2026-09-02T00:00:00Z" }], ...extra,
});
const beads = [bead("alpha"), bead("beta")];

const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => errors.push(error.message));
  // Stands in for Chrome's launchQueue, which only installed apps get.
  await page.addInitScript(() => {
    Object.defineProperty(window, "launchQueue", {
      value: { setConsumer: (c) => { window.__launch = (targetURL) => c({ targetURL }); } },
    });
  });
  await page.route("**/api/viewer-mode", (route) => route.fulfill({ json: { readOnly: true } }));
  await page.route("**/api/p/demo/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/beads/stream")) return route.abort();
    if (path.endsWith("/beads")) return route.fulfill({ json: { beads, meta: { kind: "demo", humanActor: "reviewer", humanAllowlist: ["reviewer"], pollIntervalMs: 300000 } } });
    return route.fulfill({ json: {} });
  });
  const dialog = page.getByRole("dialog");
  // Top of `#id` relative to the drawer's scroll box: near 0 once scrolled to it.
  const offset = (id) => page.evaluate((id) => {
    const el = document.getElementById(id);
    const box = el.closest(".bd-scroll");
    return Math.round(el.getBoundingClientRect().top - box.getBoundingClientRect().top);
  }, id);
  const scrollTop = () => page.evaluate(() => document.querySelector('[role="dialog"] .bd-scroll').scrollTop);
  const near = async (id, why) => {
    await page.waitForFunction(() => !location.hash);
    const top = await offset(id);
    assert.ok(top >= 0 && top < 40, `${why}: #${id} is ${top}px from the top`);
  };

  // No anchor opens the bead at the top.
  await page.goto(`${base}/p/demo?bead=alpha`);
  await dialog.getByText("Bead alpha", { exact: true }).waitFor();
  assert.equal(await scrollTop(), 0);

  for (const id of ["description", "dependencies", "subtasks", "design", "acceptance-criteria", "notes", "comments"]) {
    assert.equal(await dialog.locator(`#${id}`).count(), 1, `the drawer must render #${id}`);
  }

  // An anchor scrolls to its section once the bead has loaded, then leaves the URL.
  await page.goto("about:blank");
  await page.goto(`${base}/p/demo?bead=alpha#notes`);
  await dialog.getByText("Bead alpha", { exact: true }).waitFor();
  await near("notes", "a #notes link");
  assert.equal(page.url(), `${base}/p/demo?bead=alpha`);
  await page.goto("about:blank");
  await page.goto(`${base}/p/demo?bead=alpha#acceptance%20criteria`);
  await dialog.getByText("Bead alpha", { exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.match(page.url(), /#acceptance%20criteria$/, "an unknown anchor is left alone");

  // Launching the app: a plain launch (start URL) or the URL the page loaded for keeps the page.
  await page.goto(`${base}/p/demo?bead=alpha`);
  await dialog.getByText("Bead alpha", { exact: true }).waitFor();
  await page.evaluate(() => { window.__kept = true; });
  await page.evaluate((u) => window.__launch(u), `${base}/`);
  await page.evaluate((u) => window.__launch(u), `${base}/p/demo?bead=alpha`);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__kept), true, "a plain launch must not navigate");
  // A launch that only adds a fragment scrolls in place.
  await page.evaluate((u) => window.__launch(u), `${base}/p/demo?bead=alpha#comments`);
  await near("comments", "a fragment-only launch");
  assert.equal(await page.evaluate(() => window.__kept), true, "a fragment-only launch must not reload");
  // A launch for another bead opens it.
  await page.evaluate((u) => window.__launch(u), `${base}/p/demo?bead=beta#design`);
  await dialog.getByText("Bead beta", { exact: true }).waitFor();
  await near("design", "a launch for another bead");

  // Unknown bead and unknown project give a message, not a blank page.
  await page.goto(`${base}/p/demo?bead=nope`);
  await page.getByText("Bead nope not found in this project").waitFor();
  await page.goto(`${base}/p/no-such-project?bead=alpha`);
  await page.getByText("Couldn’t open this project").waitFor();

  assert.deepEqual(errors, []);
  console.log("PASS: #<section> anchors scroll the drawer once the bead loads, unknown anchors are left alone, app launches reuse the window (plain launches keep the page), and unknown beads and projects say so");
} finally {
  await browser.close();
}
