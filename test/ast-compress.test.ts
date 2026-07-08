import { test } from "node:test";
import assert from "node:assert/strict";
import {
  astCompressionAvailable,
  astCompressToSignatures,
} from "../src/lib/ast-compress.js";
import { transformContentAsync } from "../src/lib/compress.js";

// These tests exercise the optional tree-sitter stack, which is present
// in dev/CI installs. If it were ever missing, the availability test
// documents that state and the rest skip.

test("AST compression is available in dev installs", async () => {
  assert.equal(await astCompressionAvailable(), true);
});

test("TS: multi-line signatures survive with parameters and return type", async () => {
  const src = `export function process(
  input: Map<string, Array<number>>,
  options: { deep: boolean },
): Promise<void> {
  const secret = doWork(input);
  return secret;
}
`;
  const out = await astCompressToSignatures("a.ts", src);
  assert.ok(out);
  assert.match(out!, /input: Map<string, Array<number>>/);
  assert.match(out!, /\): Promise<void> \{ \/\* … \*\/ \}/);
  assert.ok(!out!.includes("doWork"), "body elided");
});

test("TS: decorator arguments and class members survive", async () => {
  const src = `@Component({
  selector: "app-root",
})
export class AppComponent {
  title = "app";
  fetch(url: string): Observable<Data> {
    return this.http.get(url);
  }
}
`;
  const out = await astCompressToSignatures("a.ts", src);
  assert.ok(out);
  assert.match(out!, /selector: "app-root"/, "decorator args kept");
  assert.match(out!, /fetch\(url: string\): Observable<Data> \{ \/\* … \*\/ \}/);
  assert.ok(!out!.includes("this.http.get"), "method body elided");
});

test("TS: multi-line arrow function signature survives", async () => {
  const src = `export const handler = async (
  event: APIGatewayEvent,
): Promise<Response> => {
  return { statusCode: 200 };
};
`;
  const out = await astCompressToSignatures("a.ts", src);
  assert.ok(out);
  assert.match(out!, /event: APIGatewayEvent/);
  assert.ok(!out!.includes("statusCode"), "body elided");
});

test("Python: decorators, defs, and class methods keep full headers", async () => {
  const src = `import functools

@functools.lru_cache(
    maxsize=None,
)
def fib(n: int) -> int:
    return fib(n - 1) + fib(n - 2)

class Cache:
    def get(self, key: str) -> str | None:
        return self._data.get(key)
`;
  const out = await astCompressToSignatures("a.py", src);
  assert.ok(out);
  assert.match(out!, /maxsize=None/, "multi-line decorator kept");
  assert.match(out!, /def fib\(n: int\) -> int:/);
  assert.match(out!, /def get\(self, key: str\) -> str \| None:/);
  assert.ok(!out!.includes("self._data"), "method body elided");
});

test("Go: imports, types, and func signatures kept; bodies elided", async () => {
  const src = `package main

import (
	"fmt"
)

type Config struct {
	Name string
}

func (c *Config) Print(prefix string) error {
	fmt.Println(prefix + c.Name)
	return nil
}
`;
  const out = await astCompressToSignatures("main.go", src);
  assert.ok(out);
  assert.match(out!, /package main/);
  assert.match(out!, /type Config struct/);
  assert.match(out!, /func \(c \*Config\) Print\(prefix string\) error \{ \/\* … \*\/ \}/);
  assert.ok(!out!.includes("fmt.Println"), "body elided");
});

test("Rust: use/struct/impl signatures kept; fn bodies elided", async () => {
  const src = `use std::collections::HashMap;

#[derive(Debug)]
pub struct Cache {
    data: HashMap<String, String>,
}

impl Cache {
    pub fn get(&self, key: &str) -> Option<&String> {
        self.data.get(key)
    }
}
`;
  const out = await astCompressToSignatures("lib.rs", src);
  assert.ok(out);
  assert.match(out!, /use std::collections::HashMap;/);
  assert.match(out!, /pub struct Cache/);
  assert.match(out!, /pub fn get\(&self, key: &str\) -> Option<&String> \{ \/\* … \*\/ \}/);
  assert.ok(!out!.includes("self.data.get"), "fn body elided");
});

test("unsupported language returns undefined (heuristic fallback path)", async () => {
  assert.equal(await astCompressToSignatures("Main.java", "class A {}"), undefined);
  // transformContentAsync still compresses Java via the line heuristic
  const result = await transformContentAsync(
    "Main.java",
    "import java.util.List;\nclass A {\n  int x = compute();\n}\n",
    { compress: true },
  );
  assert.equal(result.compressed, true);
  assert.equal(result.engine, "heuristic");
});

test("transformContentAsync reports engine=ast for supported languages", async () => {
  const result = await transformContentAsync(
    "a.ts",
    "export function f(): void {\n  work();\n}\n",
    { compress: true },
  );
  assert.equal(result.compressed, true);
  assert.equal(result.engine, "ast");
  assert.ok(!result.content.includes("work()"));
});
