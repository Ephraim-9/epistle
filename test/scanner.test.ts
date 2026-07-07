import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanProject } from "../src/lib/scanner.js";

async function makeFixture(
  files: Record<string, string>,
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "epistle-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }
  return dir;
}

test("root .gitignore is respected", async (t) => {
  const dir = await makeFixture({
    ".gitignore": "secret.txt\n",
    "secret.txt": "hidden",
    "keep.txt": "kept",
  });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const { files } = await scanProject({ rootDir: dir });
  const paths = files.map((f) => f.path);
  assert.ok(paths.includes("keep.txt"));
  assert.ok(!paths.includes("secret.txt"));
});

test("nested .gitignore files apply within their directory", async (t) => {
  const dir = await makeFixture({
    "pkg/.gitignore": "generated.ts\n",
    "pkg/generated.ts": "ignore me",
    "pkg/source.ts": "keep me",
    "generated.ts": "root-level file with same name is kept",
  });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const { files } = await scanProject({ rootDir: dir });
  const paths = files.map((f) => f.path);
  assert.ok(!paths.includes("pkg/generated.ts"));
  assert.ok(paths.includes("pkg/source.ts"));
  assert.ok(paths.includes("generated.ts"));
});

test(".epistleignore is honored", async (t) => {
  const dir = await makeFixture({
    ".epistleignore": "notes.txt\n",
    "notes.txt": "private notes",
    "code.ts": "const a = 1;",
  });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const { files } = await scanProject({ rootDir: dir });
  const paths = files.map((f) => f.path);
  assert.ok(!paths.includes("notes.txt"));
  assert.ok(paths.includes("code.ts"));
});

test("scanPaths restricts scanning to given directories and files", async (t) => {
  const dir = await makeFixture({
    "a/one.ts": "1",
    "b/two.ts": "2",
    "c.ts": "3",
  });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const { files } = await scanProject({ rootDir: dir, scanPaths: ["a", "c.ts"] });
  const paths = files.map((f) => f.path).sort();
  assert.deepEqual(paths, ["a/one.ts", "c.ts"]);
});

test("scanPaths outside root are rejected", async (t) => {
  const dir = await makeFixture({ "a.ts": "1" });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await assert.rejects(
    scanProject({ rootDir: dir, scanPaths: [".."] }),
    /outside the project root/,
  );
});

test("maxFileSizeBytes marks large files as oversized", async (t) => {
  const dir = await makeFixture({
    "big.txt": "x".repeat(2048),
    "small.txt": "tiny",
  });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const { files } = await scanProject({ rootDir: dir, maxFileSizeBytes: 1024 });
  const big = files.find((f) => f.path === "big.txt");
  const small = files.find((f) => f.path === "small.txt");
  assert.equal(big?.isOversized, true);
  assert.equal(big?.content, undefined);
  assert.equal(small?.isOversized, false);
  assert.equal(small?.content, "tiny");
});

test("lockfiles and node_modules are excluded by default", async (t) => {
  const dir = await makeFixture({
    "package-lock.json": "{}",
    "node_modules/dep/index.js": "junk",
    "index.js": "real",
  });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const { files } = await scanProject({ rootDir: dir });
  const paths = files.map((f) => f.path);
  assert.deepEqual(paths, ["index.js"]);
});
