// The all-projects Needs You page against mocked projects: every project's
// human beads and ready gates appear, grouped or sorted as chosen (and the
// choice survives a reload), and actions stay scoped to the bead's own project.
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
const projectData = {
  alpha: [
    bead("a-1", "Alpha decision", { labels: ["human"], priority: 1, updated_at: "2026-09-03T00:00:00Z" }),
    bead("a-2", "Alpha ordinary work"),
  ],
  beta: [
    bead("b-1", "Beta decision", { labels: ["human"], priority: 3, updated_at: "2026-09-01T00:00:00Z" }),
    bead("b-gate", "Beta approval gate", { issue_type: "gate", await_type: "human", priority: 0, updated_at: "2026-09-02T00:00:00Z" }),
  ],
  quiet: [bead("q-1", "Quiet ordinary work")],
  demo: [bead("d-1", "Demo decision", { labels: ["human"] })],
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

  await page.goto(`${base}/needs-you`);
  const alpha = page.locator('section[data-project-id="alpha"]');
  const beta = page.locator('section[data-project-id="beta"]');
  await alpha.getByText("Alpha decision", { exact: true }).waitFor();
  await beta.getByText("Beta decision", { exact: true }).waitFor();
  await beta.getByText("Beta approval gate", { exact: true }).waitFor();
  assert.equal(await alpha.getByRole("link", { name: "Alpha Project" }).getAttribute("href"), "/p/alpha", "section is labelled with its project");
  assert.equal(await beta.getByRole("link", { name: "Beta Project" }).getAttribute("href"), "/p/beta", "section is labelled with its project");
  await page.getByText("3 waiting on you").waitFor();
  const body = await page.locator("body").innerText();
  for (const absent of ["Alpha ordinary work", "Quiet Project", "Demo decision", "No Beads"]) {
    assert.ok(!body.includes(absent), `${absent} is not listed`);
  }

  // Ungrouped, every card names its project, and the sort spans projects.
  const order = () => page.locator("[data-item-project]").evaluateAll((els) =>
    els.map((el) => `${el.dataset.itemProject}/${el.querySelector("[data-keyboard-bead-id]").dataset.keyboardBeadId}`));
  await page.getByLabel("Group by").selectOption("none");
  await page.getByLabel("Sort").selectOption("oldest");
  assert.deepEqual(await order(), ["beta/b-1", "beta/b-gate", "alpha/a-1"], "oldest first across projects");
  assert.equal(await page.locator('[data-item-project="alpha"]').getByRole("link", { name: "Alpha Project" }).count(), 1, "ungrouped cards are labelled by project");
  await page.getByLabel("Sort").selectOption("priority");
  assert.deepEqual(await order(), ["beta/b-gate", "alpha/a-1", "beta/b-1"], "priority across projects");
  await page.reload();
  await page.locator('[data-item-project="alpha"]').waitFor();
  assert.equal(await page.getByLabel("Group by").inputValue(), "none", "grouping persists");
  assert.equal(await page.getByLabel("Sort").inputValue(), "priority", "sort persists");
  await page.getByLabel("Group by").selectOption("project");
  assert.deepEqual(await order(), ["alpha/a-1", "beta/b-gate", "beta/b-1"], "grouped by project, sorted within each");

  await beta.locator('[data-keyboard-bead-id="b-1"] textarea').fill("Go with option B");
  await beta.locator('[data-keyboard-bead-id="b-1"]').getByRole("button", { name: "Respond" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Responded to b-1"));
  assert.deepEqual(writes, [{ id: "beta", tail: "beads/b-1/human", method: "POST" }], "Respond posts to the bead's own project");

  await alpha.getByRole("button", { name: "Alpha decision", exact: true }).click();
  await page.waitForURL(/\/p\/alpha\?bead=a-1$/);
  await page.getByRole("dialog").getByText("Alpha decision", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.keyboard.press("g");
  await page.keyboard.press("u");
  await page.waitForURL(/\/needs-you$/);

  assert.deepEqual(errors, []);
  console.log("PASS: global Needs You lists human beads and gates from every project, grouped by project or not, sorted, persisted, with actions and links scoped to each project and reachable by G U");
} catch (error) {
  console.error({ errors, writes, url: page?.url(), body: page && (await page.locator("body").innerText()).slice(0, 3000) });
  throw error;
} finally {
  await browser.close();
}
