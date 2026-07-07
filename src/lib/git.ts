import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  const diff = await git(rootDir, ["diff", "--name-only", ref]);
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
