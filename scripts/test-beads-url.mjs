// beads:// link handler: URL mapping (beads, sections, views), app discovery and the dry-run command.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROJECT_VIEWS, beadsUrlToAppUrl as map, findAppExec, openCommand } from '../bin/scotty-open-bead.mjs';

const o = 'http://localhost:19847';
assert.equal(map('beads://projects/demo/scotty-kpk', o), `${o}/p/demo?bead=scotty-kpk`);
assert.equal(map('beads://projects/demo/scotty-kpk#notes', o), `${o}/p/demo?bead=scotty-kpk#notes`);
assert.equal(map('beads://projects/demo/scotty-kpk#', o), `${o}/p/demo?bead=scotty-kpk`, 'an empty fragment is no anchor');
assert.equal(map('beads://projects/2024%20audit/a%2Fb.1#acceptance%20criteria', o), `${o}/p/2024%20audit?bead=a%2Fb.1#acceptance%20criteria`);
assert.equal(map('beads://projects/demo/x%26y?ignored=1', o), `${o}/p/demo?bead=x%26y`, 'ids are re-encoded, so & cannot add query parameters');
// Views: global ones, All Projects, a project's page and its views; a trailing slash is fine.
const all = `${o}/?from=beads-link`;
for (const [link, want] of [['beads://', all], ['beads://projects', all], ['beads://projects/', all], ['beads://needs-you', `${o}/needs-you`], ['beads://settings/', `${o}/settings`],
  ['beads://projects/demo', `${o}/p/demo`], ['beads://projects/demo/', `${o}/p/demo`], ['beads://projects/demo/needs-you', `${o}/p/demo?view=needsyou`], ['beads://projects/demo/board#notes', `${o}/p/demo?view=board`],
  ['beads://projects/demo/bd-9f2a.3/', `${o}/p/demo?bead=bd-9f2a.3`]]) {
  assert.equal(map(link, o), want, link);
}
const views = fs.readFileSync(new URL('../lib/views.ts', import.meta.url), 'utf8').match(/VIEWS = \[([^\]]*)\]/)[1].match(/"[^"]+"/g).map(JSON.parse);
assert.deepEqual(Object.values(PROJECT_VIEWS).sort(), views.sort(), 'every view in lib/views.ts needs a beads:// name');
for (const bad of ['', 'not a url', 'http://projects/demo/x', 'beads://project/demo/x', 'beads://needs-you/x', 'beads://unknown', 'beads://projects//x', 'beads://projects/demo/x/y', 'beads://projects/demo/%E0%A4%A']) {
  assert.throws(() => map(bad, o), Error, `must reject ${JSON.stringify(bad)}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scotty-url-'));
try {
  const apps = path.join(tmp, 'applications');
  fs.mkdirSync(apps);
  assert.equal(findAppExec(apps), null);
  assert.deepEqual(openCommand(`${o}/p/demo?bead=x`, null), ['xdg-open', `${o}/p/demo?bead=x`], 'without the app, use the default browser');
  fs.writeFileSync(path.join(apps, 'chrome-other-Default.desktop'), '[Desktop Entry]\nName=Other\nExec=/opt/google/chrome/google-chrome --app-id=other\n');
  fs.writeFileSync(path.join(apps, 'chrome-abc-Default.desktop'), '[Desktop Entry]\nName=Bead Me Up, Scotty\nExec=/opt/google/chrome/google-chrome --profile-directory=Default --app-id=abc %U\n');
  const exec = ['/opt/google/chrome/google-chrome', '--profile-directory=Default', '--app-id=abc'];
  assert.deepEqual(findAppExec(apps), exec);
  const run = (...args) => spawnSync(process.execPath, ['bin/scotty-open-bead.mjs', ...args], { env: { ...process.env, XDG_DATA_HOME: tmp }, encoding: 'utf8' });
  const dry = run('--dry-run', 'beads://projects/demo/scotty-kpk#notes');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), [...exec, `--app-launch-url-for-shortcuts-menu-item=${o}/p/demo?bead=scotty-kpk#notes`].join(' '));
  assert.match(run('--dry-run', '--port', '3200', 'beads://projects/demo/x').stdout, /localhost:3200\/p\/demo\?bead=x/);
  const bad = run('--dry-run', 'beads://projects/demo/x/y');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Expected beads:\/\/.*got: beads:\/\/projects\/demo\/x\/y/);

  // --install writes the handler entry and makes it the default, all inside tmp.
  const env = { ...process.env, XDG_DATA_HOME: tmp, XDG_CONFIG_HOME: tmp, XDG_DATA_DIRS: tmp, XDG_CONFIG_DIRS: tmp };
  const inst = spawnSync(process.execPath, ['bin/scotty-open-bead.mjs', '--port', '3200', '--install'], { env, encoding: 'utf8' });
  assert.equal(inst.status, 0, inst.stderr);
  const entry = fs.readFileSync(path.join(apps, 'scotty-beads-url.desktop'), 'utf8');
  assert.match(entry, /^MimeType=x-scheme-handler\/beads;$/m);
  // The entry runs the script through its shebang, so it never pins one node binary.
  assert.ok(entry.includes(`Exec=${path.resolve('bin/scotty-open-bead.mjs')} --port 3200 %u`), entry);
  assert.ok(!entry.includes(process.execPath), entry);
  assert.match(fs.readFileSync('bin/scotty-open-bead.mjs', 'utf8'), /^#!\/usr\/bin\/env node\n/);
  assert.ok(fs.statSync('bin/scotty-open-bead.mjs').mode & 0o111, 'the script must be executable');
  assert.equal(spawnSync('xdg-mime', ['query', 'default', 'x-scheme-handler/beads'], { env, encoding: 'utf8' }).stdout.trim(), 'scotty-beads-url.desktop');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('PASS: beads:// URLs map to app URLs (beads, fragments, percent-encoding, global and project views, malformed input), the installed app is found by name, --dry-run prints the Chrome command, and --install registers the handler');
