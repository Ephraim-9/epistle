import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Expand "user/repo" shorthand to a GitHub URL; pass full URLs through.
 */
export function normalizeRemoteUrl(remote: string): string {
  if (/^[\w.-]+\/[\w.-]+$/.test(remote)) {
    return `https://github.com/${remote}.git`;
  }
  return remote;
}

/** Repo name derived from a remote URL, for default output naming. */
export function remoteRepoName(remote: string): string {
  const cleaned = remote.replace(/\.git$/, "").replace(/\/+$/, "");
  const last = cleaned.split("/").pop() ?? "remote";
  return last.replace(/[^\w.-]+/g, "-") || "remote";
}

/**
 * Shallow-clone a remote repository into a temp directory.
 * Caller is responsible for removing the returned directory.
 */
export async function cloneRemote(
  remote: string,
  branch?: string,
): Promise<string> {
  const url = normalizeRemoteUrl(remote);
  // Argument-injection hardening: a URL or ref beginning with "-" would
  // otherwise be parsed by git as an option (e.g. --upload-pack=<cmd>
  // executes commands). Same vulnerability class Repomix patched in 2026.
  if (url.startsWith("-")) {
    throw new Error(`Invalid remote URL "${remote}".`);
  }
  if (branch && (branch.startsWith("-") || branch.includes("\0"))) {
    throw new Error(`Invalid branch name "${branch}".`);
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "epistle-remote-"));
  const args = ["clone", "--depth", "1", "--single-branch"];
  if (branch) {
    args.push("--branch", branch);
  }
  // "--" stops option parsing before the positional URL/directory
  args.push("--", url, dir);
  try {
    await execFileAsync("git", args, { maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new Error(
      `Failed to clone "${url}"${branch ? ` (branch ${branch})` : ""}: ${(err as Error).message}`,
    );
  }
  return dir;
}

/** Run a git command in rootDir; returns stdout or undefined on failure. */
async function git(
  rootDir: string,
  args: string[],
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: rootDir,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return undefined;
  }
}

export async function isGitRepo(rootDir: string): Promise<boolean> {
  const out = await git(rootDir, ["rev-parse", "--is-inside-work-tree"]);
  return out?.trim() === "true";
}

/**
 * Files changed relative to `ref` (default HEAD): staged, unstaged, and
 * untracked. Paths are repo-relative with forward slashes.
 */
export async function getChangedFiles(
  rootDir: string,
  ref = "HEAD",
): Promise<string[] | undefined> {
  // A ref beginning with "-" would be parsed as a git-diff option
  // (e.g. --output=<path> writes files); reject instead of executing.
  if (ref.startsWith("-") || ref.includes("\0")) {
    return undefined;
  }
  const diff = await git(rootDir, ["diff", "--name-only", ref, "--"]);
  if (diff === undefined) return undefined;
  const untracked = await git(rootDir, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);

  const set = new Set<string>();
  for (const line of (diff + "\n" + (untracked ?? "")).split("\n")) {
    const p = line.trim();
    if (p) set.add(p);
  }
  return Array.from(set);
}

/** Working-tree diff plus staged diff, as unified diff text. */
export async function getDiffText(
  rootDir: string,
): Promise<string | undefined> {
  const working = await git(rootDir, ["diff"]);
  if (working === undefined) return undefined;
  const staged = await git(rootDir, ["diff", "--cached"]);

  const parts: string[] = [];
  if (working.trim()) {
    parts.push("--- Working tree changes ---\n" + working.trimEnd());
  }
  if (staged && staged.trim()) {
    parts.push("--- Staged changes ---\n" + staged.trimEnd());
  }
  return parts.length > 0 ? parts.join("\n\n") : "";
}

/** Recent commits, one per line: short-hash date subject. */
export async function getLogText(
  rootDir: string,
  count: number,
): Promise<string | undefined> {
  const out = await git(rootDir, [
    "log",
    `-n${count}`,
    "--pretty=format:%h %ad %s",
    "--date=short",
  ]);
  return out?.trimEnd();
}

/**
 * Change frequency per file over the last `maxCommits` commits.
 * Higher churn = more actively developed = more likely relevant.
 */
export async function getChurnCounts(
  rootDir: string,
  maxCommits = 100,
): Promise<Map<string, number> | undefined> {
  const out = await git(rootDir, [
    "log",
    `-n${maxCommits}`,
    "--name-only",
    "--pretty=format:",
  ]);
  if (out === undefined) return undefined;

  const counts = new Map<string, number>();
  for (const line of out.split("\n")) {
    const p = line.trim();
    if (!p) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return counts;
}
