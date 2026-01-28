```
├── .gitignore
├── package.json
├── src
│   ├── bin.ts
│   └── lib
│       ├── formatter.ts
│       └── scanner.ts
└── tsconfig.json
```

```
Root: /home/helliot/repos/epistle
Total Files: 6
Total Tokens: 3935
Safety Warning: Potential secrets detected in the packed context. Review before sharing.
```

## .gitignore

```
node_modules/
dist/
.DS_Store
.env

```

## package.json

```json
{
  "name": "epistle",
  "version": "0.1.2",
  "description": "Epistle – a production-grade Node.js CLI that packs a local codebase into a single, LLM-friendly context file.",
  "private": false,
  "bin": {
    "epistle": "dist/bin.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/bin.ts",
    "start": "node dist/bin.js",
    "lint": "eslint \"src/**/*.{ts,tsx}\" || echo \"No ESLint configured\""
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "type": "module",
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "dependencies": {
    "chalk": "^5.3.0",
    "clipboardy": "^4.0.0",
    "commander": "^12.0.0",
    "fast-glob": "^3.3.2",
    "gradient-string": "^2.0.2",
    "ignore": "^5.3.0",
    "isbinaryfile": "^5.0.0",
    "js-tiktoken": "^1.0.11",
    "ora": "^8.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/gradient-string": "^1.1.6",
    "eslint": "^9.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0"
  }
}

```

## src/bin.ts

```ts
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
    .version("0.1.2");

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
    const excludeGlobs: string[] = [...(opts.exclude ?? [])];

    const outputPath = opts.output
      ? path.resolve(rootDir, opts.output)
      : undefined;

    if (outputPath) {
      const outputRel = path.relative(rootDir, outputPath) || outputPath;
      excludeGlobs.push(outputRel);
    }

    const files = await scanProject({
      rootDir,
      excludeGlobs,
    });

    spinner.text = chalk.cyan("Formatting output...");

    const output = formatOutput(files, {
      format,
      rootDir,
    });

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


```

## src/lib/formatter.ts

```ts
import path from "node:path";
import { encodingForModel } from "js-tiktoken";
import type { ScannedFile } from "./scanner.js";

export type OutputFormat = "markdown" | "xml";

export interface FormatOptions {
  format: OutputFormat;
  rootDir: string;
}

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  file?: ScannedFile;
}

function buildTree(files: ScannedFile[]): TreeNode {
  const root: TreeNode = { name: "", children: new Map() };

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let current = root;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!current.children.has(segment)) {
        current.children.set(segment, {
          name: segment,
          children: new Map(),
        });
      }
      const next = current.children.get(segment)!;
      if (i === segments.length - 1) {
        next.file = file;
      }
      current = next;
    }
  }

  return root;
}

function renderTree(node: TreeNode, prefix = ""): string {
  const lines: string[] = [];
  const entries = Array.from(node.children.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  entries.forEach((child, index) => {
    const last = index === entries.length - 1;
    const branch = last ? "└── " : "├── ";
    const nextPrefix = prefix + (last ? "    " : "│   ");

    let label = child.name;
    if (child.file) {
      if (child.file.isBinary) {
        label += " [binary]";
      } else if (child.file.isOversized) {
        label += " [skipped >100KB]";
      }
    }

    lines.push(prefix + branch + label);
    if (child.children.size > 0) {
      lines.push(renderTree(child, nextPrefix));
    }
  });

  return lines.join("\n");
}

function detectPotentialSecrets(text: string): boolean {
  const patterns: RegExp[] = [
    /sk-[A-Za-z0-9]{16,}/g, // OpenAI-style keys
    /AKIA[0-9A-Z]{16}/g, // AWS access keys
    /AIza[0-9A-Za-z\-_]{20,}/g, // Google API keys
    /[\w\-]{32,}/g, // generic long tokens
  ];

  return patterns.some((re) => re.test(text));
}

function inferLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "ts";
    case ".js":
    case ".cjs":
    case ".mjs":
      return "js";
    case ".json":
      return "json";
    case ".md":
      return "md";
    case ".py":
      return "py";
    case ".java":
      return "java";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".yml":
    case ".yaml":
      return "yaml";
    default:
      return undefined;
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatOutput(
  files: ScannedFile[],
  options: FormatOptions,
): string {
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  const tree = buildTree(sortedFiles);
  const treeText = renderTree(tree);

  const encoding = encodingForModel("gpt-4o-mini");
  const joinedContent = sortedFiles
    .map((f) => f.content ?? "")
    .filter((s) => s.length > 0)
    .join("\n");
  const totalTokens = encoding.encode(joinedContent).length;

  const totalFiles = sortedFiles.length;
  const hasSecrets = detectPotentialSecrets(joinedContent);

  const headerLines: string[] = [];
  headerLines.push(`Root: ${options.rootDir}`);
  headerLines.push(`Total Files: ${totalFiles}`);
  headerLines.push(`Total Tokens: ${totalTokens}`);
  if (hasSecrets) {
    headerLines.push(
      "Safety Warning: Potential secrets detected in the packed context. Review before sharing.",
    );
  } else {
    headerLines.push(
      "Safety: No obvious secrets detected, but manual review is still recommended.",
    );
  }

  const headerText = headerLines.join("\n");

  if (options.format === "xml") {
    const parts: string[] = [];
    parts.push("<epistle>");
    parts.push("<tree><![CDATA[");
    parts.push(treeText);
    parts.push("]]></tree>");
    parts.push("<metadata><![CDATA[");
    parts.push(headerText);
    parts.push("]]></metadata>");

    for (const file of sortedFiles) {
      const attrs = `path="${xmlEscape(file.path)}"`;
      if (!file.content || file.isBinary || file.isOversized) {
        const note = file.isBinary
          ? "(binary file, contents not included)"
          : file.isOversized
            ? "(file >100KB, contents skipped)"
            : "(no content)";
        parts.push(`<file ${attrs}>${xmlEscape(note)}</file>`);
      } else {
        parts.push(
          `<file ${attrs}>${xmlEscape(file.content)}</file>`,
        );
      }
    }

    parts.push("</epistle>");
    return parts.join("\n");
  }

  // Markdown format (default)
  const mdParts: string[] = [];
  mdParts.push("```");
  if (treeText) {
    mdParts.push(treeText);
  }
  mdParts.push("```");
  mdParts.push("");
  mdParts.push("```");
  mdParts.push(headerText);
  mdParts.push("```");
  mdParts.push("");

  for (const file of sortedFiles) {
    mdParts.push(`## ${file.path}`);
    if (!file.content || file.isBinary || file.isOversized) {
      if (file.isBinary) {
        mdParts.push("");
        mdParts.push("(binary file, contents not included)");
      } else if (file.isOversized) {
        mdParts.push("");
        mdParts.push("(file >100KB, contents skipped)");
      } else {
        mdParts.push("");
        mdParts.push("(no content)");
      }
      mdParts.push("");
      continue;
    }

    const lang = inferLanguage(file.path);
    mdParts.push("");
    mdParts.push(lang ? "```" + lang : "```");
    mdParts.push(file.content);
    mdParts.push("```");
    mdParts.push("");
  }

  return mdParts.join("\n");
}


```

## src/lib/scanner.ts

```ts
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
    ignore: [
      "node_modules/**",
      ".git/**",
      "dist/**",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "bun.lockb",
      "**/*.svg",
      "**/*.png",
      "**/*.jpg",
    ],
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


```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}

```
