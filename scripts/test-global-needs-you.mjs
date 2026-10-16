// The all-projects Needs You page against mocked projects: every project's
// human beads and ready gates appear as collapsed rows, grouped and sorted at
// two levels (the choice survives a reload), summarised in a sidebar that
// filters and jumps, with actions scoped to the bead's own project.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.SCOTTY_TEST_URL;
assert.ok(base, "Set SCOTTY_TEST_URL to an isolated app server");

const bead = (id, title, extra = {}) => ({
  id, title, status: "open", issue_type: "task", priority: 2, labels: [], dependencies: [],
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", ...extra,
});
const projects = [
  { id: "alpha", name: "Alpha Project", path: null, hasBeads: true },
  { id: "beta", name: "Beta Project", path: null, hasBeads: true },
  { id: "quiet", name: "Quiet Project", path: null, hasBeads: true },
  { id: "demo", name: "Demo", path: null, hasBeads: true },
  { id: "nobeads", name: "No Beads", path: null, hasBeads: false },
];
const human = (id, title, priority, updated_at) => bead(id, title, { labels: ["human"], priority, updated_at });
const projectData = {
  alpha: [
    human("a-1", "Alpha decision", 1, "2026-09-03T00:00:00Z"),
    human("a-3", "Alpha naming", 3, "2026-09-05T00:00:00Z"),
    bead("a-2", "Alpha ordinary work"),
  ],
  beta: [
    human("b-1", "Beta decision", 3, "2026-09-01T00:00:00Z"),
    bead("b-gate", "Beta approval gate", { issue_type: "gate", await_type: "human", priority: 0, updated_at: "2026-09-02T00:00:00Z" }),
  ],
  quiet: [bead("q-1", "Quiet ordinary work")],
  demo: [human("d-1", "Demo decision", 2)],
};

const browser = await chromium.launch();
let page;
const errors = [];
const writes = [];
try {
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects } }));
  await page.route("**/api/viewer-mode", (route) => route.fulfill({ json: { readOnly: false } }));
  await page.route("**/api/p/**", (route) => {
    const req = route.request();
    const [, id, tail] = new URL(req.url()).pathname.match(/\/api\/p\/([^/]+)\/(.*)$/);
    if (req.method() !== "GET") {
      writes.push({ id, tail, method: req.method() });
      return route.fulfill({ json: projectData[id][0] });
    }
    if (tail === "beads/stream") return route.abort();
    if (tail === "beads") return route.fulfill({ json: { beads: projectData[id], meta: { kind: "bd", humanActor: "reviewer", humanAllowlist: ["reviewer"], pollIntervalMs: 300000 } } });
    return route.fulfill({ json: {} });
  });

  // The launcher has no project keyboard layer, but G U still works there.
  await page.goto(base);
  await page.getByText("Alpha Project", { exact: true }).waitFor();
  await page.keyboard.press("g");
  await page.keyboard.press("u");
  await page.waitForURL(/\/needs-you$/);

  const sidebar = page.getByRole("complementary", { name: "Needs You summary" });
  const main = page.locator("main");
  const order = () => main.locator("[data-item-key]").evaluateAll((els) => els.map((el) => el.dataset.itemKey));
  const expanded = () => main.locator('button[aria-label^="Collapse "]').count();
  await main.locator('[data-item-key="beta/b-1"]').waitFor();
  await page.getByText("4 waiting on you").waitFor();
  const body = await page.locator("body").innerText();
  for (const absent of ["Alpha ordinary work", "Quiet Project", "Demo decision", "No Beads"]) {
    assert.ok(!body.includes(absent), `${absent} is not listed`);
  }

  // Defaults: grouped by project, groups by most recent update, items by priority, all collapsed.
  assert.deepEqual(await order(), ["alpha/a-1", "alpha/a-3", "beta/b-gate", "beta/b-1"], "default grouping and sorting");
  assert.equal(await expanded(), 0, "cards start collapsed");
  assert.equal(await main.locator('[data-group-key="project:alpha"] h2 a').getAttribute("href"), "/p/alpha", "groups are labelled by project");
  assert.equal(await sidebar.locator("[data-sidebar-item]").count(), 0, "sidebar groups start collapsed");
  assert.match(await sidebar.locator('[data-group-key="project:beta"]').innerText(), /Beta Project\s*2/, "sidebar counts each project");

  // Group order is independent of item order.
  await sidebar.getByLabel("Order groups").selectOption("priority");
  assert.deepEqual(await order(), ["beta/b-gate", "beta/b-1", "alpha/a-1", "alpha/a-3"], "most urgent project first");
  await sidebar.getByLabel("Group by").selectOption("priority");
  await sidebar.getByLabel("Order groups").selectOption("name");
  await sidebar.getByLabel("Sort items").selectOption("newest");
  assert.deepEqual(await order(), ["beta/b-gate", "alpha/a-1", "alpha/a-3", "beta/b-1"], "priority groups, newest first within each");
  assert.match(await main.locator('[data-item-key="alpha/a-3"]').innerText(), /Alpha Project/, "rows in mixed groups name their project");
  await sidebar.getByLabel("Group by").selectOption("none");
  await sidebar.getByLabel("Sort items").selectOption("oldest");
  assert.deepEqual(await order(), ["beta/b-1", "beta/b-gate", "alpha/a-1", "alpha/a-3"], "oldest first across projects");
  assert.deepEqual(await sidebar.locator("[data-sidebar-item]").evaluateAll((els) => els.map((el) => el.dataset.sidebarItem)), await order(), "the sidebar follows the same sort");
  await page.reload();
  await main.locator('[data-item-key="alpha/a-1"]').waitFor();
  assert.equal(await sidebar.getByLabel("Group by").inputValue(), "none", "grouping persists");
  assert.equal(await sidebar.getByLabel("Sort items").inputValue(), "oldest", "item sort persists");
  await sidebar.getByLabel("Group by").selectOption("project");
  assert.equal(await sidebar.getByLabel("Order groups").inputValue(), "name", "group order persists");
  await sidebar.getByLabel("Sort items").selectOption("priority");

  // Sidebar: expand a project (remembered), filter by it, jump to a bead.
  await sidebar.getByRole("button", { name: "Expand Beta Project" }).click();
  await sidebar.locator('[data-sidebar-item="beta/b-1"]').waitFor();
  await page.reload();
  await sidebar.locator('[data-sidebar-item="beta/b-1"]').waitFor();
  assert.equal(await sidebar.locator('[data-sidebar-item^="alpha/"]').count(), 0, "only the expanded project shows its beads");
  await sidebar.getByRole("button", { name: "Alpha Project", exact: true }).click();
  assert.deepEqual(await order(), ["alpha/a-1", "alpha/a-3"], "clicking a project filters the list");
  await sidebar.locator('[data-sidebar-item="beta/b-1"]').click();
  await main.locator('[data-item-key="beta/b-1"] textarea').waitFor();
  assert.equal((await order()).length, 4, "jumping to another project's bead clears the filter");
  assert.equal(await expanded(), 1, "only the selected card opens");

  await main.locator('[data-item-key="beta/b-1"] textarea').fill("Go with option B");
  await main.locator('[data-item-key="beta/b-1"]').getByRole("button", { name: "Respond", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Responded to b-1"));
  assert.deepEqual(writes, [{ id: "beta", tail: "beads/b-1/human", method: "POST" }], "Respond posts to the bead's own project");

  await page.getByRole("button", { name: "Expand all" }).click();
  assert.equal(await expanded(), 4, "Expand all");
  await page.getByRole("button", { name: "Collapse all" }).click();
  assert.equal(await expanded(), 0, "Collapse all");

  await main.locator('[data-item-key="alpha/a-1"] button[data-keyboard-bead-id]').click();
  await main.getByRole("button", { name: "Alpha decision", exact: true }).click();
  await page.waitForURL(/\/p\/alpha\?bead=a-1$/);
  await page.getByRole("dialog").getByText("Alpha decision", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.keyboard.press("g");
  await page.keyboard.press("u");
  await page.waitForURL(/\/needs-you$/);

  // A project's own Needs You view starts expanded and can collapse.
  await page.goto(`${base}/p/alpha?view=needsyou`);
  await page.getByRole("button", { name: "Collapse a-1" }).waitFor();
  await page.getByRole("button", { name: "Collapse all" }).click();
  await page.getByRole("button", { name: "Expand a-1" }).waitFor();
  assert.equal(await page.locator('button[aria-label^="Collapse "]').count(), 0, "per-project Collapse all");

  assert.deepEqual(errors, []);
  console.log("PASS: global Needs You: collapsed rows from every project, two-level grouping and sorting shared with a filtering, jumping sidebar, persisted choices, Expand/Collapse all in both views, actions and links scoped to each project, G U from a project and the launcher");
} catch (error) {
  console.error({ errors, writes, url: page?.url(), body: page && (await page.locator("body").innerText()).slice(0, 3000) });
  throw error;
} finally {
  await browser.close();
}
