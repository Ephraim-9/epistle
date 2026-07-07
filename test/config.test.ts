import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyProfile, loadConfig, type EpistleConfig } from "../src/lib/config.js";
import { getRecipe, recipeNames, RECIPES } from "../src/lib/recipes.js";
import { normalizeRemoteUrl, remoteRepoName } from "../src/lib/git.js";

test("applyProfile merges profile over base, deep-merging output", () => {
  const base: EpistleConfig = {
    output: { format: "markdown", lineNumbers: false },
    compress: false,
    exclude: ["a"],
    profiles: {
      tiny: { compress: true, output: { lineNumbers: true } },
    },
  };
  const merged = applyProfile(base, "tiny");
  assert.equal(merged.compress, true);
  assert.equal(merged.output?.lineNumbers, true);
  assert.equal(merged.output?.format, "markdown", "base output keys survive");
  assert.deepEqual(merged.exclude, ["a"], "base exclude kept when profile has none");
});

test("applyProfile throws for unknown profile with available list", () => {
  const base: EpistleConfig = { profiles: { a: {}, b: {} } };
  assert.throws(() => applyProfile(base, "c"), /Available profiles: a, b/);
});

test("loadConfig returns empty config when default file missing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "epistle-cfg-"));
  const { config, configPath } = await loadConfig(dir);
  assert.deepEqual(config, {});
  assert.equal(configPath, undefined);
  await fs.rm(dir, { recursive: true, force: true });
});

test("loadConfig throws for explicit missing path and invalid JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "epistle-cfg-"));
  await assert.rejects(loadConfig(dir, "nope.json"), /Cannot read config/);
  await fs.writeFile(path.join(dir, "bad.json"), "{oops");
  await assert.rejects(loadConfig(dir, "bad.json"), /Invalid JSON/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("recipes are non-empty and retrievable case-insensitively", () => {
  assert.ok(recipeNames().length >= 6);
  for (const name of recipeNames()) {
    assert.ok(RECIPES[name].prompt.length > 50);
  }
  assert.ok(getRecipe("REVIEW"));
  assert.equal(getRecipe("nonexistent"), undefined);
});

test("remote URL helpers expand shorthand and derive names", () => {
  assert.equal(
    normalizeRemoteUrl("octocat/Hello-World"),
    "https://github.com/octocat/Hello-World.git",
  );
  assert.equal(
    normalizeRemoteUrl("https://gitlab.com/x/y.git"),
    "https://gitlab.com/x/y.git",
  );
  assert.equal(remoteRepoName("https://github.com/a/repo-name.git"), "repo-name");
  assert.equal(remoteRepoName("a/b"), "b");
});
