import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyProfile,
  DEFAULT_CONFIG_TEMPLATE,
  loadConfig,
  validateConfig,
  type EpistleConfig,
} from "../src/lib/config.js";
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

test("validateConfig accepts the --init template and empty config", () => {
  assert.deepEqual(
    validateConfig(DEFAULT_CONFIG_TEMPLATE as Record<string, unknown>),
    [],
  );
  assert.deepEqual(validateConfig({}), []);
});

test("validateConfig reports field-level errors with paths", () => {
  const errors = validateConfig({
    output: { format: "yaml", copy: "yes" },
    maxTokens: -5,
    sort: "alphabetical",
    includeLogs: "many",
    exclud: ["typo"],
    profiles: {
      tiny: { compress: "true", profiles: {} },
    },
  });
  assert.ok(errors.some((e) => e.startsWith("output.format:")), String(errors));
  assert.ok(errors.some((e) => e.startsWith("output.copy:")));
  assert.ok(errors.some((e) => e.startsWith("maxTokens:")));
  assert.ok(errors.some((e) => e.startsWith("sort:")));
  assert.ok(errors.some((e) => e.startsWith("includeLogs:")));
  assert.ok(errors.some((e) => e.includes('exclud: unknown key (did you mean "exclude"?)')));
  assert.ok(errors.some((e) => e.startsWith("profiles.tiny.compress:")));
  assert.ok(
    errors.some((e) => e.startsWith("profiles.tiny.profiles: unknown key")),
    "profiles cannot nest",
  );
});

test("loadConfig rejects invalid config contents with all problems listed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "epistle-cfg-"));
  await fs.writeFile(
    path.join(dir, "bad-shape.json"),
    JSON.stringify({ output: { format: "yaml" }, redact: "no" }),
  );
  await assert.rejects(
    loadConfig(dir, "bad-shape.json"),
    (err: Error) =>
      /Invalid config/.test(err.message) &&
      /output\.format/.test(err.message) &&
      /redact/.test(err.message),
  );
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
