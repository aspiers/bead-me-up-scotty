// Repository file links in bead text, against the production build (`npm run build` first).
// Starts its own server with a throwaway config and a stub opener that records
// its arguments, so no real desktop app opens and the user's projects are untouched.
// node scripts/test-repo-file-links.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "scotty-files-")));
const repo = path.join(tmp, "repo");
const opened = path.join(tmp, "opened.log");
fs.mkdirSync(path.join(repo, ".beads"), { recursive: true });
fs.mkdirSync(path.join(repo, "src"));
fs.writeFileSync(path.join(repo, "src", "a.ts"), "export {};\n");
fs.writeFileSync(path.join(tmp, "outside.txt"), "secret\n");
fs.symlinkSync(path.join(tmp, "outside.txt"), path.join(repo, "escape.txt"));
const stub = path.join(tmp, "opener.sh");
fs.writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${opened}'\n`, { mode: 0o755 });
fs.mkdirSync(path.join(tmp, "config", "bead-me-up-scotty"), { recursive: true });
fs.writeFileSync(path.join(tmp, "config", "bead-me-up-scotty", "config.json"), JSON.stringify({
  projects: [{ id: "fixture", name: "fixture", path: repo, addedAt: "2026-09-01T00:00:00Z" }],
}));

const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(path.resolve("node_modules/.bin/next"), ["start", "-p", String(port), "-H", "127.0.0.1"], {
  env: { ...process.env, XDG_CONFIG_HOME: path.join(tmp, "config"), SCOTTY_OPEN_COMMAND: stub, SCOTTY_READ_ONLY: "" },
  stdio: ["ignore", "inherit", "inherit"],
});
const readOpened = () => (fs.existsSync(opened) ? fs.readFileSync(opened, "utf8") : "");

const browser = await chromium.launch();
let page;
const errors = [];
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/api/viewer-mode`)).ok) break; } catch { /* not listening yet */ }
    assert.ok(i < 100, "server did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
  const files = `${base}/api/p/fixture/files`;
  const query = ["src/a.ts", "src/a.ts:12:3", "missing.ts", "../outside.txt", "escape.txt", "src", "/etc/hostname"];
  const listed = await (await fetch(`${files}?${query.map((p) => `path=${encodeURIComponent(p)}`).join("&")}`)).json();
  assert.deepEqual(listed.files, ["src/a.ts", "src/a.ts:12:3"]);

  const open = (p, headers = {}) => fetch(files, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ path: p }),
  });
  for (const [p, status] of [["../outside.txt", 403], ["escape.txt", 403], ["missing.ts", 404], ["src", 400], ["/etc/hostname", 400], ["", 400]]) {
    assert.equal((await open(p)).status, status, `opening ${JSON.stringify(p)}`);
  }
  assert.equal((await open("src/a.ts", { Origin: "https://unrelated.example" })).status, 403, "foreign origin");
  assert.equal((await open("src/a.ts", { Cookie: "scotty-viewer-mode=read-only" })).status, 403, "viewer mode");
  assert.equal(readOpened(), "", "no rejected request may reach the opener");

  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => errors.push(error.message));
  const bead = {
    id: "fx-1", title: "Fixture bead", status: "open", issue_type: "task", priority: 2, labels: [], dependencies: [],
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
    description: "Edit `src/a.ts:12`, not `missing.ts`, `escape.txt` or `src`; run `bd update`.",
  };
  await page.route("**/api/p/fixture/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith("/files")) return route.continue();
    if (p.endsWith("/beads/stream")) return route.abort();
    if (p.endsWith("/beads")) {
      return route.fulfill({ json: { beads: [bead], meta: { kind: "bd", humanActor: "reviewer", humanAllowlist: ["reviewer"], pollIntervalMs: 60_000 } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`${base}/p/fixture?bead=fx-1`);
  const dialog = page.getByRole("dialog");
  const link = dialog.getByRole("button", { name: "src/a.ts:12", exact: true });
  await link.waitFor();
  for (const plain of ["missing.ts", "escape.txt", "src", "bd update"]) {
    await dialog.locator("code", { hasText: plain }).first().waitFor();
    assert.equal(await dialog.getByRole("button", { name: plain, exact: true }).count(), 0, `${plain} must stay plain code`);
  }
  await link.click();
  for (let i = 0; !readOpened(); i++) {
    assert.ok(i < 50, "the opener was never run");
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(readOpened(), `${path.join(repo, "src", "a.ts")}\n`);
  assert.deepEqual(errors, []);
  console.log("PASS: in-repo file links render and open; outside, ../, symlink, missing, directory, absolute, cross-origin and viewer-mode requests are refused");
} catch (error) {
  console.error({ errors, url: page?.url(), body: page ? (await page.locator("body").innerText()).slice(0, 2000) : "" });
  throw error;
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
