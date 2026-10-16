// The All Projects page has the same sidebar as /needs-you: Projects and Needs
// You link the two pages, the Needs You count matches /needs-you's total and
// updates live, and a project's own sidebar has no Projects item.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.SCOTTY_TEST_URL;
assert.ok(base, "Set SCOTTY_TEST_URL to an isolated app server");

const bead = (id, title, extra = {}) => ({
  id, title, status: "open", issue_type: "task", priority: 2, labels: [], dependencies: [],
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", ...extra,
});
const human = (id, title) => bead(id, title, { labels: ["human"] });
const projects = [
  { id: "alpha", name: "Alpha Project", path: null, hasBeads: true },
  { id: "beta", name: "Beta Project", path: null, hasBeads: true },
  { id: "demo", name: "Demo", path: null, hasBeads: true },
];
const projectData = {
  alpha: [human("a-1", "Alpha decision"), bead("a-2", "Alpha ordinary work")],
  beta: [
    human("b-1", "Beta decision"),
    bead("b-gate", "Beta approval gate", { issue_type: "gate", await_type: "human" }),
  ],
  demo: [human("d-1", "Demo decision")],
};

const browser = await chromium.launch();
let page;
const errors = [];
try {
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects } }));
  await page.route("**/api/viewer-mode", (route) => route.fulfill({ json: { readOnly: true } }));
  await page.route("**/api/config", (route) => route.fulfill({ json: { humanActor: "tester", humanAllowlist: ["tester"] } }));
  await page.route("**/api/p/**", (route) => {
    const [, id, tail] = new URL(route.request().url()).pathname.match(/\/api\/p\/([^/]+)\/(.*)$/);
    if (tail === "beads/stream") return route.abort();
    if (tail === "beads") return route.fulfill({ json: { beads: projectData[id], meta: { kind: "bd", humanActor: "tester", humanAllowlist: ["tester"], pollIntervalMs: 500 } } });
    return route.fulfill({ json: {} });
  });

  const sidebar = page.locator("aside").first();
  const nav = sidebar.getByRole("navigation");
  const navItems = async () => (await nav.getByRole("button").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());

  await page.goto(base);
  await page.getByText("Alpha Project", { exact: true }).waitFor();
  assert.match(await sidebar.innerText(), /All projects/, "the switcher stands for every project");
  assert.match(await sidebar.innerText(), /tester/, "the sidebar names the human actor from the app config");
  await nav.getByRole("button", { name: "Needs You 3" }).waitFor();
  assert.deepEqual(await navItems(), ["Projects", "Needs You 3", "Settings"], "demo is not counted");
  assert.match(await nav.getByRole("button", { name: "Projects" }).getAttribute("class"), /brand-weak/, "Projects is active");
  assert.equal(await page.getByTitle("Toggle theme").count(), 1, "the theme toggle lives only in the sidebar");
  await page.getByRole("button", { name: "Add project" }).waitFor();

  // Live: a new human bead shows without a reload.
  projectData.alpha.push(human("a-3", "Alpha naming"));
  await nav.getByRole("button", { name: "Needs You 4" }).waitFor();

  await nav.getByRole("button", { name: /^Needs You/ }).click();
  await page.waitForURL(/\/needs-you$/);
  await page.locator('[data-item-key="alpha/a-3"]').waitFor();
  assert.deepEqual(await navItems(), ["Projects", "Needs You 4", "Settings"], "/needs-you's total matches");

  await nav.getByRole("button", { name: "Projects" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.getByText("Alpha Project", { exact: true }).waitFor();

  await page.goto(`${base}/p/alpha?view=list`);
  await nav.getByRole("button", { name: "Board" }).waitFor();
  assert.ok(!(await navItems()).includes("Projects"), "a project's sidebar has no Projects item");

  assert.deepEqual(errors, []);
  console.log("PASS: launcher sidebar: same sidebar as /needs-you, live Needs You count matching its total, Projects and Needs You link the two pages, no Projects item inside a project");
} catch (error) {
  console.error({ errors, url: page?.url(), body: page && (await page.locator("body").innerText()).slice(0, 2000) });
  throw error;
} finally {
  await browser.close();
}
