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
import {
  formatOutput,
  type OutputFormat,
  type PersonaType,
} from "./lib/formatter.js";

const TOKEN_BUDGET_WARNING = 50000;

const PERSONA_ALIASES: Record<string, PersonaType> = {
  arch: "architect",
  sec: "security",
  ref: "refactor",
};

function resolvePersona(raw: string): PersonaType | undefined {
  const key = raw.toLowerCase();
  return PERSONA_ALIASES[key] ?? (key as PersonaType);
}

function personaToDefaultSlug(persona: PersonaType): string {
  const slugs: Record<PersonaType, string> = {
    architect: "arch",
    security: "sec",
    refactor: "ref",
  };
  return slugs[persona];
}

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
      "-t, --task <instruction>",
      "User task or instructions to attach to the context",
    )
    .option("--stdout", "Force writing output to stdout even when terminal is interactive")
    .option(
      "--format <format>",
      'Output format: "markdown" (default) or "xml"',
      "markdown",
    )
    .option(
      "--persona <type>",
      "Persona for system header: architect | security | refactor (aliases: arch, sec, ref)",
    )
    .option(
      "--clean",
      "Delete existing context.md and epistle-*.md in project root before scanning",
    )
    .version("0.2.3");

  program.parse(process.argv);
  const opts = program.opts<{
    output?: string;
    copy?: boolean;
    exclude?: string[];
    format?: string;
    persona?: string;
    clean?: boolean;
    stdout?: boolean;
    task?: string;
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

  const rawPersona = opts.persona?.toLowerCase();
  let persona: PersonaType | undefined;
  if (rawPersona) {
    const resolved = resolvePersona(rawPersona);
    if (
      resolved === "architect" ||
      resolved === "security" ||
      resolved === "refactor"
    ) {
      persona = resolved;
    } else {
      console.error(
        chalk.red(
          `Invalid --persona value "${opts.persona}". Supported values are "architect", "security", "refactor" (or aliases: arch, sec, ref).`,
        ),
      );
      process.exit(1);
    }
  }

  // High-end banner
  const banner = gradient.atlas("EPISTLE");
  console.error(banner);
  console.error("");

  const rootDir = process.cwd();

  let outputPath: string | undefined;
  let usedAutoOutput = false;
  if (opts.output) {
    outputPath = path.resolve(rootDir, opts.output);
  } else if (persona) {
    const defaultName = `epistle-${personaToDefaultSlug(persona)}.md`;
    outputPath = path.join(rootDir, defaultName);
    usedAutoOutput = true;
  }

  if (usedAutoOutput) {
    const defaultName = `epistle-${personaToDefaultSlug(persona!)}.md`;
    console.error(
      chalk.cyan(
        `🚀 No output specified. Using default: ${defaultName}`,
      ),
    );
  }

  const spinner = ora({
    text: chalk.cyan("Scanning project..."),
  }).start();

  try {
    const excludeGlobs: string[] = [...(opts.exclude ?? [])];

    if (outputPath) {
      const outputRel = path.relative(rootDir, outputPath) || outputPath;
      excludeGlobs.push(outputRel);
    }

    if (opts.clean) {
      const toRemove: string[] = [path.join(rootDir, "context.md")];
      try {
        const entries = await fs.readdir(rootDir);
        for (const name of entries) {
          if (name.startsWith("epistle-") && name.endsWith(".md")) {
            toRemove.push(path.join(rootDir, name));
          }
        }
      } catch {
        // Ignore readdir errors
      }
      for (const file of toRemove) {
        try {
          await fs.unlink(file);
        } catch {
          // Ignore if missing or other error
        }
      }
    }

    const files = await scanProject({
      rootDir,
      excludeGlobs,
    });

    spinner.text = chalk.cyan("Formatting output...");

    const { output, totalTokens } = formatOutput(files, {
      format,
      rootDir,
      persona,
      task: opts.task,
    });

    if (totalTokens > TOKEN_BUDGET_WARNING) {
      console.error(
        chalk.yellow(
          "⚠️  Warning: Total tokens exceed 50k. Consider using --exclude to prune large directories or data files.",
        ),
      );
    }

    const shouldWriteStdout =
      !outputPath && (!process.stdout.isTTY || opts.stdout === true);

    if (outputPath) {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, output, "utf8");
    } else if (shouldWriteStdout) {
      // Write to stdout only; banner/spinner messages go to stderr
      process.stdout.write(output + "\n");
    } else {
      console.error(
        chalk.yellow(
          "Output blocked to prevent terminal flood. Use -o <file> or add the --stdout flag to force display.",
        ),
      );
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

    // Dashboard summary box (stderr)
    let projectName: string = path.basename(rootDir);
    try {
      const pkgRaw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
      const pkg = JSON.parse(pkgRaw) as { name?: unknown };
      if (typeof pkg.name === "string" && pkg.name.trim().length > 0) {
        projectName = pkg.name;
      }
    } catch {
      // Ignore missing or invalid package.json; fall back to folder name
    }

    const personaLabel =
      persona === "architect"
        ? "Architect"
        : persona === "security"
          ? "Security"
          : persona === "refactor"
            ? "Refactor"
            : "Default";

    const taskPreview = "(none)";

    const tokenColor =
      totalTokens < 50000
        ? chalk.green
        : totalTokens <= 100000
          ? chalk.yellow
          : chalk.red;

    const statsLine = `Stats: ${files.length} files | ${tokenColor(
      `${totalTokens} tokens`,
    )}`;

    const lines: string[] = [];
    lines.push(`Project: ${projectName}`);
    lines.push(`Persona: ${personaLabel}`);
    lines.push(statsLine);
    lines.push(`Task: ${taskPreview}`);

    const contentWidth = lines.reduce(
      (max, line) => Math.max(max, line.length),
      0,
    );

    const topBorder = "┏" + "━".repeat(contentWidth + 2) + "┓";
    const bottomBorder = "┗" + "━".repeat(contentWidth + 2) + "┛";

    console.error(topBorder);
    for (const line of lines) {
      const padding = " ".repeat(contentWidth - line.length);
      console.error(`┃ ${line}${padding} ┃`);
    }
    console.error(bottomBorder);

    console.error(
      chalk.dim(
        "Tip: Add your output file to .gitignore to keep your repo clean.",
      ),
    );
  } catch (err) {
    spinner.fail(chalk.red("Failed to generate Epistle context."));
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}

void main();

