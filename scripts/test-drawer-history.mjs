// Drawer Back/Forward history and Alt+Left/Right, against the production build (`npm run build` first).
// Starts its own server with a throwaway config and intercepts the bead list, so no Beads database is touched.
// node scripts/test-drawer-history.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "scotty-history-")));
const repo = path.join(tmp, "repo");
fs.mkdirSync(path.join(repo, ".beads"), { recursive: true });
fs.mkdirSync(path.join(tmp, "config", "bead-me-up-scotty"), { recursive: true });
fs.writeFileSync(path.join(tmp, "config", "bead-me-up-scotty", "config.json"), JSON.stringify({
  projects: [{ id: "fixture", name: "fixture", path: repo, addedAt: "2026-09-01T00:00:00Z" }],
}));

const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(path.resolve("node_modules/.bin/next"), ["start", "-p", String(port), "-H", "127.0.0.1"], {
  env: { ...process.env, XDG_CONFIG_HOME: path.join(tmp, "config"), SCOTTY_READ_ONLY: "" },
  stdio: ["ignore", "inherit", "inherit"],
});

const bead = (id, title, deps = []) => ({
  id, title, status: "open", issue_type: "task", priority: 2, labels: [],
  dependencies: deps.map((d) => ({ type: "blocks", depends_on_id: d })),
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
});
// A waits on B; B waits on C and D. Each drawer links to the beads it waits on.
const beads = [
  bead("hx-a", "Bead A", ["hx-b"]),
  bead("hx-b", "Bead B", ["hx-c", "hx-d"]),
  bead("hx-c", "Bead C"),
  bead("hx-d", "Bead D"),
];

const browser = await chromium.launch();
let page;
const errors = [];
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/api/viewer-mode`)).ok) break; } catch { /* not listening yet */ }
    assert.ok(i < 100, "server did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/p/fixture/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith("/beads/stream")) return route.abort();
    if (p.endsWith("/beads")) {
      return route.fulfill({ json: { beads, meta: { kind: "bd", humanActor: "reviewer", humanAllowlist: ["reviewer"], pollIntervalMs: 60_000 } } });
    }
    return route.fulfill({ json: {} });
  });

  const dialog = page.getByRole("dialog");
  // `q` is the board search; null means the filter is off.
  const at = async (letter, q = null) => {
    await dialog.getByRole("heading", { name: `Bead ${letter}`, exact: true }).waitFor();
    const params = new URL(page.url()).searchParams;
    assert.equal(params.get("bead"), `hx-${letter.toLowerCase()}`);
    assert.equal(params.get("q"), q, `search filter at ${letter}`);
  };
  const follow = async (letter, q = null) => {
    await dialog.getByText(`Bead ${letter}`, { exact: true }).click();
    await at(letter, q);
  };
  const forwardButtons = () => dialog.getByTitle(/^Forward to /).count();

  // A board filter changes while B is open, the way hooks/use-url-state.ts
  // pushes it: history entries A, B, B+filter, C.
  const filter = (q) => page.evaluate((q) => {
    const url = new URL(location.href);
    url.searchParams.set("q", q);
    history.pushState(null, "", url);
  }, q);

  await page.goto(`${base}/p/fixture?bead=hx-a`);
  await at("A");
  await follow("B");
  await filter("Bead");
  await at("B", "Bead");
  await follow("C", "Bead");

  // Real key presses step through browser history in order, so one step
  // undoes the filter.
  await page.keyboard.press("Alt+ArrowLeft"); await at("B", "Bead");
  await page.keyboard.press("Alt+ArrowLeft"); await at("B");
  await page.keyboard.press("Alt+ArrowLeft"); await at("A");
  await page.keyboard.press("Alt+ArrowRight"); await at("B");
  await page.keyboard.press("Alt+ArrowRight"); await at("B", "Bead");
  await page.keyboard.press("Alt+ArrowRight"); await at("C", "Bead");
  assert.equal(await forwardButtons(), 0, "no Forward at the end of the trail");

  // So does the browser's own Back/Forward, which mouse buttons use.
  await page.goBack(); await at("B", "Bead");
  await page.goForward(); await at("C", "Bead");

  // The header controls land on the bead they name, skipping the filter entry.
  await dialog.getByTitle("Back to hx-b", { exact: true }).click(); await at("B", "Bead");
  await dialog.getByTitle("Back to hx-a", { exact: true }).click(); await at("A");
  await dialog.getByTitle("Forward to hx-b", { exact: true }).click(); await at("B");
  await dialog.getByTitle("Forward to hx-c", { exact: true }).click(); await at("C", "Bead");

  // A reload keeps the trail, since each history entry records it.
  await page.reload(); await at("C", "Bead");
  await dialog.getByTitle("Back to hx-b", { exact: true }).click(); await at("B", "Bead");
  await page.keyboard.press("Alt+ArrowRight"); await at("C", "Bead");

  // A filter change or a new link from the middle drops the entries ahead, as
  // in a browser.
  await page.keyboard.press("Alt+ArrowLeft"); await at("B", "Bead");
  assert.equal(await forwardButtons(), 1);
  await filter("Bea"); await at("B", "Bea");
  assert.equal(await forwardButtons(), 0, "a filter change clears Forward");
  await follow("D", "Bea");
  await page.keyboard.press("Alt+ArrowLeft"); await at("B", "Bea");
  await dialog.getByTitle("Forward to hx-d", { exact: true }).waitFor();
  await page.keyboard.press("Alt+ArrowLeft"); await at("B", "Bead");
  await follow("D", "Bead");
  assert.equal(await forwardButtons(), 0, "following a new link clears Forward");
  await page.keyboard.press("Alt+ArrowLeft"); await at("B", "Bead");
  await page.keyboard.press("Alt+ArrowRight"); await at("D", "Bead");

  // Text fields keep Alt+arrows for themselves.
  await dialog.getByPlaceholder(/^Comment as/).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForTimeout(300);
  await at("D", "Bead");

  // Opening from the board starts a fresh trail.
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.locator("article").filter({ hasText: "Bead C" }).click();
  await at("C", "Bead");
  assert.equal(await dialog.getByTitle(/^Back/).count(), 0, "no Back on a fresh trail");
  assert.equal(await forwardButtons(), 0, "no Forward on a fresh trail");

  // The shortcuts are listed in the help dialog.
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.keyboard.press("?");
  await dialog.getByText("Back through the drawer's history", { exact: true }).waitFor();
  await dialog.getByText("Forward through the drawer's history", { exact: true }).waitFor();

  assert.deepEqual(errors, []);
  console.log("PASS: Alt+Left/Right and browser Back/Forward walk history through a mid-trail filter change; Back/Forward controls skip it; reload keeps the trail; a filter change or new link drops Forward; text fields keep Alt+arrows; board opens start fresh; shortcuts listed");
} catch (error) {
  console.error({ errors, url: page?.url(), body: page ? (await page.locator("body").innerText()).slice(0, 2000) : "" });
  throw error;
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
