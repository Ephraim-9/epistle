import path from "node:path";

/**
 * Content-shaping transforms: comment stripping, blank-line removal, and
 * signature-only compression. All transforms are conservative — when a file
 * type is not understood, content is returned unchanged.
 */

type CommentStyle = "c-like" | "hash" | "html" | "css" | "lua-dash";

const C_LIKE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".java", ".go", ".rs",
  ".c", ".h", ".cpp", ".cc", ".hpp", ".cs", ".swift", ".kt", ".scala",
  ".php", ".dart",
]);
const HASH_EXTS = new Set([
  ".py", ".rb", ".sh", ".bash", ".zsh", ".yml", ".yaml", ".toml", ".pl",
  ".r", ".jl", ".nim", ".ex", ".exs",
]);
const HTML_EXTS = new Set([".html", ".htm", ".xml", ".vue", ".svelte", ".md"]);
const CSS_EXTS = new Set([".css", ".scss", ".less", ".sass"]);

function commentStyleFor(filePath: string): CommentStyle | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (C_LIKE_EXTS.has(ext)) return "c-like";
  if (HASH_EXTS.has(ext)) return "hash";
  if (HTML_EXTS.has(ext)) return "html";
  if (CSS_EXTS.has(ext)) return "css";
  if (ext === ".sql" || ext === ".lua") return "lua-dash";
  return undefined;
}

/**
 * Strip comments from C-like source using a small state machine that
 * respects string literals ("", '', ``) and regex-free heuristics.
 */
function stripCLikeComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  type State =
    | "code"
    | "line-comment"
    | "block-comment"
    | "double"
    | "single"
    | "template";
  let state: State = "code";

  while (i < n) {
    const ch = source[i];
    const next = i + 1 < n ? source[i + 1] : "";

    switch (state) {
      case "code":
        if (ch === "/" && next === "/") {
          state = "line-comment";
          i += 2;
        } else if (ch === "/" && next === "*") {
          state = "block-comment";
          i += 2;
        } else if (ch === '"') {
          state = "double";
          out += ch;
          i++;
        } else if (ch === "'") {
          state = "single";
          out += ch;
          i++;
        } else if (ch === "`") {
          state = "template";
          out += ch;
          i++;
        } else {
          out += ch;
          i++;
        }
        break;
      case "line-comment":
        if (ch === "\n") {
          state = "code";
          out += ch;
        }
        i++;
        break;
      case "block-comment":
        if (ch === "*" && next === "/") {
          state = "code";
          i += 2;
        } else {
          // Preserve newlines so line numbers stay meaningful
          if (ch === "\n") out += ch;
          i++;
        }
        break;
      case "double":
        if (ch === "\\") {
          out += ch + next;
          i += 2;
        } else {
          if (ch === '"' || ch === "\n") state = "code";
          out += ch;
          i++;
        }
        break;
      case "single":
        if (ch === "\\") {
          out += ch + next;
          i += 2;
        } else {
          if (ch === "'" || ch === "\n") state = "code";
          out += ch;
          i++;
        }
        break;
      case "template":
        if (ch === "\\") {
          out += ch + next;
          i += 2;
        } else {
          if (ch === "`") state = "code";
          out += ch;
          i++;
        }
        break;
    }
  }

  // Drop lines that became empty after comment removal
  return out
    .split("\n")
    .filter((line, idx) => {
      if (line.trim().length > 0) return true;
      // keep blank lines that were blank in the original at same index
      const original = source.split("\n")[idx];
      return original !== undefined && original.trim().length === 0;
    })
    .join("\n");
}

/** Strip full-line # comments (keeps shebangs and inline # to avoid string damage). */
function stripHashComments(source: string): string {
  return source
    .split("\n")
    .filter((line, idx) => {
      const trimmed = line.trimStart();
      if (idx === 0 && trimmed.startsWith("#!")) return true;
      return !trimmed.startsWith("#");
    })
    .join("\n");
}

function stripBlockComments(
  source: string,
  open: string,
  close: string,
): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const start = source.indexOf(open, i);
    if (start === -1) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, start);
    const end = source.indexOf(close, start + open.length);
    if (end === -1) break; // unterminated comment: drop the rest
    // preserve newlines inside the removed block
    const removed = source.slice(start, end + close.length);
    out += removed.replace(/[^\n]/g, "");
    i = end + close.length;
  }
  return out;
}

/** Strip full-line -- comments (SQL, Lua). */
function stripDashComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

export function stripComments(filePath: string, content: string): string {
  const style = commentStyleFor(filePath);
  switch (style) {
    case "c-like":
      return stripCLikeComments(content);
    case "hash":
      return stripHashComments(content);
    case "html":
      return stripBlockComments(content, "<!--", "-->");
    case "css":
      return stripBlockComments(content, "/*", "*/");
    case "lua-dash":
      return stripDashComments(content);
    default:
      return content;
  }
}

export function removeEmptyLines(content: string): string {
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

const SIGNATURE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".py", ".go", ".rs",
  ".java", ".cs", ".kt", ".swift",
]);

/**
 * Signature-only compression: keep the structural skeleton of a source file
 * (imports/exports, class/function/type declarations) and elide bodies.
 * Line-based heuristic — intentionally dependency-free (no tree-sitter),
 * trading some precision for zero install weight. Returns undefined when the
 * file type is unsupported so callers can fall back to full content.
 */
export function compressToSignatures(
  filePath: string,
  content: string,
): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (!SIGNATURE_EXTS.has(ext)) return undefined;

  const isPython = ext === ".py";
  const lines = content.split("\n");
  const kept: string[] = [];
  let elided = 0;

  const flushElision = () => {
    if (elided > 0) {
      kept.push(isPython ? "    ..." : "  // …");
      elided = 0;
    }
  };

  const structural = isPython
    ? /^\s*(import\s|from\s.+\simport\s|def\s|class\s|@|if\s+__name__)/
    : /^\s*(import\s|export\s|from\s|package\s|use\s|mod\s|pub\s|module\.exports|const\s+\w+\s*=\s*(async\s*)?\(|function\s|async\s+function\s|class\s|interface\s|type\s+\w+\s*=|enum\s|abstract\s|public\s|private\s|protected\s|static\s|func\s|fn\s|impl\s|trait\s|struct\s|@\w+)/;

  // Method-looking lines inside classes (indented, name(args) { or similar)
  const methodLike = isPython
    ? null
    : /^\s+(?:(?:public|private|protected|static|async|override|readonly)\s+)*\w+\s*(?:<[^>]*>)?\([^;]*\)\s*(?::\s*[\w<>[\],\s.|&]+)?\s*\{?\s*$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (structural.test(line) || (methodLike && methodLike.test(line))) {
      flushElision();
      // Normalize trailing "{" so skeletons read cleanly
      kept.push(line.replace(/\{\s*$/, "{ /* … */ }"));
    } else {
      elided++;
    }
  }
  flushElision();

  if (kept.length === 0) return undefined;
  return kept.join("\n");
}

export interface TransformOptions {
  removeComments?: boolean;
  removeEmptyLines?: boolean;
  compress?: boolean;
}

export interface TransformResult {
  content: string;
  compressed: boolean;
  /** Which compression engine produced the result (when compressed) */
  engine?: "ast" | "heuristic";
}

export function transformContent(
  filePath: string,
  content: string,
  options: TransformOptions,
): TransformResult {
  if (options.compress) {
    const skeleton = compressToSignatures(filePath, content);
    if (skeleton !== undefined) {
      return { content: skeleton, compressed: true, engine: "heuristic" };
    }
  }

  let result = content;
  if (options.removeComments) {
    result = stripComments(filePath, result);
  }
  if (options.removeEmptyLines) {
    result = removeEmptyLines(result);
  }
  return { content: result, compressed: false };
}

/**
 * Like transformContent, but tries tree-sitter AST compression first
 * (optional dependency; see ast-compress.ts). Falls back to the
 * line-based heuristic — and from there to full content — automatically.
 */
export async function transformContentAsync(
  filePath: string,
  content: string,
  options: TransformOptions,
): Promise<TransformResult> {
  if (options.compress) {
    try {
      const { astCompressToSignatures } = await import("./ast-compress.js");
      const skeleton = await astCompressToSignatures(filePath, content);
      if (skeleton !== undefined) {
        return { content: skeleton, compressed: true, engine: "ast" };
      }
    } catch {
      // Optional stack unavailable or parse failure: heuristic below
    }
  }
  return transformContent(filePath, content, options);
}
