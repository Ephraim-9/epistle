#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import clipboardy from "clipboardy";
import gradient from "gradient-string";
import { scanProject } from "./lib/scanner.js";
import { formatOutput, type OutputFormat } from "./lib/formatter.js";

async function main() {
  const program = new Command();

  program
    .name("epistle")
    .description(
      "Pack a local codebase into a single, LLM-friendly context file.",
    )
    .option("-o, --output <file>", "Output file path")
    .option("-c, --copy", "Copy the generated context to the clipboard")
    .option(
      "-e, --exclude <pattern...>",
      "Additional glob patterns to exclude from scanning",
    )
    .option(
      "--format <format>",
      'Output format: "markdown" (default) or "xml"',
      "markdown",
    )
    .version("0.1.0");

  program.parse(process.argv);
  const opts = program.opts<{
    output?: string;
    copy?: boolean;
    exclude?: string[];
    format?: string;
  }>();

  const format = (opts.format ?? "markdown").toLowerCase() as OutputFormat;
  if (format !== "markdown" && format !== "xml") {
    console.error(
      chalk.red(
        `Invalid --format value "${opts.format}". Supported values are "markdown" and "xml".`,
      ),
    );
    process.exit(1);
  }

  // High-end banner
  const banner = gradient.atlas("EPISTLE");
  console.error(banner);
  console.error("");

  const rootDir = process.cwd();
  const spinner = ora({
    text: chalk.cyan("Scanning project..."),
  }).start();

  try {
    const files = await scanProject({
      rootDir,
      excludeGlobs: opts.exclude,
    });

    spinner.text = chalk.cyan("Formatting output...");

    const output = formatOutput(files, {
      format,
      rootDir,
    });

    const outputPath = opts.output
      ? path.resolve(rootDir, opts.output)
      : undefined;

    if (outputPath) {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, output, "utf8");
    } else {
      // Write to stdout only; banner/spinner messages go to stderr
      process.stdout.write(output + "\n");
    }

    if (opts.copy) {
      try {
        await clipboardy.write(output);
      } catch (err) {
        console.error(
          chalk.yellow(
            `Warning: Failed to copy output to clipboard: ${
              (err as Error).message
            }`,
          ),
        );
      }
    }

    spinner.succeed(
      chalk.green(
        `Packed ${files.length} files` +
          (outputPath ? ` into ${outputPath}` : " to stdout") +
          `.`,
      ),
    );
  } catch (err) {
    spinner.fail(chalk.red("Failed to generate Epistle context."));
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}

void main();

