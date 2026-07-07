import path from "node:path";
import { encodingForModel } from "js-tiktoken";
import type { ScannedFile } from "./scanner.js";

export type OutputFormat = "markdown" | "xml" | "plain" | "json";

export const OUTPUT_FORMATS: OutputFormat[] = [
  "markdown",
  "xml",
  "plain",
  "json",
];

export type PersonaType = "architect" | "security" | "refactor";

export interface FormatOptions {
  format: OutputFormat;
  rootDir: string;
  persona?: PersonaType;
  task?: string;
  /** Prefix each content line with its line number */
  lineNumbers?: boolean;
  /** Used for the "skipped" message on oversized files */
  maxFileSizeKB?: number;
}

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  file?: ScannedFile;
}

export interface FileTokenStat {
  path: string;
  tokens: number;
}

export type DirectoryTokenMap = Map<string, number>;

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

function renderTree(node: TreeNode, maxFileSizeKB: number, prefix = ""): string {
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
        label += ` [skipped >${maxFileSizeKB}KB]`;
      }
    }

    lines.push(prefix + branch + label);
    if (child.children.size > 0) {
      lines.push(renderTree(child, maxFileSizeKB, nextPrefix));
    }
  });

  return lines.join("\n");
}

function getSecretPatterns(): RegExp[] {
  // Intentionally focused on common API key / token shapes.
  // We avoid generic long-token patterns to reduce false positives and
  // deliberately do NOT match SHA/SRI-style tokens (sha256-/sha512-) or
  // plain hex hashes.
  return [
    /sk-[A-Za-z0-9]{16,}/g, // OpenAI-style keys
    /AKIA[0-9A-Z]{16}/g, // AWS access keys
    /AIza[0-9A-Za-z\-_]{20,}/g, // Google API keys
    /\b[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}\b/g, // JWT-like tokens
  ];
}

export function redactSecrets(text: string): { redacted: string; count: number } {
  let result = text;
  let count = 0;
  for (const re of getSecretPatterns()) {
    const reCopy = new RegExp(re.source, re.flags);
    result = result.replace(reCopy, () => {
      count++;
      return "[REDACTED_SECRET]";
    });
  }
  return { redacted: result, count };
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
    case ".jsx":
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
    case ".rb":
      return "ruby";
    case ".php":
      return "php";
    case ".sh":
    case ".bash":
      return "bash";
    case ".c":
      return "c";
    case ".h":
    case ".cpp":
    case ".cc":
    case ".hpp":
      return "cpp";
    case ".cs":
      return "csharp";
    case ".swift":
      return "swift";
    case ".kt":
      return "kotlin";
    case ".sql":
      return "sql";
    case ".html":
      return "html";
    case ".css":
      return "css";
    case ".scss":
      return "scss";
    case ".xml":
      return "xml";
    case ".toml":
      return "toml";
    case ".yml":
    case ".yaml":
      return "yaml";
    default:
      return undefined;
  }
}

/**
 * Choose a code fence long enough to safely wrap content that itself
 * contains backtick fences (files-to-prompt gets this right; most tools
 * corrupt their own markdown output here).
 */
export function fenceFor(content: string): string {
  let maxRun = 0;
  const matches = content.match(/`{3,}/g);
  if (matches) {
    for (const m of matches) {
      if (m.length > maxRun) maxRun = m.length;
    }
  }
  return "`".repeat(Math.max(3, maxRun + 1));
}

export function addLineNumbers(content: string): string {
  const lines = content.split("\n");
  const width = String(lines.length).length;
  return lines
    .map((line, i) => `${String(i + 1).padStart(width)}: ${line}`)
    .join("\n");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getPersonaHeader(type: PersonaType): string {
  switch (type) {
    case "architect":
      return "You are a Senior Software Architect. Review this codebase for modularity, scalability, and adherence to SOLID principles.";
    case "security":
      return "You are a Cyber Security Auditor. Scan this code for XSS, SQL injection, and insecure dependency patterns.";
    case "refactor":
      return "You are a Clean Code Expert. Suggest ways to reduce complexity and improve readability.";
  }
}

function computeFileTokenStats(
  files: ScannedFile[],
  redactedByPath: Map<string, string>,
): { fileTokenStats: FileTokenStat[]; totalTokens: number } {
  const encoding = encodingForModel("gpt-4o-mini");
  const stats: FileTokenStat[] = [];
  let totalTokens = 0;

  for (const file of files) {
    if (!file.content || file.isBinary || file.isOversized) {
      stats.push({ path: file.path, tokens: 0 });
      continue;
    }

    const contentForTokens = redactedByPath.get(file.path) ?? file.content;
    const tokens = encoding.encode(contentForTokens).length;
    stats.push({ path: file.path, tokens });
    totalTokens += tokens;
  }

  return { fileTokenStats: stats, totalTokens };
}

export function aggregateDirectoryTokens(
  fileTokenStats: FileTokenStat[],
): DirectoryTokenMap {
  const dirMap: DirectoryTokenMap = new Map();

  for (const stat of fileTokenStats) {
    if (stat.tokens <= 0) continue;

    const segments = stat.path.split("/").filter(Boolean);
    // Aggregate into all ancestor directories (root is implicitly total)
    for (let i = 0; i < segments.length - 1; i++) {
      const dirPath = segments.slice(0, i + 1).join("/");
      dirMap.set(dirPath, (dirMap.get(dirPath) ?? 0) + stat.tokens);
    }
  }

  // Optionally keep a synthetic root entry with the total of all tokens.
  const rootTotal = Array.from(fileTokenStats).reduce(
    (sum, stat) => sum + stat.tokens,
    0,
  );
  dirMap.set("", rootTotal);

  return dirMap;
}

function detectTechStack(files: ScannedFile[]): string[] {
  const techStack = new Set<string>();
  const pkgFile = files.find(
    (f) => f.path === "package.json" && typeof f.content === "string",
  );
  if (pkgFile?.content) {
    try {
      const pkg = JSON.parse(pkgFile.content) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };

      const hasDep = (name: string) =>
        Object.prototype.hasOwnProperty.call(deps, name);

      // Frontend frameworks
      if (hasDep("react")) techStack.add("React");
      if (hasDep("next")) techStack.add("Next.js");
      if (hasDep("vue")) techStack.add("Vue");
      if (hasDep("@angular/core")) techStack.add("Angular");
      if (hasDep("svelte")) techStack.add("Svelte");
      if (hasDep("remix")) techStack.add("Remix");

      // Backend frameworks
      if (hasDep("express")) techStack.add("Express");
      if (hasDep("koa")) techStack.add("Koa");
      if (hasDep("fastify")) techStack.add("Fastify");
      if (hasDep("@nestjs/core")) techStack.add("NestJS");
      if (hasDep("hapi")) techStack.add("hapi");
      if (hasDep("apollo-server")) techStack.add("Apollo Server");
      if (hasDep("graphql-yoga")) techStack.add("GraphQL Yoga");

      // Data / ORM
      if (hasDep("mongoose")) techStack.add("Mongoose");
      if (hasDep("prisma")) techStack.add("Prisma");
      if (hasDep("typeorm")) techStack.add("TypeORM");
      if (hasDep("sequelize")) techStack.add("Sequelize");
    } catch {
      // Ignore invalid package.json content for metadata purposes
    }
  }

  // Non-JS ecosystems, detected by manifest presence
  const paths = new Set(files.map((f) => f.path));
  if (paths.has("Cargo.toml")) techStack.add("Rust");
  if (paths.has("go.mod")) techStack.add("Go");
  if (paths.has("pyproject.toml") || paths.has("requirements.txt")) {
    techStack.add("Python");
  }
  if (paths.has("Gemfile")) techStack.add("Ruby");
  if (paths.has("pom.xml") || paths.has("build.gradle")) techStack.add("Java");

  return Array.from(techStack).sort();
}

function slugifyHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function unavailableNote(file: ScannedFile, maxFileSizeKB: number): string {
  if (file.isBinary) return "(binary file, contents not included)";
  if (file.isOversized) return `(file >${maxFileSizeKB}KB, contents skipped)`;
  return "(no content)";
}

export function formatOutput(
  files: ScannedFile[],
  options: FormatOptions,
): {
  output: string;
  totalTokens: number;
  fileTokenStats: FileTokenStat[];
  dirTokenMap: DirectoryTokenMap;
} {
  const maxFileSizeKB = options.maxFileSizeKB ?? 100;
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  const tree = buildTree(sortedFiles);
  const treeText = renderTree(tree, maxFileSizeKB);

  const totalFiles = sortedFiles.length;

  const redactedByPath = new Map<string, string>();
  let totalRedactions = 0;
  for (const file of sortedFiles) {
    if (file.content && !file.isBinary && !file.isOversized) {
      const { redacted, count } = redactSecrets(file.content);
      redactedByPath.set(file.path, redacted);
      totalRedactions += count;
    }
  }

  const contentFor = (file: ScannedFile): string => {
    const base = redactedByPath.get(file.path) ?? file.content ?? "";
    return options.lineNumbers ? addLineNumbers(base) : base;
  };

  const techStack = detectTechStack(sortedFiles);

  const { fileTokenStats, totalTokens } = computeFileTokenStats(
    sortedFiles,
    redactedByPath,
  );
  const dirTokenMap = aggregateDirectoryTokens(fileTokenStats);

  const headerLines: string[] = [];
  if (options.persona) {
    headerLines.push(getPersonaHeader(options.persona));
  }
  headerLines.push(`Root: ${options.rootDir}`);
  headerLines.push(`Total Files: ${totalFiles}`);
  headerLines.push(`Total Tokens: ${totalTokens}`);
  if (techStack.length > 0) {
    headerLines.push("Tech Stack: " + techStack.join(", "));
  }
  if (options.task && options.task.trim().length > 0) {
    headerLines.push("Task Status: Pending (See end of file)");
  }
  if (totalRedactions > 0) {
    headerLines.push(
      `Safety: ${totalRedactions} secrets were detected and automatically redacted.`,
    );
  } else {
    headerLines.push(
      "Safety: No secrets were detected. Manual review is still recommended.",
    );
  }

  const headerText = headerLines.join("\n");

  if (options.format === "json") {
    const payload = {
      metadata: {
        root: options.rootDir,
        totalFiles,
        totalTokens,
        techStack,
        persona: options.persona ?? null,
        redactedSecrets: totalRedactions,
        generator: "epistle",
      },
      tree: treeText,
      files: sortedFiles.map((file) => ({
        path: file.path,
        tokens:
          fileTokenStats.find((s) => s.path === file.path)?.tokens ?? 0,
        binary: file.isBinary,
        oversized: file.isOversized,
        content:
          !file.content || file.isBinary || file.isOversized
            ? null
            : contentFor(file),
      })),
      task: options.task && options.task.trim().length > 0 ? options.task : null,
    };
    return {
      output: JSON.stringify(payload, null, 2),
      totalTokens,
      fileTokenStats,
      dirTokenMap,
    };
  }

  if (options.format === "plain") {
    const sep = "=".repeat(48);
    const parts: string[] = [];
    parts.push(sep);
    parts.push("EPISTLE CONTEXT");
    parts.push(sep);
    parts.push(headerText);
    parts.push("");
    parts.push(sep);
    parts.push("DIRECTORY STRUCTURE");
    parts.push(sep);
    parts.push(treeText);
    parts.push("");

    for (const file of sortedFiles) {
      parts.push(sep);
      parts.push(`File: ${file.path}`);
      parts.push(sep);
      if (!file.content || file.isBinary || file.isOversized) {
        parts.push(unavailableNote(file, maxFileSizeKB));
      } else {
        parts.push(contentFor(file));
      }
      parts.push("");
    }

    if (options.task && options.task.trim().length > 0) {
      parts.push(sep);
      parts.push("USER TASK / INSTRUCTIONS");
      parts.push(sep);
      parts.push(options.task);
      parts.push("");
    }

    return { output: parts.join("\n"), totalTokens, fileTokenStats, dirTokenMap };
  }

  if (options.format === "xml") {
    const parts: string[] = [];
    parts.push("<epistle>");
    parts.push("<tree><![CDATA[");
    parts.push(treeText);
    parts.push("]]></tree>");
    parts.push("<metadata><![CDATA[");
    parts.push(headerText);
    parts.push("]]></metadata>");

    if (options.task && options.task.trim().length > 0) {
      parts.push("<task><![CDATA[");
      parts.push(options.task);
      parts.push("]]></task>");
    }

    for (const file of sortedFiles) {
      const attrs = `path="${xmlEscape(file.path)}"`;
      if (!file.content || file.isBinary || file.isOversized) {
        parts.push(
          `<file ${attrs}>${xmlEscape(unavailableNote(file, maxFileSizeKB))}</file>`,
        );
      } else {
        parts.push(`<file ${attrs}>${xmlEscape(contentFor(file))}</file>`);
      }
    }

    parts.push("</epistle>");
    return { output: parts.join("\n"), totalTokens, fileTokenStats, dirTokenMap };
  }

  // Markdown format (default)
  const mdParts: string[] = [];
  mdParts.push("```");
  if (treeText) {
    mdParts.push(treeText);
  }
  mdParts.push("```");
  mdParts.push("");

  // Table of Contents
  mdParts.push("## Table of Contents");
  mdParts.push("");
  for (const file of sortedFiles) {
    if (!file.content || file.isBinary || file.isOversized) {
      continue;
    }
    const slug = slugifyHeading(file.path);
    mdParts.push(`- [${file.path}](#${slug})`);
  }
  mdParts.push("");

  mdParts.push("```");
  mdParts.push(headerText);
  mdParts.push("```");
  mdParts.push("");

  for (const file of sortedFiles) {
    const slug = slugifyHeading(file.path);
    mdParts.push(`## ${file.path} {#${slug}}`);
    if (!file.content || file.isBinary || file.isOversized) {
      mdParts.push("");
      mdParts.push(unavailableNote(file, maxFileSizeKB));
      mdParts.push("");
      continue;
    }

    const body = contentFor(file);
    const lang = inferLanguage(file.path);
    const fence = fenceFor(body);
    mdParts.push("");
    mdParts.push(lang ? fence + lang : fence);
    mdParts.push(body);
    mdParts.push(fence);
    mdParts.push("");
  }

  if (options.task && options.task.trim().length > 0) {
    const fence = fenceFor(options.task);
    mdParts.push("## User Task / Instructions");
    mdParts.push("");
    mdParts.push(fence);
    mdParts.push(options.task);
    mdParts.push(fence);
    mdParts.push("");
  }

  return { output: mdParts.join("\n"), totalTokens, fileTokenStats, dirTokenMap };
}
