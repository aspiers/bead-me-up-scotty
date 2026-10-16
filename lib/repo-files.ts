import "server-only";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/** Strip an editor-style `:line` or `:line:col` suffix from a referenced path. */
export function stripLineSuffix(ref: string): string {
  return ref.replace(/(?::\d+){1,2}$/, "");
}

export class RepoFileError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Resolve a repo-relative path to the real path of a regular file inside
 * `root`. realpath on both sides catches `..` and symlink escapes alike.
 */
export function resolveRepoFile(root: string, ref: string): string {
  const rel = stripLineSuffix(ref.trim());
  if (!rel || path.isAbsolute(rel)) throw new RepoFileError("Path must be relative to the repository", 400);
  let realRoot: string, real: string;
  try {
    realRoot = fs.realpathSync(root);
    real = fs.realpathSync(path.resolve(realRoot, rel));
  } catch {
    throw new RepoFileError(`Not found: ${rel}`, 404);
  }
  if (!real.startsWith(realRoot + path.sep)) throw new RepoFileError("Path is outside the repository", 403);
  if (!fs.statSync(real).isFile()) throw new RepoFileError(`Not a file: ${rel}`, 400);
  return real;
}

/**
 * Hand a file to the desktop's default handler, the same openers
 * bin/bead-me-up-scotty.mjs uses for the browser. SCOTTY_OPEN_COMMAND names
 * a replacement executable, run with the file as its only argument.
 * Resolves once the opener has started, so a missing opener is an error.
 */
export function openOnDesktop(file: string): Promise<void> {
  let cmd: string, args: string[];
  if (process.env.SCOTTY_OPEN_COMMAND) {
    cmd = process.env.SCOTTY_OPEN_COMMAND;
    args = [file];
  } else if (process.platform === "darwin") {
    cmd = "open";
    args = [file];
  } else if (process.platform === "win32") {
    cmd = "cmd";
    // cmd.exe re-parses its command line, so caret-escape metacharacters.
    args = ["/c", "start", '""', file.replace(/[&|^<>]/g, "^$&")];
  } else {
    cmd = "xdg-open";
    args = [file];
  }
  return new Promise((resolve, reject) => {
    // The opener is an external program, not a project file to trace.
    const child = spawn(/*turbopackIgnore: true*/ cmd, args, { stdio: "ignore", detached: true });
    child.once("spawn", () => { child.unref(); resolve(); });
    child.once("error", (e) => reject(new RepoFileError(`Could not run ${cmd}: ${e.message}`, 500)));
  });
}
