import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getChangedFiles,
  getChurnCounts,
  getDiffText,
  getLogText,
  isGitRepo,
} from "../src/lib/git.js";

function run(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function makeGitFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "epistle-git-"));
  run(dir, ["init", "-q"]);
  run(dir, ["config", "user.email", "test@example.com"]);
  run(dir, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(dir, "a.txt"), "one\n");
  await fs.writeFile(path.join(dir, "b.txt"), "two\n");
  run(dir, ["add", "."]);
  run(dir, ["commit", "-q", "-m", "initial commit"]);
  await fs.writeFile(path.join(dir, "a.txt"), "one\nchanged\n");
  run(dir, ["add", "a.txt"]);
  run(dir, ["commit", "-q", "-m", "edit a"]);
  return dir;
}

test("isGitRepo distinguishes repos from plain dirs", async (t) => {
  const repo = await makeGitFixture();
  const plain = await fs.mkdtemp(path.join(os.tmpdir(), "epistle-plain-"));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  t.after(() => fs.rm(plain, { recursive: true, force: true }));

  assert.equal(await isGitRepo(repo), true);
  assert.equal(await isGitRepo(plain), false);
});

test("getChangedFiles reports modified and untracked files", async (t) => {
  const repo = await makeGitFixture();
  t.after(() => fs.rm(repo, { recursive: true, force: true }));

  await fs.writeFile(path.join(repo, "b.txt"), "two\nmodified\n");
  await fs.writeFile(path.join(repo, "new.txt"), "brand new\n");

  const changed = await getChangedFiles(repo);
  assert.ok(changed);
  assert.ok(changed.includes("b.txt"));
  assert.ok(changed.includes("new.txt"));
  assert.ok(!changed.includes("a.txt"));
});

test("getDiffText includes working tree changes", async (t) => {
  const repo = await makeGitFixture();
  t.after(() => fs.rm(repo, { recursive: true, force: true }));

  await fs.writeFile(path.join(repo, "b.txt"), "two\nmodified\n");
  const diff = await getDiffText(repo);
  assert.ok(diff);
  assert.ok(diff.includes("+modified"));
});

test("getLogText returns recent commit subjects", async (t) => {
  const repo = await makeGitFixture();
  t.after(() => fs.rm(repo, { recursive: true, force: true }));

  const log = await getLogText(repo, 10);
  assert.ok(log);
  assert.ok(log.includes("edit a"));
  assert.ok(log.includes("initial commit"));
});

test("getChurnCounts counts per-file edits", async (t) => {
  const repo = await makeGitFixture();
  t.after(() => fs.rm(repo, { recursive: true, force: true }));

  const churn = await getChurnCounts(repo);
  assert.ok(churn);
  assert.equal(churn.get("a.txt"), 2);
  assert.equal(churn.get("b.txt"), 1);
});
