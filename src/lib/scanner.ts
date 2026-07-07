import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { Ignore } from "ignore";
import * as ignoreLib from "ignore";
import { isBinaryFile } from "isbinaryfile";

export interface ScannedFile {
  /** Project-relative path using forward slashes */
  path: string;
  /** Absolute path on disk */
  absolutePath: string;
  /** File size in bytes */
  sizeBytes: number;
  /** True if detected as binary */
  isBinary: boolean;
  /** True if larger than the configured max file size */
  isOversized: boolean;
  /** True if dropped to fit a token budget (content omitted from output) */
  isOmitted?: boolean;
  /** File contents, only present for non-binary files within size limit */
  content?: string;
}

export interface ScannerOptions {
  /** Directory to scan; usually the current working directory */
  rootDir: string;
  /** Restrict scanning to these paths (files or directories) relative to rootDir */
  scanPaths?: string[];
  /** Extra glob patterns to exclude (from --exclude) */
  excludeGlobs?: string[];
  /** Glob patterns to force-include after ignore/exclude filtering */
  includeGlobs?: string[];
  /** Maximum file size in bytes for inlining contents (default 100KB) */
  maxFileSizeBytes?: number;
}

export interface ScanProjectResult {
  files: ScannedFile[];
  /** Total number of candidate file entries discovered before ignore/exclude */
  totalEntries: number;
  /** Number of entries pruned by ignore/exclude (including lite mode) */
  ignoredEntries: number;
}

export const DEFAULT_MAX_FILE_SIZE_BYTES = 100 * 1024;

/** Patterns always excluded regardless of ignore files. */
export const DEFAULT_IGNORE_PATTERNS = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  "coverage/**",
  ".next/**",
  ".nuxt/**",
  ".venv/**",
  "__pycache__/**",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "composer.lock",
  "Gemfile.lock",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.svg",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.ico",
  "**/*.woff",
  "**/*.woff2",
  "**/*.ttf",
  "**/*.otf",
  "**/*.eot",
  "**/*.pdf",
  "**/*.zip",
  "**/*.gz",
  "**/*.tar",
  "**/.DS_Store",
  "context.md",
  "codebase.md",
  "digest.txt",
  "epistle-*.md",
  "epistle-*.xml",
  "epistle-*.json",
  "epistle-*.txt",
  "context.xml",
  "codebase.xml",
];

/** Ignore files honored at the project root, in priority order. */
const ROOT_IGNORE_FILES = [".gitignore", ".llmignore", ".epistleignore"];

async function readIgnoreFile(filePath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function createIgnore(): Ignore {
  // The ignore package exports a factory function as the default export (CJS),
  // which is exposed as `.default` when imported from ESM.
  const factory = ignoreLib as unknown as { default: () => Ignore };
  return factory.default();
}

interface NestedIgnore {
  /** Directory (relative to root, forward slashes, no trailing slash) the ignore file lives in */
  base: string;
  ig: Ignore;
}

async function buildRootIgnore(
  rootDir: string,
  extraExcludeGlobs: string[] | undefined,
): Promise<Ignore> {
  const ig = createIgnore();

  for (const name of ROOT_IGNORE_FILES) {
    const patterns = await readIgnoreFile(path.join(rootDir, name));
    if (patterns.length > 0) {
      ig.add(patterns);
    }
  }

  if (extraExcludeGlobs && extraExcludeGlobs.length > 0) {
    ig.add(extraExcludeGlobs);
  }

  return ig;
}

/**
 * Build ignore matchers for .gitignore files in subdirectories, so monorepos
 * and nested packages are filtered correctly (like git itself does).
 */
async function buildNestedIgnores(
  rootDir: string,
  entries: string[],
): Promise<NestedIgnore[]> {
  const nested: NestedIgnore[] = [];

  const gitignoreEntries = entries.filter(
    (rel) => rel !== ".gitignore" && rel.endsWith("/.gitignore"),
  );

  for (const rel of gitignoreEntries) {
    const base = rel.slice(0, -"/.gitignore".length);
    const patterns = await readIgnoreFile(path.join(rootDir, rel));
    if (patterns.length === 0) continue;
    const ig = createIgnore();
    ig.add(patterns);
    nested.push({ base, ig });
  }

  return nested;
}

function isIgnoredByNested(
  relPath: string,
  nestedIgnores: NestedIgnore[],
): boolean {
  for (const { base, ig } of nestedIgnores) {
    const prefix = base + "/";
    if (relPath.startsWith(prefix)) {
      const sub = relPath.slice(prefix.length);
      if (sub && ig.ignores(sub)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Convert user-supplied scan paths (files or directories) into glob patterns
 * scoped to rootDir. Throws for paths that escape the root or do not exist.
 */
async function scanPathsToPatterns(
  rootDir: string,
  scanPaths: string[],
): Promise<string[]> {
  const patterns: string[] = [];

  for (const p of scanPaths) {
    const abs = path.resolve(rootDir, p);
    const rel = path.relative(rootDir, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `Path "${p}" is outside the project root. Run epistle from a common parent directory instead.`,
      );
    }

    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      throw new Error(`Path "${p}" does not exist.`);
    }

    const relPosix = rel.split(path.sep).join(path.posix.sep);
    if (stat.isDirectory()) {
      patterns.push(relPosix === "" ? "**/*" : `${relPosix}/**/*`);
    } else {
      patterns.push(relPosix);
    }
  }

  return patterns;
}

export async function scanProject(options: ScannerOptions): Promise<ScanProjectResult> {
  const rootDir = path.resolve(options.rootDir);
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const excludeGlobs = options.excludeGlobs ?? [];
  const includeGlobs = options.includeGlobs ?? [];

  const ig = await buildRootIgnore(rootDir, excludeGlobs);

  const scanPatterns =
    options.scanPaths && options.scanPaths.length > 0
      ? await scanPathsToPatterns(rootDir, options.scanPaths)
      : ["**/*"];

  const allEntries = await fg(scanPatterns, {
    cwd: rootDir,
    dot: true,
    onlyFiles: true,
    unique: true,
    followSymbolicLinks: false,
    ignore: DEFAULT_IGNORE_PATTERNS,
  });

  const nestedIgnores = await buildNestedIgnores(rootDir, allEntries);

  let filteredEntries = allEntries.filter(
    (relative) =>
      !ig.ignores(relative) && !isIgnoredByNested(relative, nestedIgnores),
  );

  if (includeGlobs.length > 0) {
    const includeEntries = await fg(includeGlobs, {
      cwd: rootDir,
      dot: true,
      onlyFiles: true,
      unique: true,
      followSymbolicLinks: false,
    });

    const merged = new Set<string>(filteredEntries);
    for (const rel of includeEntries) {
      merged.add(rel);
    }
    filteredEntries = Array.from(merged);
  }

  const files: ScannedFile[] = [];

  for (const relative of filteredEntries) {
    // fast-glob returns paths relative to cwd
    const absolutePath = path.join(rootDir, relative);

    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      continue;
    }

    // For symlinks, avoid following them deeply; just resolve once and treat as a single file
    let targetStat = stat;
    let effectivePath = absolutePath;

    if (stat.isSymbolicLink()) {
      try {
        const real = await fs.realpath(absolutePath);
        effectivePath = real;
        targetStat = await fs.stat(real);
        if (!targetStat.isFile()) {
          // We only care about files; skip symlinks to directories or others
          continue;
        }
      } catch {
        // Broken symlink; skip
        continue;
      }
    }

    const sizeBytes = targetStat.size;
    const relativeNormalized = relative.split(path.sep).join(path.posix.sep);

    const scanned: ScannedFile = {
      path: relativeNormalized,
      absolutePath: effectivePath,
      sizeBytes,
      isBinary: false,
      isOversized: false,
    };

    // Binary detection
    const binary = await isBinaryFile(effectivePath);
    scanned.isBinary = binary;

    if (binary) {
      files.push(scanned);
      continue;
    }

    if (sizeBytes > maxFileSizeBytes) {
      scanned.isOversized = true;
      files.push(scanned);
      continue;
    }

    const content = await fs.readFile(effectivePath, "utf8");
    scanned.content = content;
    files.push(scanned);
  }

  files.sort((a, b) => {
    const aIsPkg = a.path === "package.json";
    const bIsPkg = b.path === "package.json";
    if (aIsPkg && !bIsPkg) return -1;
    if (!aIsPkg && bIsPkg) return 1;
    return a.path.localeCompare(b.path);
  });

  const totalEntries = allEntries.length;
  const ignoredEntries = totalEntries - filteredEntries.length;

  return {
    files,
    totalEntries,
    ignoredEntries,
  };
}
