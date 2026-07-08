import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  COMPLETION_SHELLS,
  generateCompletionScript,
  type CompletionOption,
} from "../src/lib/completions.js";

const execFileAsync = promisify(execFile);

const sampleOptions: CompletionOption[] = [
  { long: "--output", short: "-o", takesValue: true, description: "Output file path" },
  { long: "--format", takesValue: true, description: "Output format" },
  { long: "--profile", takesValue: true, description: "Apply a named profile" },
  { long: "--copy", short: "-c", takesValue: false, description: 'Copy "quoted" text\nwith newline' },
];

const sampleValues = { "--format": ["markdown", "xml", "plain", "json"] };

test("all shells generate scripts containing every flag", () => {
  for (const shell of COMPLETION_SHELLS) {
    const script = generateCompletionScript(shell, sampleOptions, sampleValues);
    assert.ok(script.includes("format"), `${shell} mentions --format`);
    assert.ok(script.includes("profile"), `${shell} mentions --profile`);
    assert.ok(script.includes("copy"), `${shell} mentions --copy`);
    assert.ok(
      script.includes("epistle completion --list-profiles"),
      `${shell} completes profiles dynamically`,
    );
    assert.ok(
      script.includes("markdown xml plain json"),
      `${shell} completes --format values`,
    );
    assert.ok(!script.includes('"quoted"'), `${shell} sanitizes quotes in descriptions`);
  }
});

test("bash script passes bash -n syntax check", async () => {
  const script = generateCompletionScript("bash", sampleOptions, sampleValues);
  const file = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "epistle-comp-")),
    "epistle.bash",
  );
  await fs.writeFile(file, script);
  await execFileAsync("bash", ["-n", file]); // throws on syntax error
  await fs.rm(path.dirname(file), { recursive: true, force: true });
});

test("CLI: epistle completion <shell> prints a script, bad shell errors", async () => {
  const bin = path.resolve("src/bin.ts");
  const tsx = path.resolve("node_modules/.bin/tsx");

  const { stdout } = await execFileAsync(tsx, [bin, "completion", "bash"]);
  assert.ok(stdout.includes("_epistle"), "bash function present");
  assert.ok(stdout.includes("--format"), "real CLI flags present");
  assert.ok(stdout.includes("--max-tokens"), "real CLI flags present");

  const { stdout: fishOut } = await execFileAsync(tsx, [bin, "completion", "fish"]);
  assert.ok(fishOut.includes("complete -c epistle"), "fish completions present");

  await assert.rejects(
    execFileAsync(tsx, [bin, "completion", "powershell"]),
    /Supported shells/,
  );
});

test("CLI: completion --list-profiles prints profile names from config", async () => {
  const bin = path.resolve("src/bin.ts");
  const tsx = path.resolve("node_modules/.bin/tsx");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "epistle-comp-cfg-"));
  await fs.writeFile(
    path.join(dir, "epistle.config.json"),
    JSON.stringify({ profiles: { tiny: {}, "pr-review": {} } }),
  );
  const { stdout } = await execFileAsync(
    tsx,
    [bin, "completion", "--list-profiles"],
    { cwd: dir },
  );
  assert.deepEqual(stdout.trim().split("\n").sort(), ["pr-review", "tiny"]);

  // Broken config must not break TAB completion
  await fs.writeFile(path.join(dir, "epistle.config.json"), "{oops");
  const { stdout: empty } = await execFileAsync(
    tsx,
    [bin, "completion", "--list-profiles"],
    { cwd: dir },
  );
  assert.equal(empty.trim(), "");
  await fs.rm(dir, { recursive: true, force: true });
});
