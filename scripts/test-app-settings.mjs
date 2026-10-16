// App-wide Settings: the sidebar outside any project links Needs You and
// Settings, /settings saves the same config as a project's Settings, and only
// a project's Settings shows its Project card.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.SCOTTY_TEST_URL;
assert.ok(base, "Set SCOTTY_TEST_URL to an isolated app server");

const config = { humanActor: "tester", humanAllowlist: ["tester"], pollIntervalMs: 5000, gamification: false, projects: [], orders: {} };
const browser = await chromium.launch();
const errors = [];
const puts = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/viewer-mode", (route) => route.fulfill({ json: { readOnly: false } }));
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [{ id: "demo", name: "Demo", path: null, hasBeads: true }] } }));
  await page.route("**/api/config", (route) => {
    const req = route.request();
    if (req.method() !== "PUT") return route.fulfill({ json: config });
    const patch = req.postDataJSON();
    puts.push(patch);
    return route.fulfill({ json: { ...config, ...patch } });
  });

  const nav = page.getByRole("navigation");
  const navItems = () => nav.getByRole("button").allInnerTexts();
  const projectCard = page.locator("section > div", { hasText: /^Project$/ });
  const save = () => page.getByRole("button", { name: "Save settings" }).click();

  await page.goto(`${base}/needs-you`);
  await page.getByRole("heading", { name: "Needs You" }).waitFor();
  assert.deepEqual((await navItems()).map((t) => t.trim()), ["Needs You", "Settings"]);

  await nav.getByRole("button", { name: "Settings" }).click();
  await page.waitForURL(/\/settings$/);
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.deepEqual((await navItems()).map((t) => t.trim()), ["Needs You", "Settings"]);
  const actor = page.getByLabel(/Human actor/);
  assert.equal(await actor.inputValue(), "tester");
  await page.getByText("Attribution", { exact: true }).waitFor();
  assert.equal(await projectCard.count(), 0, "/settings has no Project card");

  await actor.fill("someone");
  await save();
  await page.getByText("Settings saved").first().waitFor();
  assert.deepEqual(puts[0], { humanActor: "someone", humanAllowlist: ["tester"], pollIntervalMs: 5000 });

  await nav.getByRole("button", { name: "Needs You" }).click();
  await page.waitForURL(/\/needs-you$/);

  await page.goto(`${base}/p/demo?view=settings`);
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await projectCard.waitFor();
  await page.getByText("built-in sample data (no path)").waitFor();
  await save();
  await page.getByText("Settings saved").first().waitFor();
  assert.deepEqual(Object.keys(puts[1]).sort(), Object.keys(puts[0]).sort(), "a project's Settings saves the same config");

  assert.deepEqual(errors, []);
  console.log("PASS: all-projects sidebar links Settings, /settings saves app config without a Project card, project Settings keeps it");
} finally {
  await browser.close();
}
