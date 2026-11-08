#!/usr/bin/env node
/**
 * Opens beads://projects/<project>/<bead-id>[#<section>] links in the
 * installed Scotty app's window, falling back to the default browser.
 *
 *   scotty-open-bead.mjs [--port <n>] [--dry-run] <beads-url>
 *   scotty-open-bead.mjs [--port <n>] --install
 *
 * --install registers this script as the desktop's x-scheme-handler/beads
 * handler. Linux/XDG only: macOS needs an app bundle declaring
 * CFBundleURLTypes and Windows a registry entry, neither of which exists yet.
 *
 * The web manifest can't claim beads:// itself: protocol_handlers only takes
 * web+<name> or a few safelisted schemes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "./default-port.mjs";

// Matches APP_TITLE in lib/app-title.ts, which Chrome copies into the app's .desktop Name=.
const APP_NAME = "Bead Me Up, Scotty";
const HANDLER_DESKTOP = "scotty-beads-url.desktop";

/** Maps a beads:// URL to the app URL that opens the bead; throws on anything malformed. */
export function beadsUrlToAppUrl(input, origin) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Not a URL: ${input}`);
  }
  const parts = url.pathname.split("/").slice(1);
  if (url.protocol !== "beads:" || url.host !== "projects" || parts.length !== 2 || parts.some((p) => !p)) {
    throw new Error(`Expected beads://projects/<project>/<bead-id>[#<section>], got: ${input}`);
  }
  let project, bead, section;
  try {
    [project, bead, section] = [...parts, url.hash.slice(1)].map(decodeURIComponent);
  } catch {
    throw new Error(`Bad percent-encoding in: ${input}`);
  }
  const hash = section ? `#${encodeURIComponent(section)}` : "";
  return `${origin}/p/${encodeURIComponent(project)}?bead=${encodeURIComponent(bead)}${hash}`;
}

const applicationsDir = () =>
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "applications");

/** The Exec= argv of Chrome's .desktop entry for the installed Scotty app, or null. */
export function findAppExec(dir = applicationsDir()) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".desktop"));
  } catch {
    return null;
  }
  // shortcut: takes the first match, so with the app installed in several Chrome profiles the
  // first one wins; add a --profile option if that ever matters.
  for (const f of files.sort()) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const exec = text.match(/^Exec=(.*)$/m)?.[1];
    if (text.match(/^Name=(.*)$/m)?.[1] === APP_NAME && exec?.includes("--app-id=")) {
      // Chrome writes unquoted Exec lines; drop any %u-style field codes.
      return exec.split(/\s+/).filter((a) => a && !/^%[a-zA-Z]$/.test(a));
    }
  }
  return null;
}

/** The command that opens appUrl: in the app window if installed, else the default browser. */
export function openCommand(appUrl, exec = findAppExec()) {
  // Chrome opens this URL in the app; the manifest's launch_handler makes that reuse the open window.
  return exec ? [...exec, `--app-launch-url-for-shortcuts-menu-item=${appUrl}`] : ["xdg-open", appUrl];
}

function install(port) {
  const dir = applicationsDir();
  fs.mkdirSync(dir, { recursive: true });
  const script = fileURLToPath(import.meta.url);
  const portArg = port === DEFAULT_PORT ? "" : ` --port ${port}`;
  // xdg-mime can't resolve a quoted program, so quote only paths that need it.
  const q = (p) => (/\s/.test(p) ? `"${p}"` : p);
  fs.writeFileSync(
    path.join(dir, HANDLER_DESKTOP),
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Scotty beads:// links",
      // Via the shebang, so a node upgrade or nvm switch can't strand the handler.
      `Exec=${q(script)}${portArg} %u`,
      "MimeType=x-scheme-handler/beads;",
      "NoDisplay=true",
      "Terminal=false",
      "",
    ].join("\n"),
  );
  const set = spawnSync("xdg-mime", ["default", HANDLER_DESKTOP, "x-scheme-handler/beads"], { stdio: "inherit" });
  if (set.status !== 0) throw new Error("xdg-mime couldn't make this the beads:// handler");
  spawnSync("update-desktop-database", [dir], { stdio: "ignore" });
  console.log(`Registered ${path.join(dir, HANDLER_DESKTOP)} for beads:// links.`);
  if (!findAppExec(dir)) console.log(`No installed "${APP_NAME}" app found, so links will open in your default browser.`);
}

function main(argv) {
  let port = DEFAULT_PORT;
  let dryRun = false;
  let doInstall = false;
  const urls = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--install") doInstall = true;
    else if (a === "--port") port = Number(argv[++i]);
    else urls.push(a);
  }
  if (!Number.isInteger(port) || port <= 0) throw new Error("--port needs a positive integer");
  if (doInstall) return install(port);
  if (urls.length !== 1) throw new Error("Usage: scotty-open-bead.mjs [--port <n>] [--dry-run] <beads-url> | --install");
  const cmd = openCommand(beadsUrlToAppUrl(urls[0], `http://localhost:${port}`));
  if (dryRun) return console.log(cmd.join(" "));
  spawn(cmd[0], cmd.slice(1), { detached: true, stdio: "ignore" }).unref();
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`scotty-open-bead: ${e.message}`);
    // Launched from a link there is no terminal to read stderr in.
    if (!process.stderr.isTTY) spawnSync("notify-send", ["Scotty couldn't open the link", e.message]);
    process.exit(1);
  }
}
