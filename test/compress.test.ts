import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compressToSignatures,
  removeEmptyLines,
  stripComments,
  transformContent,
} from "../src/lib/compress.js";

test("stripComments removes // and /* */ from TS but keeps strings", () => {
  const src = [
    "// header comment",
    'const url = "https://example.com"; // trailing',
    "/* block",
    "   comment */",
    "const x = 1;",
  ].join("\n");
  const out = stripComments("a.ts", src);
  assert.ok(out.includes('"https://example.com"'), "URL string must survive");
  assert.ok(!out.includes("header comment"));
  assert.ok(!out.includes("trailing"));
  assert.ok(!out.includes("block"));
  assert.ok(out.includes("const x = 1;"));
});

test("stripComments keeps python shebang, drops # lines", () => {
  const src = "#!/usr/bin/env python\n# a comment\nx = 1\n";
  const out = stripComments("a.py", src);
  assert.ok(out.includes("#!/usr/bin/env python"));
  assert.ok(!out.includes("# a comment"));
  assert.ok(out.includes("x = 1"));
});

test("stripComments removes html comments preserving newlines", () => {
  const src = "<div>\n<!-- hidden\nnote -->\n<span>ok</span>\n";
  const out = stripComments("a.html", src);
  assert.ok(!out.includes("hidden"));
  assert.ok(out.includes("<span>ok</span>"));
});

test("removeEmptyLines drops blank lines", () => {
  assert.equal(removeEmptyLines("a\n\n\nb\n \nc"), "a\nb\nc");
});

test("compressToSignatures keeps declarations and elides bodies", () => {
  const src = [
    'import fs from "node:fs";',
    "",
    "export function add(a: number, b: number): number {",
    "  const sum = a + b;",
    "  return sum;",
    "}",
    "",
    "export class Calc {",
    "  multiply(a: number, b: number): number {",
    "    return a * b;",
    "  }",
    "}",
  ].join("\n");
  const out = compressToSignatures("calc.ts", src);
  assert.ok(out);
  assert.ok(out.includes("import fs"));
  assert.ok(out.includes("export function add"));
  assert.ok(out.includes("export class Calc"));
  assert.ok(out.includes("multiply"));
  assert.ok(!out.includes("return sum"), "body should be elided");
});

test("compressToSignatures returns undefined for unsupported types", () => {
  assert.equal(compressToSignatures("data.csv", "a,b\n1,2"), undefined);
});

test("transformContent falls back to full content when compression unsupported", () => {
  const { content, compressed } = transformContent("notes.txt", "hello // hi", {
    compress: true,
  });
  assert.equal(compressed, false);
  assert.equal(content, "hello // hi");
});

test("python compression keeps def/class/import lines", () => {
  const src = [
    "import os",
    "",
    "class Foo:",
    "    def bar(self):",
    "        x = 1",
    "        return x",
  ].join("\n");
  const out = compressToSignatures("foo.py", src);
  assert.ok(out);
  assert.ok(out.includes("import os"));
  assert.ok(out.includes("class Foo:"));
  assert.ok(out.includes("def bar(self):"));
  assert.ok(!out.includes("return x"));
});
