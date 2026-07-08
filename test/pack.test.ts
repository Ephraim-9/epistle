import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { packDirectory } from "../src/lib/pack.js";
import { formatOutput } from "../src/lib/formatter.js";
import type { ScannedFile } from "../src/lib/scanner.js";

async function makeFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "epistle-pack-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }
  return dir;
}

// A function with a fat body: compresses down to nearly nothing.
const FAT_FUNCTION =
  "export function fat(): string {\n" +
  '  const words = "lorem ipsum dolor sit amet ".repeat(1);\n' +
  Array.from({ length: 200 }, (_, i) => `  const v${i} = ${i} + ${i};`).join("\n") +
  "\n  return words;\n}\n";

test("compression runs BEFORE token budget accounting", async (t) => {
  const dir = await makeFixture({
    "fat.ts": FAT_FUNCTION,
    "small.ts": "export const tiny = 1;\n",
  });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  // Uncompressed, fat.ts alone blows a 500-token budget…
  const uncompressed = await packDirectory({ rootDir: dir });
  assert.ok(uncompressed.totalTokens > 500, `sanity: ${uncompressed.totalTokens}`);

  // …but compressed it fits, so a compress+budget pack must NOT drop it.
  const packed = await packDirectory({
    rootDir: dir,
    compress: true,
    maxTokens: 500,
  });
  assert.deepEqual(
    packed.omittedForBudget,
    [],
    "compression must be applied before budget decides what to drop",
  );
  assert.ok(packed.totalTokens <= 500);
  assert.match(packed.output, /export function fat/);
});

test("token budget drops heaviest files but never package.json", async (t) => {
  const dir = await makeFixture({
    "package.json": JSON.stringify({ name: "x" }),
    "huge.ts": "// filler\n" + "const data = 'abcdefgh';\n".repeat(400),
    "small.ts": "export const ok = true;\n",
  });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const packed = await packDirectory({ rootDir: dir, maxTokens: 300 });
  assert.ok(packed.omittedForBudget.includes("huge.ts"));
  assert.ok(!packed.omittedForBudget.includes("package.json"));
  assert.match(packed.output, /omitted to fit token budget/);
});

test("diffRef in a non-git directory throws a clear error", async (t) => {
  const dir = await makeFixture({ "a.ts": "1" });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await assert.rejects(
    packDirectory({ rootDir: dir, diffRef: "HEAD" }),
    /requires a git repository/,
  );
});

function makeScanned(p: string, content: string): ScannedFile {
  return {
    path: p,
    absolutePath: "/project/" + p,
    sizeBytes: Buffer.byteLength(content),
    isBinary: false,
    isOversized: false,
    content,
  };
}

test("tech stack detection reads workspace manifests, not just the root", async () => {
  const files = [
    makeScanned("package.json", JSON.stringify({ name: "root", private: true })),
    makeScanned(
      "packages/web/package.json",
      JSON.stringify({ dependencies: { react: "^18.0.0" } }),
    ),
    makeScanned(
      "packages/api/package.json",
      JSON.stringify({ dependencies: { fastify: "^4.0.0" } }),
    ),
    makeScanned("services/worker/go.mod", "module example.com/worker\n"),
    makeScanned("crates/core/Cargo.toml", "[package]\nname = \"core\"\n"),
  ];
  const { output } = await formatOutput(files, {
    format: "markdown",
    rootDir: "/project",
  });
  const stackLine = output.split("\n").find((l) => l.startsWith("Tech Stack:"));
  assert.ok(stackLine, "tech stack line present");
  for (const tech of ["React", "Fastify", "Go", "Rust"]) {
    assert.ok(stackLine!.includes(tech), `${tech} detected in: ${stackLine}`);
  }
});
