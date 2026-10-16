// The Needs You inbox against mocked projects: every project's human beads and
// ready gates in one list, grouped and sorted at two levels (choices survive a
// reload), with the selected bead's detail beside it. Actions reach the bead's
// own project and move on to the next item. A project that fails to load keeps
// one steady error line and is not polled again.
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
  { id: "broken", name: "Broken Project", path: null, hasBeads: true },
];
const human = (id, title, priority, updated_at) => bead(id, title, { labels: ["human"], priority, updated_at });
const projectData = {
  alpha: [
    { ...human("a-1", "Alpha decision", 1, "2026-09-03T00:00:00Z"), dependencies: [{ issue_id: "a-1", depends_on_id: "a-2", type: "blocks" }] },
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
let brokenLoads = 0;
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
    if (id === "broken") return (brokenLoads++, route.fulfill({ status: 500, json: { error: "database broken not found" } }));
    if (tail === "beads") return route.fulfill({ json: { beads: projectData[id], meta: { kind: "bd", humanActor: "reviewer", humanAllowlist: ["reviewer"], pollIntervalMs: 300000 } } });
    return route.fulfill({ json: {} });
  });

  // The launcher has no project keyboard layer, but G U still works there.
  await page.goto(base);
  await page.getByText("Alpha Project", { exact: true }).waitFor();
  await page.keyboard.press("g");
  await page.keyboard.press("u");
  await page.waitForURL(/\/needs-you$/);

  const list = page.getByRole("complementary", { name: "Needs You list" });
  const pane = page.getByRole("region", { name: "Bead detail" });
  const order = () => list.locator("[data-item-key]").evaluateAll((els) => els.map((el) => el.dataset.itemKey));
  const current = () => list.locator('[aria-current="true"]').getAttribute("data-item-key");
  const display = async (label, value) => {
    if (!(await page.getByRole("group", { name: "Display options" }).isVisible())) {
      await list.getByRole("button", { name: "Display" }).click();
    }
    await page.getByRole("group", { name: "Display options" }).getByLabel(label).selectOption(value);
  };
  await list.locator('[data-item-key="beta/b-1"]').waitFor();
  const listed = await list.innerText();
  for (const absent of ["Alpha ordinary work", "Quiet Project", "Demo decision", "No Beads"]) {
    assert.ok(!listed.includes(absent), `${absent} is not listed`);
  }

  // Defaults: grouped by project, groups by most recent update, items by priority; the first is open.
  assert.deepEqual(await order(), ["alpha/a-1", "alpha/a-3", "beta/b-gate", "beta/b-1"], "default grouping and sorting");
  assert.match(await list.locator('[data-group-key="project:beta"] h2').innerText(), /Beta Project\s*2/, "groups count their items");
  assert.equal(await current(), "alpha/a-1", "the first item is selected");
  await pane.getByRole("heading", { name: "Alpha decision", exact: true }).waitFor();

  // Links followed in the pane keep a trail back to the item.
  await pane.getByRole("button", { name: /Alpha ordinary work/ }).click();
  await pane.getByRole("heading", { name: "Alpha ordinary work", exact: true }).waitFor();
  await pane.getByTitle("Back to a-1").click();
  await pane.getByRole("heading", { name: "Alpha decision", exact: true }).waitFor();

  // Group order is independent of item order.
  await display("Order groups", "priority");
  assert.deepEqual(await order(), ["beta/b-gate", "beta/b-1", "alpha/a-1", "alpha/a-3"], "most urgent project first");
  await display("Group by", "priority");
  await display("Order groups", "name");
  await display("Sort items", "newest");
  assert.deepEqual(await order(), ["beta/b-gate", "alpha/a-1", "alpha/a-3", "beta/b-1"], "priority groups, newest first within each");
  assert.match(await list.locator('[data-item-key="alpha/a-3"]').innerText(), /Alpha Project/, "rows in mixed groups name their project");
  await display("Group by", "none");
  await display("Sort items", "oldest");
  assert.deepEqual(await order(), ["beta/b-1", "beta/b-gate", "alpha/a-1", "alpha/a-3"], "oldest first across projects");
  await page.keyboard.press("Escape");
  await page.getByRole("group", { name: "Display options" }).waitFor({ state: "detached" });
  await page.reload();
  await list.locator('[data-item-key="alpha/a-1"]').waitFor();
  await display("Group by", "project");
  const options = page.getByRole("group", { name: "Display options" });
  assert.equal(await options.getByLabel("Order groups").inputValue(), "name", "group order persists");
  assert.equal(await options.getByLabel("Sort items").inputValue(), "oldest", "item sort persists");
  await display("Sort items", "priority");
  await page.keyboard.press("Escape");

  // A folded group stays folded after a reload.
  await list.getByRole("button", { name: /Beta Project/ }).click();
  assert.deepEqual(await order(), ["alpha/a-1", "alpha/a-3"], "folding a group hides its rows");
  await page.reload();
  await list.locator('[data-item-key="alpha/a-1"]').waitFor();
  assert.deepEqual(await order(), ["alpha/a-1", "alpha/a-3"], "the fold persists");
  await list.getByRole("button", { name: /Beta Project/ }).click();

  // Both side columns resize by dragging their inner edge, and keep their width.
  const width = (loc) => loc.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  const drag = async (handle, dx) => {
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(50, box.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 5 });
    await page.mouse.up();
  };
  const props = pane.getByRole("separator", { name: "Resize properties" }).locator("..");
  const listWidth = await width(list);
  const propsWidth = await width(props);
  await drag(list.getByRole("separator", { name: "Resize list" }), 100);
  assert.equal(await width(list), listWidth + 100, "dragging the list's edge widens it");
  await drag(pane.getByRole("separator", { name: "Resize properties" }), -60);
  assert.equal(await width(props), propsWidth + 60, "dragging the properties column's edge widens it");
  await page.reload();
  await list.locator('[data-item-key="alpha/a-1"]').waitFor();
  await pane.getByRole("heading", { name: "Alpha decision", exact: true }).waitFor();
  assert.equal(await width(list), listWidth + 100, "the list keeps its width");
  assert.equal(await width(props), propsWidth + 60, "the properties column keeps its width");

  // J/K move through the list and the pane follows.
  await list.locator('[data-item-key="alpha/a-1"]').click();
  await page.keyboard.press("j");
  assert.equal(await current(), "alpha/a-3");
  await pane.getByRole("heading", { name: "Alpha naming", exact: true }).waitFor();
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  assert.equal(await current(), "beta/b-gate");

  // Respond posts to the bead's own project, then the next item opens.
  await page.keyboard.press("j");
  assert.equal(await current(), "beta/b-1");
  await pane.getByPlaceholder("Answer the agent's question…").fill("Go with option B");
  await pane.getByRole("button", { name: "Respond", exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Responded to b-1"));
  assert.deepEqual(writes, [{ id: "beta", tail: "beads/b-1/human", method: "POST" }], "Respond posts to the bead's own project");
  assert.equal(await current(), "beta/b-gate", "the next item opens after answering");

  await page.keyboard.press("g");
  await page.keyboard.press("u");
  await page.waitForURL(/\/needs-you$/);

  // After its retries fail, a broken project's error stays put and polling stops.
  const brokenAlert = list.getByRole("alert").filter({ hasText: "Broken Project" });
  await brokenAlert.waitFor({ timeout: 15000 });
  const loadsAtError = brokenLoads;
  for (let t = 0; t < 24; t++) {
    assert.ok(await brokenAlert.isVisible(), "the error line does not flicker");
    await page.waitForTimeout(250);
  }
  assert.equal(brokenLoads, loadsAtError, "a project that never loaded is not polled again");

  // A project's own Needs You view is the same inbox, without project groups.
  await page.goto(`${base}/p/alpha?view=needsyou`);
  await list.locator('[data-item-key="alpha/a-3"]').waitFor();
  assert.deepEqual(await order(), ["alpha/a-1", "alpha/a-3"], "a project's own list");
  assert.equal(await list.locator("h2").count(), 0, "no project group headers in one project");
  await pane.getByRole("heading", { name: "Alpha decision", exact: true }).waitFor();
  await page.keyboard.press("j");
  await pane.getByRole("heading", { name: "Alpha naming", exact: true }).waitFor();
  await page.keyboard.press("g");
  await page.keyboard.press("u");
  await page.waitForURL(/\/needs-you$/);

  assert.deepEqual(errors, []);
  console.log("PASS: Needs You inbox: rows from every project, two-level grouping and sorting in a Display menu, persisted choices and folds, resizable list and properties columns, a detail pane with its own link trail, J/K, Respond scoped to the project and advancing, a steady error line for a broken project, the same inbox in one project, G U from a project and the launcher");
} catch (error) {
  console.error({ errors, writes, url: page?.url(), body: page && (await page.locator("body").innerText()).slice(0, 3000) });
  throw error;
} finally {
  await browser.close();
}
