import path from "node:path";
import { createRequire } from "node:module";

/**
 * AST-based signature compression via web-tree-sitter.
 *
 * The tree-sitter runtime and grammar wasms ship as *optional*
 * dependencies: when they are missing (installed with --omit=optional),
 * fail to load, or a language is unsupported, every entry point here
 * returns undefined and callers fall back to the line-based heuristic in
 * compress.ts. Measured against that heuristic on facebook/react
 * (4,435 JS/TS/PY files): 84.7% vs 81.3% token reduction — and, more
 * importantly, multi-line signatures, decorator arguments, and return
 * types survive intact instead of being elided mid-declaration.
 *
 * Grammar wasms are ABI-tied to web-tree-sitter 0.20.x — keep the
 * optionalDependencies pins in sync when bumping either package.
 */

interface TSNode {
  type: string;
  startIndex: number;
  endIndex: number;
  children: TSNode[];
  childForFieldName(name: string): TSNode | null;
}

interface TSParser {
  setLanguage(lang: unknown): void;
  parse(content: string): { rootNode: TSNode; delete(): void };
}

type LangName = "typescript" | "tsx" | "javascript" | "python" | "go" | "rust";

function langForExtension(ext: string): LangName | undefined {
  switch (ext) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Lazy, cached runtime loading. A single failure disables AST compression
// for the rest of the process (fall back to the heuristic, don't retry).
// ---------------------------------------------------------------------------

let runtimeState: "unloaded" | "failed" | "ready" = "unloaded";
let ParserCtor:
  | (new () => TSParser) & { init(): Promise<void>; Language: { load(p: string): Promise<unknown> } }
  | undefined;
let sharedParser: TSParser | undefined;
let wasmDir: string | undefined;
const loadedLanguages = new Map<LangName, unknown>();

async function loadRuntime(): Promise<boolean> {
  if (runtimeState === "ready") return true;
  if (runtimeState === "failed") return false;
  try {
    const require = createRequire(import.meta.url);
    wasmDir = path.join(
      path.dirname(require.resolve("tree-sitter-wasms/package.json")),
      "out",
    );
    const mod = (await import("web-tree-sitter")) as unknown as {
      default: typeof ParserCtor;
    };
    ParserCtor = mod.default ?? (mod as unknown as typeof ParserCtor);
    await ParserCtor!.init();
    sharedParser = new ParserCtor!();
    runtimeState = "ready";
    return true;
  } catch {
    runtimeState = "failed";
    return false;
  }
}

async function languageFor(lang: LangName): Promise<unknown | undefined> {
  if (loadedLanguages.has(lang)) return loadedLanguages.get(lang);
  try {
    const language = await ParserCtor!.Language.load(
      path.join(wasmDir!, `tree-sitter-${lang}.wasm`),
    );
    loadedLanguages.set(lang, language);
    return language;
  } catch {
    return undefined;
  }
}

/** True when the optional tree-sitter stack is present and loadable. */
export async function astCompressionAvailable(): Promise<boolean> {
  return loadRuntime();
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript / JSX / TSX
// ---------------------------------------------------------------------------

const JS_KEEP_WHOLE = new Set([
  "import_statement",
  "type_alias_declaration",
  "interface_declaration",
  "enum_declaration",
]);
const JS_DECL_TYPES = new Set([
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "abstract_class_declaration",
  "lexical_declaration",
  "variable_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
]);
const JS_FUNC_VALUE_TYPES = new Set([
  "arrow_function",
  "function_expression",
  "function",
]);

function jsSignatureOf(node: TSNode, source: string): string | undefined {
  for (const child of node.children) {
    if (child.type === "statement_block" || child.type === "class_body") {
      return (
        source.slice(node.startIndex, child.startIndex).trimEnd() + " { /* … */ }"
      );
    }
  }
  return undefined;
}

function renderJsDecl(
  decl: TSNode,
  source: string,
): { text: string; classBody?: TSNode } | undefined {
  const t = decl.type;
  if (
    t === "interface_declaration" ||
    t === "type_alias_declaration" ||
    t === "enum_declaration"
  ) {
    return { text: source.slice(decl.startIndex, decl.endIndex) };
  }
  if (t === "function_declaration" || t === "generator_function_declaration") {
    return {
      text:
        jsSignatureOf(decl, source) ?? source.slice(decl.startIndex, decl.endIndex),
    };
  }
  if (t === "class_declaration" || t === "abstract_class_declaration") {
    const body = decl.children.find((c) => c.type === "class_body");
    const header = body
      ? source.slice(decl.startIndex, body.startIndex).trimEnd()
      : source.slice(decl.startIndex, decl.endIndex);
    return { text: header + " {", classBody: body };
  }
  if (t === "lexical_declaration" || t === "variable_declaration") {
    // const foo = (…) => { … }: keep everything up to the function body
    const declarator = decl.children.find((c) => c.type === "variable_declarator");
    const value = declarator?.childForFieldName("value");
    if (value && JS_FUNC_VALUE_TYPES.has(value.type)) {
      const body = value.children.find((c) => c.type === "statement_block");
      if (body) {
        return {
          text:
            source.slice(decl.startIndex, body.startIndex).trimEnd() +
            " { /* … */ }",
        };
      }
    }
    // Plain values: keep short ones whole, first line of long ones
    const text = source.slice(decl.startIndex, decl.endIndex);
    return {
      text: text.length > 200 ? text.split("\n")[0] + " /* … */" : text,
    };
  }
  return undefined;
}

function walkJsClassBody(body: TSNode, source: string, out: string[]): void {
  for (const member of body.children) {
    if (
      member.type === "method_definition" ||
      member.type === "abstract_method_signature" ||
      member.type === "public_field_definition" ||
      member.type === "field_definition" ||
      member.type === "method_signature"
    ) {
      const sig = jsSignatureOf(member, source);
      const text =
        sig ?? source.slice(member.startIndex, member.endIndex).split("\n")[0];
      out.push("  " + text.trim());
    }
  }
  out.push("}");
}

function walkJs(root: TSNode, source: string, out: string[]): void {
  for (const child of root.children) {
    const t = child.type;
    if (JS_KEEP_WHOLE.has(t)) {
      out.push(source.slice(child.startIndex, child.endIndex));
    } else if (t === "export_statement") {
      const decl = child.children.find((c) => JS_DECL_TYPES.has(c.type));
      if (decl) {
        const prefix = source.slice(child.startIndex, decl.startIndex);
        const rendered = renderJsDecl(decl, source);
        if (rendered) {
          out.push(prefix + rendered.text);
          if (rendered.classBody) walkJsClassBody(rendered.classBody, source, out);
        }
      } else {
        // export { a, b } / export * from "…" / export default expr
        const text = source.slice(child.startIndex, child.endIndex);
        out.push(text.length > 200 ? text.split("\n")[0] + " /* … */" : text);
      }
    } else if (JS_DECL_TYPES.has(t)) {
      const rendered = renderJsDecl(child, source);
      if (rendered) {
        out.push(rendered.text);
        if (rendered.classBody) walkJsClassBody(rendered.classBody, source, out);
      }
    } else if (t === "expression_statement") {
      // module.exports = … (CommonJS)
      const firstLine = source
        .slice(child.startIndex, child.endIndex)
        .split("\n")[0];
      if (/^\s*(module\.exports|exports\.\w+)/.test(firstLine)) {
        out.push(firstLine + (firstLine.trimEnd().endsWith(";") ? "" : " /* … */"));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

function pyDef(def: TSNode, source: string, out: string[], indent: string): void {
  const body = def.childForFieldName("body");
  const header = body
    ? source.slice(def.startIndex, body.startIndex).trimEnd()
    : source.slice(def.startIndex, def.endIndex);
  out.push(indent + header);
  if (def.type === "class_definition" && body) {
    walkPython(body, source, out, indent + "    ");
  } else {
    out.push(indent + "    ...");
  }
}

function walkPython(
  root: TSNode,
  source: string,
  out: string[],
  indent = "",
): void {
  for (const child of root.children) {
    const t = child.type;
    if (
      t === "import_statement" ||
      t === "import_from_statement" ||
      t === "future_import_statement"
    ) {
      out.push(indent + source.slice(child.startIndex, child.endIndex));
    } else if (t === "decorated_definition") {
      for (const dec of child.children) {
        if (dec.type === "decorator") {
          out.push(indent + source.slice(dec.startIndex, dec.endIndex));
        }
      }
      const def = child.children.find(
        (c) => c.type === "function_definition" || c.type === "class_definition",
      );
      if (def) pyDef(def, source, out, indent);
    } else if (t === "function_definition" || t === "class_definition") {
      pyDef(child, source, out, indent);
    }
  }
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

const GO_KEEP_WHOLE = new Set([
  "package_clause",
  "import_declaration",
  "type_declaration",
  "const_declaration",
]);

function walkGo(root: TSNode, source: string, out: string[]): void {
  for (const child of root.children) {
    const t = child.type;
    if (GO_KEEP_WHOLE.has(t)) {
      out.push(source.slice(child.startIndex, child.endIndex));
    } else if (t === "function_declaration" || t === "method_declaration") {
      const body = child.childForFieldName("body");
      out.push(
        body
          ? source.slice(child.startIndex, body.startIndex).trimEnd() +
              " { /* … */ }"
          : source.slice(child.startIndex, child.endIndex),
      );
    } else if (t === "var_declaration") {
      const text = source.slice(child.startIndex, child.endIndex);
      out.push(text.length > 200 ? text.split("\n")[0] + " /* … */" : text);
    }
  }
}

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

const RUST_KEEP_WHOLE = new Set([
  "use_declaration",
  "extern_crate_declaration",
  "attribute_item",
  "inner_attribute_item",
  "type_item",
  "struct_item",
  "enum_item",
  "union_item",
  "trait_item",
  "const_item",
  "static_item",
  "macro_definition",
]);

function walkRust(root: TSNode, source: string, out: string[]): void {
  for (const child of root.children) {
    const t = child.type;
    if (RUST_KEEP_WHOLE.has(t)) {
      out.push(source.slice(child.startIndex, child.endIndex));
    } else if (t === "function_item") {
      const body = child.childForFieldName("body");
      out.push(
        body
          ? source.slice(child.startIndex, body.startIndex).trimEnd() +
              " { /* … */ }"
          : source.slice(child.startIndex, child.endIndex),
      );
    } else if (t === "impl_item" || t === "mod_item") {
      const body = child.children.find((c) => c.type === "declaration_list");
      if (body) {
        out.push(source.slice(child.startIndex, body.startIndex).trimEnd() + " {");
        const inner: string[] = [];
        walkRust(body, source, inner);
        for (const line of inner) out.push("    " + line);
        out.push("}");
      } else {
        out.push(source.slice(child.startIndex, child.endIndex));
      }
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Compress source to a signature skeleton using a real parse tree.
 * Returns undefined (caller falls back to the heuristic) when the
 * optional tree-sitter stack is unavailable or the language unsupported.
 */
export async function astCompressToSignatures(
  filePath: string,
  content: string,
): Promise<string | undefined> {
  const lang = langForExtension(path.extname(filePath).toLowerCase());
  if (!lang) return undefined;
  if (!(await loadRuntime())) return undefined;
  const language = await languageFor(lang);
  if (!language) return undefined;

  sharedParser!.setLanguage(language);
  const tree = sharedParser!.parse(content);
  try {
    const out: string[] = [];
    if (lang === "python") walkPython(tree.rootNode, content, out);
    else if (lang === "go") walkGo(tree.rootNode, content, out);
    else if (lang === "rust") walkRust(tree.rootNode, content, out);
    else walkJs(tree.rootNode, content, out);
    if (out.length === 0) return undefined;
    return out.join("\n");
  } finally {
    tree.delete();
  }
}
