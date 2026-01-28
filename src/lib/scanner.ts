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
  /** File contents, only present for non-binary files within size limit */
  content?: string;
}

export interface ScannerOptions {
  /** Directory to scan; usually the current working directory */
  rootDir: string;
  /** Extra glob patterns to exclude (from --exclude) */
  excludeGlobs?: string[];
  /** Maximum file size in bytes for inlining contents (default 100KB) */
  maxFileSizeBytes?: number;
}

const DEFAULT_MAX_FILE_SIZE_BYTES = 100 * 1024;

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

async function buildIgnore(
  rootDir: string,
  extraExcludeGlobs: string[] | undefined,
): Promise<Ignore> {
  // The ignore package exports a factory function as the default export (CJS),
  // which is exposed as `.default` when imported from ESM.
  const factory = ignoreLib as unknown as { default: () => Ignore };
  const ig = factory.default();

  const gitignorePath = path.join(rootDir, ".gitignore");
  const llmignorePath = path.join(rootDir, ".llmignore");

  const [gitPatterns, llmPatterns] = await Promise.all([
    readIgnoreFile(gitignorePath),
    readIgnoreFile(llmignorePath),
  ]);

  if (gitPatterns.length > 0) {
    ig.add(gitPatterns);
  }
  if (llmPatterns.length > 0) {
    ig.add(llmPatterns);
  }
  if (extraExcludeGlobs && extraExcludeGlobs.length > 0) {
    ig.add(extraExcludeGlobs);
  }

  return ig;
}

export async function scanProject(options: ScannerOptions): Promise<ScannedFile[]> {
  const rootDir = path.resolve(options.rootDir);
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const excludeGlobs = options.excludeGlobs ?? [];

  const ig = await buildIgnore(rootDir, excludeGlobs);

  const entries = await fg("**/*", {
    cwd: rootDir,
    dot: true,
    onlyFiles: true,
    unique: true,
    followSymbolicLinks: false,
    ignore: ["node_modules/**", ".git/**", "dist/**"],
  });

  const files: ScannedFile[] = [];

  for (const relative of entries) {
    // fast-glob returns paths relative to cwd
    if (ig.ignores(relative)) {
      continue;
    }

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

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

