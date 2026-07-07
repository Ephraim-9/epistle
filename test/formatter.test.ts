import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addLineNumbers,
  fenceFor,
  formatOutput,
  redactSecrets,
} from "../src/lib/formatter.js";
import type { ScannedFile } from "../src/lib/scanner.js";

function makeFile(p: string, content: string): ScannedFile {
  return {
    path: p,
    absolutePath: "/project/" + p,
    sizeBytes: Buffer.byteLength(content),
    isBinary: false,
    isOversized: false,
    content,
  };
}

test("fenceFor extends fences past embedded backticks", () => {
  assert.equal(fenceFor("plain text"), "```");
  assert.equal(fenceFor("```js\ncode\n```"), "````");
  assert.equal(fenceFor("````\nnested\n````"), "`````");
});

test("markdown output survives files containing code fences", () => {
  const files = [makeFile("README.md", "Example:\n```js\nconsole.log(1)\n```\n")];
  const { output } = formatOutput(files, {
    format: "markdown",
    rootDir: "/project",
  });
  // The wrapping fence must be longer than any fence in the content
  assert.match(output, /````/);
});

test("addLineNumbers pads and numbers every line", () => {
  const result = addLineNumbers("a\nb\nc");
  assert.equal(result, "1: a\n2: b\n3: c");
});

test("redactSecrets replaces API-key shapes and counts them", () => {
  const input = "key=sk-abcdefghijklmnop123456 aws=AKIAABCDEFGHIJKLMNOP";
  const { redacted, count } = redactSecrets(input);
  assert.equal(count, 2);
  assert.ok(!redacted.includes("AKIAABCDEFGHIJKLMNOP"));
  assert.ok(redacted.includes("[REDACTED_SECRET]"));
});

test("json format emits valid JSON with metadata, tree, and files", () => {
  const files = [makeFile("src/index.ts", "export const x = 1;\n")];
  const { output, totalTokens } = formatOutput(files, {
    format: "json",
    rootDir: "/project",
    task: "Review this",
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.metadata.totalFiles, 1);
  assert.equal(parsed.metadata.totalTokens, totalTokens);
  assert.equal(parsed.files[0].path, "src/index.ts");
  assert.equal(parsed.task, "Review this");
  assert.ok(parsed.tree.includes("index.ts"));
});

test("plain format contains separators and file sections", () => {
  const files = [makeFile("a.txt", "hello")];
  const { output } = formatOutput(files, {
    format: "plain",
    rootDir: "/project",
  });
  assert.ok(output.includes("File: a.txt"));
  assert.ok(output.includes("hello"));
  assert.ok(output.includes("DIRECTORY STRUCTURE"));
});

test("line numbers option is applied to content", () => {
  const files = [makeFile("a.js", "one\ntwo")];
  const { output } = formatOutput(files, {
    format: "markdown",
    rootDir: "/project",
    lineNumbers: true,
  });
  assert.ok(output.includes("1: one"));
  assert.ok(output.includes("2: two"));
});

test("oversized message reflects configured max file size", () => {
  const files: ScannedFile[] = [
    {
      path: "big.bin.txt",
      absolutePath: "/project/big.bin.txt",
      sizeBytes: 999999,
      isBinary: false,
      isOversized: true,
    },
  ];
  const { output } = formatOutput(files, {
    format: "markdown",
    rootDir: "/project",
    maxFileSizeKB: 42,
  });
  assert.ok(output.includes(">42KB"));
});
