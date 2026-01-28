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

