import { scanProject, type ScannedFile } from "./scanner.js";
import {
  formatOutput,
  type FileTokenStat,
  type OutputFormat,
  type TokenEncoding,
} from "./formatter.js";
import { transformContent } from "./compress.js";
import {
  getChangedFiles,
  getChurnCounts,
  getDiffText,
  getLogText,
  isGitRepo,
} from "./git.js";

/**
 * Headless pack pipeline: scan → git awareness → content shaping →
 * format → token budget. Used by the MCP server; the CLI keeps its own
 * flow because it interleaves progress output between the same stages.
 */
export interface PackOptions {
  rootDir: string;
  /** Restrict to these paths (files or directories) relative to rootDir */
  scanPaths?: string[];
  format?: OutputFormat;
  encoding?: TokenEncoding;
  excludeGlobs?: string[];
  includeGlobs?: string[];
  maxFileSizeKB?: number;
  compress?: boolean;
  removeComments?: boolean;
  removeEmptyLines?: boolean;
  /** Drop the heaviest files until the pack fits this many tokens */
  maxTokens?: number;
  /** Pack only files changed vs this ref (e.g. "HEAD") */
  diffRef?: string;
  /** Append working-tree and staged diffs */
  includeDiffs?: boolean;
  /** Append this many recent commits */
  includeLogs?: number;
  /** "path" (default), "churn" (most-edited last), or "size" (largest last) */
  sort?: "path" | "churn" | "size";
  /** Task/instructions appended to the pack */
  task?: string;
}

export interface PackResult {
  output: string;
  totalTokens: number;
  totalFiles: number;
  fileTokenStats: FileTokenStat[];
  treeText: string;
  suspiciousSkipped: string[];
  omittedForBudget: string[];
}

/**
 * Drop the heaviest files (never package.json) until the estimated total
 * fits the budget. Mutates the file objects; returns the omitted paths.
 */
export function applyTokenBudget(
  files: ScannedFile[],
  fileTokenStats: FileTokenStat[],
  totalTokens: number,
  maxTokens: number,
): string[] {
  const omitted: string[] = [];
  if (totalTokens <= maxTokens) return omitted;

  const byTokensDesc = [...fileTokenStats].sort((a, b) => b.tokens - a.tokens);
  const filesByPath = new Map(files.map((f) => [f.path, f]));
  let estimated = totalTokens;
  for (const stat of byTokensDesc) {
    if (estimated <= maxTokens) break;
    if (stat.path === "package.json") continue; // always keep the manifest
    const file = filesByPath.get(stat.path);
    if (!file || !file.content) continue;
    file.isOmitted = true;
    delete file.content;
    omitted.push(stat.path);
    estimated -= stat.tokens;
  }
  return omitted;
}

export async function packDirectory(options: PackOptions): Promise<PackResult> {
  const format = options.format ?? "markdown";

  const scanResult = await scanProject({
    rootDir: options.rootDir,
    scanPaths: options.scanPaths,
    excludeGlobs: options.excludeGlobs,
    includeGlobs: options.includeGlobs,
    maxFileSizeBytes: (options.maxFileSizeKB ?? 100) * 1024,
  });
  let files = scanResult.files;

  const needsGit =
    options.diffRef !== undefined ||
    options.includeDiffs ||
    options.includeLogs !== undefined ||
    options.sort === "churn";
  const gitAvailable = needsGit ? await isGitRepo(options.rootDir) : false;

  if (options.diffRef !== undefined) {
    if (!gitAvailable) {
      throw new Error(
        `diff mode requires a git repository, but none was found at ${options.rootDir}`,
      );
    }
    const changed = await getChangedFiles(options.rootDir, options.diffRef);
    if (changed === undefined) {
      throw new Error(
        `Could not compute changed files vs "${options.diffRef}". Is the ref valid?`,
      );
    }
    const changedSet = new Set(changed);
    files = files.filter((f) => changedSet.has(f.path));
  }

  if (options.sort === "churn" && gitAvailable) {
    const churn =
      (await getChurnCounts(options.rootDir)) ?? new Map<string, number>();
    files = [...files].sort(
      (a, b) =>
        (churn.get(a.path) ?? 0) - (churn.get(b.path) ?? 0) ||
        a.path.localeCompare(b.path),
    );
  } else if (options.sort === "size") {
    files = [...files].sort(
      (a, b) => a.sizeBytes - b.sizeBytes || a.path.localeCompare(b.path),
    );
  }

  const gitDiffText =
    options.includeDiffs && gitAvailable
      ? (await getDiffText(options.rootDir)) || undefined
      : undefined;
  const gitLogText =
    options.includeLogs !== undefined && gitAvailable
      ? (await getLogText(options.rootDir, options.includeLogs)) || undefined
      : undefined;

  const shaping =
    options.compress || options.removeComments || options.removeEmptyLines;
  if (shaping) {
    for (const file of files) {
      if (!file.content || file.isBinary || file.isOversized) continue;
      const { content } = transformContent(file.path, file.content, {
        removeComments: options.removeComments ?? false,
        removeEmptyLines: options.removeEmptyLines ?? false,
        compress: options.compress ?? false,
      });
      file.content = content;
    }
  }

  const formatOpts = {
    format,
    rootDir: options.rootDir,
    task: options.task,
    maxFileSizeKB: options.maxFileSizeKB ?? 100,
    sortMode: (options.sort && options.sort !== "path" ? "given" : "path") as
      | "path"
      | "given",
    gitDiff: gitDiffText,
    gitLog: gitLogText,
    encoding: options.encoding,
  };

  let result = await formatOutput(files, formatOpts);

  let omittedForBudget: string[] = [];
  if (options.maxTokens !== undefined && result.totalTokens > options.maxTokens) {
    omittedForBudget = applyTokenBudget(
      files,
      result.fileTokenStats,
      result.totalTokens,
      options.maxTokens,
    );
    result = await formatOutput(files, formatOpts);
  }

  return {
    output: result.output,
    totalTokens: result.totalTokens,
    totalFiles: files.length,
    fileTokenStats: result.fileTokenStats,
    treeText: result.treeText,
    suspiciousSkipped: scanResult.suspiciousSkipped,
    omittedForBudget,
  };
}
