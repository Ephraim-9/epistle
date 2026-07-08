import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createEpistleMcpServer } from "../src/lib/mcp.js";

async function connectedClient() {
  const server = createEpistleMcpServer("0.0.0-test");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "epistle-test", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

function firstText(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> })
    .content;
  assert.ok(content.length > 0);
  assert.equal(content[0].type, "text");
  return content[0].text;
}

async function makeProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "epistle-mcp-proj-"));
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { express: "^4.0.0" } }),
  );
  await fs.mkdir(path.join(dir, "src"));
  await fs.writeFile(
    path.join(dir, "src", "index.ts"),
    'export function greet(name: string) {\n  return "hello " + name;\n}\n',
  );
  await fs.writeFile(path.join(dir, ".env"), "SECRET=hunter2\n");
  return dir;
}

test("MCP: lists the four epistle tools", async () => {
  const client = await connectedClient();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "grep_output",
    "pack_codebase",
    "pack_remote",
    "read_output",
  ]);
  await client.close();
});

test("MCP: pack_codebase → read_output → grep_output round-trip", async () => {
  const client = await connectedClient();
  const dir = await makeProject();

  const packed = await client.callTool({
    name: "pack_codebase",
    arguments: { directory: dir },
  });
  const summary = firstText(packed);
  assert.match(summary, /outputId: [0-9a-f]{12}/);
  assert.match(summary, /Total files: 2/, summary); // .env excluded as credential-shaped
  assert.match(summary, /Credential-shaped files excluded \(1\): \.env/);
  const outputId = summary.match(/outputId: ([0-9a-f]+)/)![1];

  const read = await client.callTool({
    name: "read_output",
    arguments: { outputId, startLine: 1, maxLines: 200 },
  });
  const chunk = firstText(read);
  assert.match(chunk, /greet/, "pack contains file content");
  assert.match(chunk, /end of pack/);

  const grep = await client.callTool({
    name: "grep_output",
    arguments: { outputId, pattern: 'return "hello', contextLines: 1 },
  });
  const grepText = firstText(grep);
  assert.match(grepText, /1 match\(es\)/);
  assert.match(grepText, /\d+:\s+return "hello " \+ name;/);
  assert.match(grepText, /\d+-\s+export function greet/, "context line included");

  await fs.rm(dir, { recursive: true, force: true });
  await client.close();
});

test("MCP: pack_codebase honors compress and maxTokens", async () => {
  const client = await connectedClient();
  const dir = await makeProject();

  const packed = await client.callTool({
    name: "pack_codebase",
    arguments: { directory: dir, compress: true },
  });
  const outputId = firstText(packed).match(/outputId: ([0-9a-f]+)/)![1];
  const read = await client.callTool({
    name: "read_output",
    arguments: { outputId },
  });
  const text = firstText(read);
  assert.match(text, /export function greet/, "signature survives compression");
  assert.ok(!text.includes('return "hello "'), "body elided by compression");

  await fs.rm(dir, { recursive: true, force: true });
  await client.close();
});

test("MCP: unknown outputId and bad regex return errors", async () => {
  const client = await connectedClient();

  const bad = await client.callTool({
    name: "read_output",
    arguments: { outputId: "doesnotexist" },
  });
  assert.equal(bad.isError, true);
  assert.match(firstText(bad), /Unknown outputId/);

  const dir = await makeProject();
  const packed = await client.callTool({
    name: "pack_codebase",
    arguments: { directory: dir },
  });
  const outputId = firstText(packed).match(/outputId: ([0-9a-f]+)/)![1];
  const badRegex = await client.callTool({
    name: "grep_output",
    arguments: { outputId, pattern: "([unclosed" },
  });
  assert.equal(badRegex.isError, true);
  assert.match(firstText(badRegex), /Invalid regular expression/);

  await fs.rm(dir, { recursive: true, force: true });
  await client.close();
});

test("MCP: pack_codebase rejects non-directories", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "pack_codebase",
    arguments: { directory: "/definitely/not/a/real/path" },
  });
  assert.equal(result.isError, true);
  assert.match(firstText(result), /not a directory/);
  await client.close();
});
