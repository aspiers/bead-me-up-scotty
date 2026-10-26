// The keyboard layer outside a project, against mocked projects: ? and Ctrl-K
// work on All Projects, Settings and Needs You, the help lists only the keys
// that work on each page, project-only chords do nothing there, and on Needs
// You the bead keys act on the selected row.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.SCOTTY_TEST_URL;
assert.ok(base, "Set SCOTTY_TEST_URL to an isolated app server");

const bead = (id, title, extra = {}) => ({
  id, title, status: "open", issue_type: "task", priority: 2, labels: ["human"], dependencies: [],
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", ...extra,
});
const projects = [
  { id: "alpha", name: "Alpha Project", path: null, hasBeads: true },
  { id: "beta", name: "Beta Project", path: null, hasBeads: true },
];
const projectData = {
  alpha: [bead("a-1", "Alpha decision", { priority: 1 })],
  beta: [bead("b-1", "Beta decision", { priority: 3 })],
};

const browser = await chromium.launch();
let page;
const errors = [];
try {
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects } }));
  await page.route("**/api/viewer-mode", (route) => route.fulfill({ json: { readOnly: false } }));
  await page.route("**/api/p/**", (route) => {
    const req = route.request();
    const [, id, tail] = new URL(req.url()).pathname.match(/\/api\/p\/([^/]+)\/(.*)$/);
    assert.equal(req.method(), "GET", `no writes expected, got ${req.method()} ${tail}`);
    if (tail === "beads/stream") return route.abort();
    if (tail === "beads") return route.fulfill({ json: { beads: projectData[id], meta: { kind: "bd", humanActor: "reviewer", humanAllowlist: ["reviewer"], pollIntervalMs: 300000 } } });
    return route.fulfill({ json: {} });
  });

  const chord = async (key) => {
    await page.keyboard.press("g");
    await page.keyboard.press(key);
  };
  const help = page.getByRole("dialog", { name: /keyboard shortcuts/i });
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const helpLists = async (label) => (await help.getByText(label, { exact: true }).count()) > 0;
  const paletteLists = async (label) => (await palette.getByRole("option", { name: label }).count()) > 0;

  // Opens ? and Ctrl-K on the current page, checking which keys and commands each lists.
  async function checkHelpAndPalette(where, { shown, hidden, commands, absentCommands }) {
    await page.keyboard.press("?");
    await help.waitFor();
    for (const label of shown) assert.ok(await helpLists(label), `${where}: help lists "${label}"`);
    for (const label of hidden) assert.ok(!(await helpLists(label)), `${where}: help hides "${label}"`);
    await page.keyboard.press("Escape");
    await help.waitFor({ state: "detached" });

    await page.keyboard.press("Control+k");
    await palette.waitFor();
    for (const label of commands) assert.ok(await paletteLists(label), `${where}: palette offers "${label}"`);
    for (const label of absentCommands) assert.ok(!(await paletteLists(label)), `${where}: palette leaves out "${label}"`);
    await page.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });
  }

  const appKeys = ["Show keyboard shortcuts", "Toggle light / dark theme", "Needs You (all projects)", "Settings", "Choose a repository"];
  const projectKeys = ["Board", "Focus", "Create an issue", "Focus search", "Select issue to the left"];
  const appCommands = ["Switch project…", "Needs You (all projects)"];
  const projectCommands = ["Create bead…", "Board"];

  // All Projects.
  await page.goto(base);
  await page.getByText("Alpha Project", { exact: true }).waitFor();
  await checkHelpAndPalette("All Projects", {
    shown: appKeys,
    hidden: [...projectKeys, "Select next visible issue"],
    commands: appCommands,
    absentCommands: projectCommands,
  });
  await chord("b");
  await page.waitForTimeout(200);
  assert.equal(new URL(page.url()).pathname, "/", "a project-only chord does nothing outside a project");
  await chord("s");
  await page.waitForURL(/\/settings$/);

  // Settings: its shortcuts card matches what ? lists there.
  await page.getByText("Keyboard shortcuts", { exact: true }).first().waitFor();
  await checkHelpAndPalette("Settings", {
    shown: appKeys,
    hidden: [...projectKeys, "Select next visible issue"],
    commands: appCommands,
    absentCommands: projectCommands,
  });
  assert.equal(await page.getByText("Create an issue", { exact: true }).count(), 0, "the settings card leaves out project-only keys");
  await chord("y");
  await page.waitForURL(/\/needs-you$/);

  // Needs You: the app keys plus the bead keys that work on a list.
  const list = page.getByRole("complementary", { name: "Needs You list" });
  const pane = page.getByRole("region", { name: "Bead detail" });
  const current = () => list.locator('[aria-current="true"]').getAttribute("data-item-key");
  await list.locator('[data-item-key="beta/b-1"]').waitFor();
  await checkHelpAndPalette("Needs You", {
    shown: [...appKeys, "Select next visible issue", "Edit selected issue", "Set selected issue status"],
    hidden: projectKeys,
    commands: appCommands,
    absentCommands: projectCommands,
  });
  assert.equal(await current(), "alpha/a-1");
  await page.keyboard.press("j");
  assert.equal(await current(), "beta/b-1", "J moves down the inbox");
  await pane.getByRole("heading", { name: "Beta decision", exact: true }).waitFor();
  await page.keyboard.press("k");
  assert.equal(await current(), "alpha/a-1", "K moves up the inbox");

  await chord("e");
  await page.waitForTimeout(200);
  assert.equal(await pane.getByPlaceholder("Title").count(), 0, "G E is swallowed rather than editing the row");

  await page.keyboard.press("e");
  await pane.getByPlaceholder("Title").waitFor();
  await pane.getByRole("button", { name: "Cancel", exact: true }).click();
  await pane.getByPlaceholder("Title").waitFor({ state: "detached" });
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  await pane.getByText("Close reason — optional", { exact: true }).waitFor();
  assert.equal(await current(), "beta/b-1", "C acts on the selected row");
  // The reason box has focus now, so leave the row with the mouse.
  await list.locator('[data-item-key="alpha/a-1"]').click();
  await list.locator('[data-item-key="beta/b-1"]').click();
  await pane.getByRole("heading", { name: "Beta decision", exact: true }).waitFor();
  assert.equal(await pane.getByText("Close reason — optional", { exact: true }).count(), 0, "moving on drops the request");
  await list.locator('[data-item-key="alpha/a-1"]').click();

  await page.keyboard.press("s");
  await palette.getByPlaceholder("Set status…").waitFor();
  await palette.getByRole("option", { name: "In Progress" }).waitFor();
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "detached" });

  await page.keyboard.press("o");
  await page.waitForURL(/\/p\/alpha\?bead=a-1$/);

  // A project page keeps the full set.
  await page.getByRole("dialog").getByRole("heading", { name: "Alpha decision", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await checkHelpAndPalette("project", {
    shown: [...appKeys, ...projectKeys, "Select next visible issue"],
    hidden: [],
    commands: [...appCommands, ...projectCommands],
    absentCommands: [],
  });

  assert.deepEqual(errors, [], "no page errors");
  console.log("global keyboard: ok");
} catch (error) {
  if (page) await page.screenshot({ path: "tmp/test-global-keyboard-failure.png" }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
