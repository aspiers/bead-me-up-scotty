// Bead IDs named in bead text link to that bead, against the production build (`npm run build` first).
// Starts its own server with a throwaway config and intercepts the bead list, so no Beads database is touched.
// node scripts/test-bead-id-links.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "scotty-ids-")));
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

const bead = (id, title, extra = {}) => ({
  id, title, status: "open", issue_type: "task", priority: 2, labels: [], dependencies: [],
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", ...extra,
});
const beads = [
  bead("fx-a", "Start here, then fx-t", {
    status: "closed",
    description: [
      "Follow fx-b, or run `bd show fx-c`. Not fx-nope or [the doc](https://example.com/fx-b).",
      "", "```", "fx-b in a fence", "```",
    ].join("\n"),
    design: "Design names fx-d.",
    acceptance_criteria: "- Acceptance names fx-e.",
    notes: "Notes name fx-f.",
    close_reason: "Superseded by fx-g.",
    comments: [{ id: 1, author: "reviewer", text: "Comment names fx-h.", created_at: "2026-09-01T00:00:00Z" }],
  }),
  ...["b", "c", "d", "e", "f", "g", "h", "t"].map((s) => bead(`fx-${s}`, `Bead ${s.toUpperCase()}`)),
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
    if (p.endsWith("/files")) return route.fulfill({ json: { files: [] } });
    return route.fulfill({ json: {} });
  });

  const dialog = page.getByRole("dialog");
  const heading = dialog.getByRole("heading").first();
  const open = async () => {
    await page.goto(`${base}/p/fixture?bead=fx-a`);
    await heading.getByText("Start here", { exact: false }).waitFor();
  };
  // Each field's link opens its bead and joins the trail, so Back returns to fx-a.
  const follow = async (scope, id, title) => {
    await scope.getByRole("link", { name: id, exact: true }).click();
    await heading.getByText(title, { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("bead"), id);
    await page.getByTitle("Back to fx-a").click();
    await heading.getByText("Start here", { exact: false }).waitFor();
  };

  await open();
  await follow(heading, "fx-t", "Bead T");
  await follow(dialog, "fx-b", "Bead B");
  await follow(dialog, "fx-c", "Bead C");
  for (const [id, title] of [["fx-d", "Bead D"], ["fx-e", "Bead E"], ["fx-f", "Bead F"], ["fx-g", "Bead G"], ["fx-h", "Bead H"]]) {
    await follow(dialog, id, title);
  }

  assert.equal(await dialog.getByRole("link", { name: "fx-nope" }).count(), 0, "unknown IDs stay plain");
  await dialog.getByText("fx-nope", { exact: false }).first().waitFor();
  assert.equal(await dialog.locator("pre").getByRole("link").count(), 0, "fenced code stays plain");
  const doc = dialog.getByRole("link", { name: "the doc", exact: true });
  assert.equal(await doc.getAttribute("href"), "https://example.com/fx-b", "existing links keep their target");
  assert.equal(await dialog.getByRole("link", { name: "fx-b", exact: true }).count(), 1, "only the prose fx-b links");
  assert.equal(await dialog.getByRole("link", { name: "fx-c", exact: true }).locator("code").count(), 1, "inline code stays code");

  // The pencil still starts editing with a linked title.
  await dialog.getByTitle("Edit title & description").click();
  assert.equal(await dialog.getByPlaceholder("Title").inputValue(), "Start here, then fx-t");

  assert.deepEqual(errors, []);
  console.log("PASS: bead IDs link from title, description, inline code, design, acceptance, notes, close reason and comments; unknown IDs, fences and existing links stay as they were");
} catch (error) {
  console.error({ errors, url: page?.url(), body: page ? (await page.locator("body").innerText()).slice(0, 2000) : "" });
  throw error;
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
