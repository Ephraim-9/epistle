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
  OUTPUT_FORMATS,
  TOKEN_ENCODINGS,
  type DirectoryTokenMap,
  type FileTokenStat,
  type OutputFormat,
  type PersonaType,
  type TokenEncoding,
} from "./lib/formatter.js";
import { initConfig, loadConfig, CONFIG_FILE_NAME } from "./lib/config.js";
import { transformContent } from "./lib/compress.js";
import {
  cloneRemote,
  getChangedFiles,
  getChurnCounts,
  getDiffText,
  getLogText,
  isGitRepo,
  remoteRepoName,
} from "./lib/git.js";
import { getRecipe, recipeNames } from "./lib/recipes.js";
import { applyProfile } from "./lib/config.js";

const VERSION = "0.8.0";

type SortMode = "path" | "churn" | "size";

/** Context windows of popular models, for the --fit report. */
const MODEL_WINDOWS: Array<{ label: string; window: number }> = [
  { label: "Claude (Sonnet/Opus)", window: 200_000 },
  { label: "GPT-4o / GPT-4.1", window: 128_000 },
  { label: "Gemini 2.5 Pro", window: 1_000_000 },
  { label: "Llama 4 / local 128k", window: 128_000 },
  { label: "Local 32k", window: 32_000 },
];

function renderFitReport(totalTokens: number): string[] {
  const lines: string[] = [];
  const barWidth = 20;
  for (const { label, window } of MODEL_WINDOWS) {
    const ratio = totalTokens / window;
    const pct = Math.round(ratio * 100);
    const filled = Math.min(barWidth, Math.round(ratio * barWidth));
    const bar =
      "█".repeat(filled) + "░".repeat(Math.max(0, barWidth - filled));
    const colored =
      ratio > 1 ? chalk.red(bar) : ratio > 0.7 ? chalk.yellow(bar) : chalk.green(bar);
    const pctLabel = ratio > 1 ? chalk.red(`${pct}% — DOES NOT FIT`) : `${pct}%`;
    lines.push(`  ${label.padEnd(22)} ${colored} ${pctLabel}`);
  }
  return lines;
}
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

function extensionForFormat(format: OutputFormat): string {
  switch (format) {
    case "xml":
      return ".xml";
    case "json":
      return ".json";
    case "plain":
      return ".txt";
    default:
      return ".md";
  }
}

async function main() {
  const program = new Command();

  program
    .name("epistle")
    .description(
      "Pack a local codebase into a single, LLM-friendly context file.",
    )
    .argument(
      "[paths...]",
      "Files or directories to pack (default: current directory)",
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
    .option(
      "--stdout",
      "Force writing output to stdout even when terminal is interactive",
    )
    .option(
      "--format <format>",
      'Output format: "markdown" (default), "xml", "plain", or "json"',
    )
    .option(
      "--persona <type>",
      "Persona for system header: architect | security | refactor (aliases: arch, sec, ref)",
    )
    .option(
      "--clean",
      "Delete existing context.md and epistle-* outputs in project root before scanning",
    )
    .option(
      "-l, --lite",
      "Enable lite mode: auto-prune heavy assets and data files",
    )
    .option("-n, --line-numbers", "Prefix file contents with line numbers")
    .option(
      "--remove-comments",
      "Strip comments from source files (JS/TS, Python, CSS, HTML, SQL, and more)",
    )
    .option("--remove-empty-lines", "Remove blank lines from file contents")
    .option(
      "--compress",
      "Signature-only compression: keep imports and declarations, elide bodies",
    )
    .option(
      "--max-tokens <count>",
      "Drop the largest files until output fits within this token budget",
    )
    .option(
      "--diff [ref]",
      "Pack only files changed vs ref (default HEAD), including untracked files",
    )
    .option(
      "--include-diffs",
      "Append working-tree and staged git diffs to the output",
    )
    .option(
      "--include-logs [count]",
      "Append recent commit history to the output (default: 20 commits)",
    )
    .option(
      "--sort <mode>",
      'File order: "path" (default), "churn" (most-edited last), or "size" (largest last)',
    )
    .option(
      "--no-redact",
      "Disable automatic secret redaction (output will carry a warning)",
    )
    .option(
      "--encoding <name>",
      `Tokenizer for token counts: ${TOKEN_ENCODINGS.join(" | ")} (default: o200k_base)`,
    )
    .option(
      "--fit",
      "Show how the pack fits into popular model context windows",
    )
    .option("-q, --quiet", "Suppress all non-error console output")
    .option("--verbose", "Print extra detail (config source, timings, prune counts)")
    .option("--stdin", "Read file paths to pack from stdin (one per line)")
    .option("-0, --null", "With --stdin: paths are NUL-separated (find -print0)")
    .option("--tree-only", "Output only the directory tree, no file contents")
    .option(
      "--remote <url>",
      "Pack a remote git repository (URL or user/repo shorthand)",
    )
    .option("--remote-branch <name>", "Branch, tag, or commit for --remote")
    .option("--profile <name>", "Apply a named profile from the config file")
    .option(
      "--recipe <name>",
      `Append a curated analysis prompt: ${recipeNames().join(" | ")}`,
    )
    .option(
      "--max-file-size <kb>",
      "Skip files larger than this many kilobytes (default: 100)",
    )
    .option(
      "--dry-run",
      "Preview which files would be packed (with token counts) without writing output",
    )
    .option("--config <path>", `Path to config file (default: ${CONFIG_FILE_NAME})`)
    .option("--init", "Create a starter epistle.config.json and exit")
    .option(
      "--hog-depth <value>",
      "Depth for context hog report: 0 (files), >0 (directories), or 'auto'",
    )
    .version(VERSION);

  program.parse(process.argv);
  const scanPaths = program.args;
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
    lineNumbers?: boolean;
    maxFileSize?: string;
    removeComments?: boolean;
    removeEmptyLines?: boolean;
    compress?: boolean;
    maxTokens?: string;
    diff?: string | boolean;
    includeDiffs?: boolean;
    includeLogs?: string | boolean;
    sort?: string;
    redact?: boolean;
    encoding?: string;
    fit?: boolean;
    quiet?: boolean;
    verbose?: boolean;
    stdin?: boolean;
    null?: boolean;
    treeOnly?: boolean;
    remote?: string;
    remoteBranch?: string;
    profile?: string;
    recipe?: string;
    dryRun?: boolean;
    config?: string;
    init?: boolean;
    hogDepth?: string;
  }>();

  const rootDir = process.cwd();

  if (opts.init) {
    try {
      const configPath = await initConfig(rootDir);
      console.error(chalk.green(`Created ${path.relative(rootDir, configPath)}`));
      process.exit(0);
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  }

  let config;
  let configPathUsed: string | undefined;
  try {
    const loaded = await loadConfig(rootDir, opts.config);
    config = loaded.config;
    configPathUsed = loaded.configPath;
    if (opts.profile) {
      config = applyProfile(config, opts.profile);
    }
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  const quiet = opts.quiet ?? false;
  const verboseMode = (opts.verbose ?? false) && !quiet;
  const info = (...args: unknown[]) => {
    if (!quiet) console.error(...args);
  };
  const verbose = (...args: unknown[]) => {
    if (verboseMode) console.error(...args);
  };

  // CLI flags win over config values
  const format = (
    opts.format ??
    config.output?.format ??
    "markdown"
  ).toLowerCase() as OutputFormat;
  if (!OUTPUT_FORMATS.includes(format)) {
    console.error(
      chalk.red(
        `Invalid --format value "${opts.format ?? config.output?.format}". Supported values: ${OUTPUT_FORMATS.join(", ")}.`,
      ),
    );
    process.exit(1);
  }

  const rawPersona = (opts.persona ?? config.persona)?.toLowerCase();
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
          `Invalid --persona value "${rawPersona}". Supported values are "architect", "security", "refactor" (or aliases: arch, sec, ref).`,
        ),
      );
      process.exit(1);
    }
  }

  const lite = opts.lite ?? config.lite ?? false;

  let task = opts.task ?? config.task;
  if (opts.recipe) {
    const recipe = getRecipe(opts.recipe);
    if (!recipe) {
      console.error(
        chalk.red(
          `Unknown --recipe "${opts.recipe}". Available recipes: ${recipeNames().join(", ")}.`,
        ),
      );
      process.exit(1);
    }
    task = task ? `${task}\n\n${recipe.prompt}` : recipe.prompt;
  }

  const copy = opts.copy ?? config.output?.copy ?? false;
  const lineNumbers = opts.lineNumbers ?? config.output?.lineNumbers ?? false;

  const sortMode = (opts.sort ?? config.sort ?? "path").toLowerCase() as SortMode;
  if (sortMode !== "path" && sortMode !== "churn" && sortMode !== "size") {
    console.error(
      chalk.red(
        `Invalid --sort value "${opts.sort}". Supported values: path, churn, size.`,
      ),
    );
    process.exit(1);
  }

  const includeDiffs = opts.includeDiffs ?? config.includeDiffs ?? false;
  const includeLogsRaw = opts.includeLogs ?? config.includeLogs;
  let includeLogsCount: number | undefined;
  if (includeLogsRaw !== undefined && includeLogsRaw !== false) {
    if (includeLogsRaw === true) {
      includeLogsCount = 20;
    } else {
      const parsed = Number(includeLogsRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        console.error(
          chalk.red(
            `Invalid --include-logs value "${includeLogsRaw}". Provide a positive commit count.`,
          ),
        );
        process.exit(1);
      }
      includeLogsCount = Math.floor(parsed);
    }
  }

  const redact = opts.redact !== false && config.redact !== false;

  const encodingRaw = (
    opts.encoding ??
    config.encoding ??
    "o200k_base"
  ).toLowerCase();
  if (!TOKEN_ENCODINGS.includes(encodingRaw as TokenEncoding)) {
    console.error(
      chalk.red(
        `Invalid --encoding value "${encodingRaw}". Supported values: ${TOKEN_ENCODINGS.join(", ")}.`,
      ),
    );
    process.exit(1);
  }
  const encoding = encodingRaw as TokenEncoding;

  const removeComments = opts.removeComments ?? config.removeComments ?? false;
  const removeEmptyLines =
    opts.removeEmptyLines ?? config.removeEmptyLines ?? false;
  const compress = opts.compress ?? config.compress ?? false;

  let maxTokens: number | undefined = config.maxTokens;
  if (opts.maxTokens !== undefined) {
    const parsed = Number(opts.maxTokens);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      console.error(
        chalk.red(
          `Invalid --max-tokens value "${opts.maxTokens}". Provide a positive number.`,
        ),
      );
      process.exit(1);
    }
    maxTokens = Math.floor(parsed);
  }

  let maxFileSizeKB = config.maxFileSizeKB ?? 100;
  if (opts.maxFileSize !== undefined) {
    const parsed = Number(opts.maxFileSize);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      console.error(
        chalk.red(
          `Invalid --max-file-size value "${opts.maxFileSize}". Provide a positive number of kilobytes.`,
        ),
      );
      process.exit(1);
    }
    maxFileSizeKB = parsed;
  }

  // High-end banner (interactive terminals only)
  if (!quiet && process.stderr.isTTY) {
    const banner = gradient.atlas("EPISTLE");
    console.error(banner);
    console.error("");
  }

  if (configPathUsed) {
    verbose(chalk.dim(`Config: ${configPathUsed}`));
  }
  if (opts.profile) {
    info(chalk.cyan(`Profile: ${opts.profile}`));
  }

  // Read scan paths from stdin (pipe from find/fzf/git ls-files)
  let stdinPaths: string[] | undefined;
  if (opts.stdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    stdinPaths = raw
      .split(opts.null ? "\0" : "\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (stdinPaths.length === 0) {
      console.error(chalk.red("--stdin was given but no paths were read."));
      process.exit(1);
    }
  }
  const effectiveScanPaths = stdinPaths ?? scanPaths;

  // Remote repository ingestion
  let remoteDir: string | undefined;
  if (opts.remote) {
    info(chalk.cyan(`⬇ Cloning ${opts.remote} (shallow)...`));
    try {
      remoteDir = await cloneRemote(opts.remote, opts.remoteBranch);
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }
  }
  /** Directory actually scanned (clone dir for --remote, else cwd) */
  const scanRoot = remoteDir ?? rootDir;

  let outputPath: string | undefined;
  let usedAutoOutput = false;
  const configuredOutput = opts.output ?? config.output?.file;
  if (configuredOutput) {
    outputPath = path.resolve(rootDir, configuredOutput);
  } else if (opts.remote) {
    const defaultName = `epistle-${remoteRepoName(opts.remote)}${extensionForFormat(format)}`;
    outputPath = path.join(rootDir, defaultName);
    usedAutoOutput = true;
  } else if (persona) {
    const defaultName = `epistle-${personaToDefaultSlug(persona)}${extensionForFormat(format)}`;
    outputPath = path.join(rootDir, defaultName);
    usedAutoOutput = true;
  }

  // With --stdout (or piped output and no explicit -o), don't write a file
  if (usedAutoOutput && (opts.stdout === true || !process.stdout.isTTY)) {
    outputPath = undefined;
    usedAutoOutput = false;
  }

  if (usedAutoOutput && !opts.dryRun) {
    info(
      chalk.cyan(
        `🚀 No output specified. Using default: ${path.basename(outputPath!)}`,
      ),
    );
  }

  const startedAt = Date.now();
  const spinner = ora({
    text: chalk.cyan("Scanning project..."),
    isSilent: quiet || !process.stderr.isTTY,
  }).start();

  try {
    const excludeGlobs: string[] = [
      ...(config.exclude ?? []),
      ...(opts.exclude ?? []),
    ];

    if (outputPath) {
      const outputRel = path.relative(rootDir, outputPath) || outputPath;
      excludeGlobs.push(outputRel);
    }

    if (lite) {
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

    if (opts.clean && !opts.dryRun) {
      const toRemove: string[] = [path.join(rootDir, "context.md")];
      try {
        const entries = await fs.readdir(rootDir);
        for (const name of entries) {
          if (
            name.startsWith("epistle-") &&
            /\.(md|xml|json|txt)$/.test(name)
          ) {
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

    const scanResult = await scanProject({
      rootDir: scanRoot,
      scanPaths: effectiveScanPaths,
      excludeGlobs,
      includeGlobs: [...(config.include ?? []), ...(opts.include ?? [])],
      maxFileSizeBytes: maxFileSizeKB * 1024,
    });
    let files = scanResult.files;
    const { ignoredEntries } = scanResult;

    // Git-aware features
    const needsGit =
      opts.diff !== undefined ||
      includeDiffs ||
      includeLogsCount !== undefined ||
      sortMode === "churn";
    let gitAvailable = false;
    if (needsGit) {
      gitAvailable = await isGitRepo(scanRoot);
      if (!gitAvailable && opts.diff !== undefined) {
        throw new Error(
          "--diff requires a git repository, but none was found at " + scanRoot,
        );
      }
      if (!gitAvailable) {
        info(
          chalk.yellow(
            "Warning: not a git repository; git-based options were skipped.",
          ),
        );
      }
    }

    if (opts.diff !== undefined && gitAvailable) {
      const ref = typeof opts.diff === "string" ? opts.diff : "HEAD";
      const changed = await getChangedFiles(scanRoot, ref);
      if (changed === undefined) {
        throw new Error(
          `Could not compute changed files vs "${ref}". Is the ref valid?`,
        );
      }
      const changedSet = new Set(changed);
      files = files.filter((f) => changedSet.has(f.path));
      info(
        chalk.cyan(
          `Δ Diff mode: packing ${files.length} changed file(s) vs ${ref}.`,
        ),
      );
    }

    if (sortMode === "churn" && gitAvailable) {
      const churn = (await getChurnCounts(scanRoot)) ?? new Map<string, number>();
      // Most-edited files LAST: LLMs weight the end of context most heavily
      files = [...files].sort(
        (a, b) =>
          (churn.get(a.path) ?? 0) - (churn.get(b.path) ?? 0) ||
          a.path.localeCompare(b.path),
      );
    } else if (sortMode === "size") {
      files = [...files].sort(
        (a, b) => a.sizeBytes - b.sizeBytes || a.path.localeCompare(b.path),
      );
    }

    let gitDiffText: string | undefined;
    if (includeDiffs && gitAvailable) {
      gitDiffText = await getDiffText(scanRoot);
      if (!gitDiffText) gitDiffText = undefined;
    }

    let gitLogText: string | undefined;
    if (includeLogsCount !== undefined && gitAvailable) {
      gitLogText = await getLogText(scanRoot, includeLogsCount);
      if (!gitLogText) gitLogText = undefined;
    }

    // Content-shaping transforms (comment stripping, blank lines, compression)
    let originalChars = 0;
    let transformedChars = 0;
    let compressedFileCount = 0;
    if (removeComments || removeEmptyLines || compress) {
      for (const file of files) {
        if (!file.content || file.isBinary || file.isOversized) continue;
        originalChars += file.content.length;
        const { content, compressed } = transformContent(
          file.path,
          file.content,
          { removeComments, removeEmptyLines, compress },
        );
        file.content = content;
        transformedChars += content.length;
        if (compressed) compressedFileCount++;
      }
    }

    spinner.text = chalk.cyan("Formatting output...");

    const formatOpts = {
      format,
      rootDir: scanRoot,
      persona,
      task,
      lineNumbers,
      maxFileSizeKB,
      sortMode: (sortMode === "path" ? "path" : "given") as "path" | "given",
      gitDiff: gitDiffText,
      gitLog: gitLogText,
      redact,
      encoding,
    };

    if (scanResult.suspiciousSkipped.length > 0) {
      console.error(
        chalk.yellow(
          `🔒 Excluded ${scanResult.suspiciousSkipped.length} credential-shaped file(s): ${scanResult.suspiciousSkipped
            .slice(0, 5)
            .join(", ")}${scanResult.suspiciousSkipped.length > 5 ? ", …" : ""}`,
        ),
      );
    }

    let { output, totalTokens, fileTokenStats, dirTokenMap, treeText } =
      formatOutput(files, formatOpts);

    // Token budget enforcement: drop the heaviest files until the pack fits.
    const omittedForBudget: string[] = [];
    if (maxTokens !== undefined && totalTokens > maxTokens) {
      const byTokensDesc = [...fileTokenStats].sort(
        (a, b) => b.tokens - a.tokens,
      );
      let estimated = totalTokens;
      for (const stat of byTokensDesc) {
        if (estimated <= maxTokens) break;
        if (stat.path === "package.json") continue; // always keep the manifest
        const file = files.find((f) => f.path === stat.path);
        if (!file || !file.content) continue;
        file.isOmitted = true;
        delete file.content;
        omittedForBudget.push(stat.path);
        estimated -= stat.tokens;
      }
      ({ output, totalTokens, fileTokenStats, dirTokenMap, treeText } =
        formatOutput(files, formatOpts));
    }

    if (opts.dryRun) {
      spinner.succeed(chalk.green("Dry run complete. No output written."));
      console.error("");
      const sorted = [...fileTokenStats].sort((a, b) => b.tokens - a.tokens);
      const pad = String(
        sorted.length > 0 ? sorted[0].tokens : 0,
      ).length;
      for (const stat of sorted) {
        console.error(
          `  ${chalk.yellow(String(stat.tokens).padStart(pad))}  ${stat.path}`,
        );
      }
      console.error("");
      console.error(
        `${chalk.cyan("Total:")} ${files.length} files, ${totalTokens} tokens` +
          (ignoredEntries > 0 ? ` (${ignoredEntries} entries pruned)` : ""),
      );
      return;
    }

    if (totalTokens > TOKEN_BUDGET_WARNING) {
      info(
        chalk.yellow(
          "⚠️  Warning: Total tokens exceed 50k. Consider using --exclude to prune large directories or data files.",
        ),
      );
    }

    if (opts.treeOnly) {
      output = treeText + "\n";
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

    if (copy) {
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

    const elapsedMs = Date.now() - startedAt;
    spinner.succeed(
      chalk.green(
        `Packed ${files.length} files` +
          (outputPath ? ` into ${outputPath}` : " to stdout") +
          ` in ${elapsedMs}ms.`,
      ),
    );
    verbose(
      chalk.dim(
        `Scanned ${scanResult.totalEntries} entries, pruned ${scanResult.ignoredEntries}.`,
      ),
    );

    if (
      (removeComments || removeEmptyLines || compress) &&
      originalChars > 0
    ) {
      const savedPct = Math.round(
        ((originalChars - transformedChars) / originalChars) * 100,
      );
      const details: string[] = [];
      if (compress) details.push(`${compressedFileCount} files compressed to signatures`);
      if (removeComments) details.push("comments stripped");
      if (removeEmptyLines) details.push("blank lines removed");
      info(
        chalk.cyan(
          `🗜️  Content shaping saved ~${savedPct}% of characters (${details.join(", ")}).`,
        ),
      );
    }

    if (omittedForBudget.length > 0) {
      info(
        chalk.yellow(
          `✂️  Token budget ${maxTokens}: omitted ${omittedForBudget.length} file(s): ${omittedForBudget
            .slice(0, 5)
            .join(", ")}${omittedForBudget.length > 5 ? ", …" : ""}`,
        ),
      );
    }

    // Determine hog mode and entries (based on already-pruned files list)
    const { hogMode, hogDepth, hogEntries } = computeHogsForProject({
      fileTokenStats,
      dirTokenMap,
      totalTokens,
      hogDepthRaw: opts.hogDepth,
    });

    if (hogEntries.length > 0) {
      info("");
      info(chalk.cyan("Top Context Hogs"));
      info(
        chalk.dim(
          hogMode === "files"
            ? "Mode: files (top 5 largest files by tokens)"
            : hogMode === "dirs"
              ? `Mode: directories at depth ${hogDepth} (top 5 by tokens)`
              : "Mode: auto (top 3 files + top 2 directories)",
        ),
      );
      for (const entry of hogEntries) {
        info(formatHogEntry(entry, totalTokens));
      }
      info("");
    }

    if (opts.fit) {
      info("");
      info(chalk.cyan("Context Window Fit"));
      for (const line of renderFitReport(totalTokens)) {
        info(line);
      }
      info("");
    }

    // Dashboard summary box (stderr)
    let projectName: string = path.basename(scanRoot);
    try {
      const pkgRaw = await fs.readFile(
        path.join(scanRoot, "package.json"),
        "utf8",
      );
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

    const taskPreview =
      task && task.trim().length > 0
        ? task.length > 40
          ? task.slice(0, 37) + "..."
          : task
        : "(none)";

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
    const modeLabel = lite ? chalk.green("Lite") : "Full";
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

    info(topBorder);
    for (const line of lines) {
      const padding = " ".repeat(contentWidth - line.length);
      info(`┃ ${line}${padding} ┃`);
    }
    info(bottomBorder);

    info(
      chalk.dim(
        "Tip: Add your output file to .gitignore to keep your repo clean.",
      ),
    );
  } catch (err) {
    spinner.fail(chalk.red("Failed to generate Epistle context."));
    console.error(chalk.red((err as Error).message));
    if (remoteDir) {
      await fs.rm(remoteDir, { recursive: true, force: true });
    }
    process.exit(1);
  }

  if (remoteDir) {
    await fs.rm(remoteDir, { recursive: true, force: true });
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

function computeAutoDirDepth(
  dirTokenMap: DirectoryTokenMap,
): number | undefined {
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
    hogEntries.push(...computeTopDirHogs(input.dirTokenMap, d, 5));
    return { hogMode, hogDepth: d, hogEntries };
  }

  // auto: mix of files and directories
  const topFiles = computeTopFileHogs(input.fileTokenStats, 3);
  const autoDepth = depth ?? computeAutoDirDepth(input.dirTokenMap) ?? 1;
  const topDirs = computeTopDirHogs(input.dirTokenMap, autoDepth, 2);

  hogEntries.push(...topFiles, ...topDirs);
  return { hogMode, hogDepth: autoDepth, hogEntries };
}

function formatHogEntry(entry: HogEntry, totalTokens: number): string {
  const icon = entry.isDir ? "📁" : "📄";
  const pct = totalTokens > 0 ? (entry.tokens / totalTokens) * 100 : 0;
  let pctLabel = `${pct.toFixed(1)}%`;

  if (pct > 20) {
    pctLabel = chalk.red(pctLabel);
  } else if (pct > 10) {
    pctLabel = chalk.yellow(pctLabel);
  }

  return `${icon} ${entry.path} - ${entry.tokens} (${pctLabel})`;
}

void main();
