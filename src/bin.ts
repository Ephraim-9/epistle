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
  type DirectoryTokenMap,
  type FileTokenStat,
  type OutputFormat,
  type PersonaType,
} from "./lib/formatter.js";

const TOKEN_BUDGET_WARNING = 50000;

type HogMode = "files" | "dirs" | "auto";

interface HogEntry {
  path: string;
  tokens: number;
  isDir: boolean;
}

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
      "-i, --include <pattern...>",
      "Glob patterns to force-include after filtering",
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
    .option(
      "-l, --lite",
      "Enable lite mode: auto-prune heavy assets and data files",
    )
    .option(
      "--hog-depth <value>",
      "Depth for context hog report: 0 (files), >0 (directories), or 'auto'",
    )
    .version("0.3.0");

  program.parse(process.argv);
  const opts = program.opts<{
    output?: string;
    copy?: boolean;
    exclude?: string[];
    include?: string[];
    format?: string;
    persona?: string;
    clean?: boolean;
    stdout?: boolean;
    task?: string;
    lite?: boolean;
    hogDepth?: string;
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

    if (opts.lite) {
      excludeGlobs.push(
        "**/*.css",
        "**/*.scss",
        "**/*.sass",
        "**/*.less",
        "**/*.json",
        "**/*.svg",
        "**/*.png",
        "**/*.jpg",
        "**/*.jpeg",
        "**/*.ico",
        "**/*.ttf",
        "**/*.otf",
        "**/*.woff",
        "**/*.woff2",
      );
      // Always preserve package.json even when excluding all JSON files
      excludeGlobs.push("!package.json");
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

    const { files, ignoredEntries } = await scanProject({
      rootDir,
      excludeGlobs,
      includeGlobs: opts.include,
    });

    spinner.text = chalk.cyan("Formatting output...");

    const { output, totalTokens, fileTokenStats, dirTokenMap } = formatOutput(
      files,
      {
      format,
      rootDir,
      persona,
      task: opts.task,
      },
    );

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

    // Determine hog mode and entries (based on already-pruned files list)
    const { hogMode, hogDepth, hogEntries } = computeHogsForProject({
      fileTokenStats,
      dirTokenMap,
      totalTokens,
      hogDepthRaw: opts.hogDepth,
    });

    if (hogEntries.length > 0) {
      console.error("");
      console.error(chalk.cyan("Top Context Hogs"));
      console.error(
        chalk.dim(
          hogMode === "files"
            ? "Mode: files (top 5 largest files by tokens)"
            : hogMode === "dirs"
              ? `Mode: directories at depth ${hogDepth} (top 5 by tokens)`
              : "Mode: auto (top 3 files + top 2 directories)",
        ),
      );
      for (const entry of hogEntries) {
        console.error(formatHogEntry(entry, totalTokens));
      }
      console.error("");
    }

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

    const prunedCount = Math.max(ignoredEntries, 0);
    const statsLine = `Stats: ${files.length} files | Pruned: ${prunedCount} files | ${tokenColor(
      `${totalTokens} tokens`,
    )}`;

    const lines: string[] = [];
    lines.push(`Project: ${projectName}`);
    lines.push(`Persona: ${personaLabel}`);
    const modeLabel = opts.lite ? chalk.green("Lite") : "Full";
    lines.push(`Mode: ${modeLabel}`);
    lines.push(statsLine);
    if (hogEntries.length > 0) {
      lines.push("Top Context Hogs:");
      const maxDashboardEntries = 5;
      for (const entry of hogEntries.slice(0, maxDashboardEntries)) {
        lines.push(formatHogEntry(entry, totalTokens));
      }
    }
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

function parseHogDepth(raw?: string): { mode: HogMode; depth?: number } {
  if (!raw || raw.trim().length === 0 || raw === "0") {
    return { mode: "files" };
  }

  if (raw.toLowerCase() === "auto") {
    return { mode: "auto" };
  }

  const n = Number(raw);
  if (!Number.isNaN(n) && n > 0 && Number.isFinite(n)) {
    return { mode: "dirs", depth: Math.floor(n) };
  }

  console.error(
    chalk.yellow(
      `Warning: Invalid --hog-depth value "${raw}". Falling back to file-based hog report.`,
    ),
  );
  return { mode: "files" };
}

function getDirDepth(pathStr: string): number {
  if (!pathStr) return 0;
  return pathStr.split("/").filter(Boolean).length;
}

function computeTopFileHogs(
  fileTokenStats: FileTokenStat[],
  limit: number,
): HogEntry[] {
  return fileTokenStats
    .filter((s) => s.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, limit)
    .map((s) => ({
      path: s.path,
      tokens: s.tokens,
      isDir: false,
    }));
}

function computeTopDirHogs(
  dirTokenMap: DirectoryTokenMap,
  depth: number,
  limit: number,
): HogEntry[] {
  const entries: HogEntry[] = [];

  for (const [dirPath, tokens] of dirTokenMap.entries()) {
    if (dirPath === "") continue; // Skip synthetic root
    if (tokens <= 0) continue;
    if (getDirDepth(dirPath) !== depth) continue;

    entries.push({
      path: dirPath + "/",
      tokens,
      isDir: true,
    });
  }

  return entries.sort((a, b) => b.tokens - a.tokens).slice(0, limit);
}

function computeAutoDirDepth(dirTokenMap: DirectoryTokenMap): number | undefined {
  const depths = new Set<number>();
  for (const [dirPath, tokens] of dirTokenMap.entries()) {
    if (dirPath === "") continue;
    if (tokens <= 0) continue;
    depths.add(getDirDepth(dirPath));
  }
  if (depths.size === 0) return undefined;
  return Math.min(...depths);
}

function computeHogsForProject(input: {
  fileTokenStats: FileTokenStat[];
  dirTokenMap: DirectoryTokenMap;
  totalTokens: number;
  hogDepthRaw?: string;
}): { hogMode: HogMode; hogDepth?: number; hogEntries: HogEntry[] } {
  const { mode, depth } = parseHogDepth(input.hogDepthRaw);
  const hogMode: HogMode = mode;
  const hogEntries: HogEntry[] = [];

  if (input.totalTokens <= 0) {
    return { hogMode, hogDepth: depth, hogEntries };
  }

  if (hogMode === "files") {
    hogEntries.push(...computeTopFileHogs(input.fileTokenStats, 5));
    return { hogMode, hogDepth: 0, hogEntries };
  }

  if (hogMode === "dirs") {
    const d = depth ?? 1;
    hogEntries.push(
      ...computeTopDirHogs(input.dirTokenMap, d, 5),
    );
    return { hogMode, hogDepth: d, hogEntries };
  }

  // auto: mix of files and directories
  const topFiles = computeTopFileHogs(input.fileTokenStats, 3);
  const autoDepth =
    depth ?? computeAutoDirDepth(input.dirTokenMap) ?? 1;
  const topDirs = computeTopDirHogs(input.dirTokenMap, autoDepth, 2);

  hogEntries.push(...topFiles, ...topDirs);
  return { hogMode, hogDepth: autoDepth, hogEntries };
}

function formatHogEntry(entry: HogEntry, totalTokens: number): string {
  const icon = entry.isDir ? "📁" : "📄";
  const pct =
    totalTokens > 0 ? (entry.tokens / totalTokens) * 100 : 0;
  let pctLabel = `${pct.toFixed(1)}%`;

  if (pct > 20) {
    pctLabel = chalk.red(pctLabel);
  } else if (pct > 10) {
    pctLabel = chalk.yellow(pctLabel);
  }

  return `${icon} ${entry.path} - ${entry.tokens} (${pctLabel})`;
}

void main();

