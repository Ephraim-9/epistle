import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { packDirectory, type PackOptions } from "./pack.js";
import { cloneRemote, remoteRepoName } from "./git.js";

/**
 * MCP server mode: exposes Epistle's pack pipeline as tools over stdio so
 * agentic clients (Claude Code, Cursor, …) can pack and query codebases
 * live. Packs are written to temp files and addressed by ID — only
 * bounded summaries, chunks, and grep results travel over the protocol,
 * so multi-megabyte packs never flood the client's context.
 */

interface StoredPack {
  filePath: string;
  totalFiles: number;
  totalTokens: number;
  lineCount: number;
  source: string;
}

const MAX_READ_LINES = 2000;
const MAX_GREP_MATCHES = 200;

export function createEpistleMcpServer(version: string): McpServer {
  const packs = new Map<string, StoredPack>();

  const server = new McpServer({ name: "epistle", version });

  const packOptionShapes = {
    compress: z
      .boolean()
      .optional()
      .describe(
        "Signature-only compression: keep imports and declarations, elide bodies (~70% token reduction).",
      ),
    removeComments: z.boolean().optional().describe("Strip comments from source files."),
    removeEmptyLines: z.boolean().optional().describe("Remove blank lines."),
    maxTokens: z
      .number()
      .positive()
      .optional()
      .describe("Drop the heaviest files until the pack fits this token budget."),
    includeDiffs: z
      .boolean()
      .optional()
      .describe("Append working-tree and staged git diffs."),
    includeLogs: z
      .number()
      .positive()
      .optional()
      .describe("Append this many recent commits."),
    sort: z
      .enum(["path", "churn", "size"])
      .optional()
      .describe(
        "File order: path (default), churn (most-edited last), size (largest last).",
      ),
  };

  async function storePack(
    options: PackOptions,
    source: string,
  ): Promise<string> {
    const result = await packDirectory(options);

    const id = crypto.randomBytes(6).toString("hex");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "epistle-mcp-"));
    const filePath = path.join(dir, `epistle-${id}.md`);
    await fs.writeFile(filePath, result.output, "utf8");

    const lineCount = result.output.split("\n").length;
    packs.set(id, {
      filePath,
      totalFiles: result.totalFiles,
      totalTokens: result.totalTokens,
      lineCount,
      source,
    });

    const topFiles = [...result.fileTokenStats]
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10);

    const lines = [
      `Packed ${source}`,
      `outputId: ${id}`,
      `Total files: ${result.totalFiles}`,
      `Total tokens: ${result.totalTokens}`,
      `Pack lines: ${lineCount}`,
      "",
      "Top files by tokens:",
      ...topFiles.map((s) => `  ${s.tokens}\t${s.path}`),
    ];
    if (result.omittedForBudget.length > 0) {
      lines.push(
        "",
        `Omitted to fit token budget (${result.omittedForBudget.length}): ${result.omittedForBudget.slice(0, 10).join(", ")}${result.omittedForBudget.length > 10 ? ", …" : ""}`,
      );
    }
    if (result.suspiciousSkipped.length > 0) {
      lines.push(
        "",
        `Credential-shaped files excluded (${result.suspiciousSkipped.length}): ${result.suspiciousSkipped.slice(0, 10).join(", ")}`,
      );
    }
    lines.push(
      "",
      `Use read_output (outputId: "${id}") to page through the pack, or grep_output to search it.`,
    );
    return lines.join("\n");
  }

  function getPack(outputId: string): StoredPack {
    const pack = packs.get(outputId);
    if (!pack) {
      const known = Array.from(packs.keys());
      throw new Error(
        `Unknown outputId "${outputId}".` +
          (known.length > 0
            ? ` Known IDs: ${known.join(", ")}`
            : " Run pack_codebase or pack_remote first."),
      );
    }
    return pack;
  }

  const textResult = (text: string) => ({
    content: [{ type: "text" as const, text }],
  });

  server.registerTool(
    "pack_codebase",
    {
      title: "Pack a local codebase",
      description:
        "Pack a local directory into a single LLM-ready context document " +
        "(directory tree + file contents, secrets auto-redacted). Returns " +
        "an outputId plus token metrics; use read_output/grep_output to " +
        "retrieve content. Supports signature-only compression, token " +
        "budgets, git-diff-only packing, and git history sections.",
      inputSchema: {
        directory: z
          .string()
          .describe("Absolute path of the directory to pack."),
        scanPaths: z
          .array(z.string())
          .optional()
          .describe("Optional sub-paths (relative to directory) to restrict the pack to."),
        diffRef: z
          .string()
          .optional()
          .describe(
            'Pack only files changed vs this git ref (e.g. "HEAD", "main"), including untracked files.',
          ),
        ...packOptionShapes,
      },
    },
    async (args) => {
      const directory = path.resolve(args.directory);
      const stat = await fs.stat(directory).catch(() => undefined);
      if (!stat?.isDirectory()) {
        throw new Error(`"${args.directory}" is not a directory.`);
      }
      const summary = await storePack(
        {
          rootDir: directory,
          scanPaths: args.scanPaths,
          diffRef: args.diffRef,
          compress: args.compress,
          removeComments: args.removeComments,
          removeEmptyLines: args.removeEmptyLines,
          maxTokens: args.maxTokens,
          includeDiffs: args.includeDiffs,
          includeLogs: args.includeLogs,
          sort: args.sort,
        },
        directory,
      );
      return textResult(summary);
    },
  );

  server.registerTool(
    "pack_remote",
    {
      title: "Pack a remote git repository",
      description:
        "Shallow-clone a remote repository (full URL or GitHub user/repo " +
        "shorthand) and pack it like pack_codebase. The clone is deleted " +
        "afterwards; the pack stays available via its outputId.",
      inputSchema: {
        url: z
          .string()
          .describe('Repository URL or GitHub shorthand like "facebook/react".'),
        branch: z.string().optional().describe("Branch, tag, or commit to clone."),
        ...packOptionShapes,
      },
    },
    async (args) => {
      const cloneDir = await cloneRemote(args.url, args.branch);
      try {
        const summary = await storePack(
          {
            rootDir: cloneDir,
            compress: args.compress,
            removeComments: args.removeComments,
            removeEmptyLines: args.removeEmptyLines,
            maxTokens: args.maxTokens,
            includeDiffs: args.includeDiffs,
            includeLogs: args.includeLogs,
            sort: args.sort,
          },
          `${remoteRepoName(args.url)} (remote)`,
        );
        return textResult(summary);
      } finally {
        await fs.rm(cloneDir, { recursive: true, force: true });
      }
    },
  );

  server.registerTool(
    "read_output",
    {
      title: "Read a slice of a pack",
      description:
        `Read lines from a pack produced by pack_codebase/pack_remote. ` +
        `Returns at most ${MAX_READ_LINES} lines per call; page with startLine.`,
      inputSchema: {
        outputId: z.string().describe("ID returned by pack_codebase or pack_remote."),
        startLine: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based first line to return (default 1)."),
        maxLines: z
          .number()
          .int()
          .positive()
          .max(MAX_READ_LINES)
          .optional()
          .describe(`Number of lines to return (default 500, max ${MAX_READ_LINES}).`),
      },
    },
    async (args) => {
      const pack = getPack(args.outputId);
      const content = await fs.readFile(pack.filePath, "utf8");
      const lines = content.split("\n");
      const start = (args.startLine ?? 1) - 1;
      const count = Math.min(args.maxLines ?? 500, MAX_READ_LINES);
      const slice = lines.slice(start, start + count);
      const header =
        `[${pack.source}] lines ${start + 1}-${start + slice.length} of ${lines.length}` +
        (start + slice.length < lines.length
          ? ` (continue with startLine: ${start + slice.length + 1})`
          : " (end of pack)");
      return textResult(`${header}\n${slice.join("\n")}`);
    },
  );

  server.registerTool(
    "grep_output",
    {
      title: "Search within a pack",
      description:
        "Search a pack with a JavaScript regular expression. Returns " +
        "matching lines with line numbers (usable as read_output startLine) " +
        `and optional context. At most ${MAX_GREP_MATCHES} matches.`,
      inputSchema: {
        outputId: z.string().describe("ID returned by pack_codebase or pack_remote."),
        pattern: z.string().describe("JavaScript regular expression to search for."),
        ignoreCase: z.boolean().optional().describe("Case-insensitive matching."),
        contextLines: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe("Lines of context around each match (default 0, max 10)."),
      },
    },
    async (args) => {
      const pack = getPack(args.outputId);
      let regex: RegExp;
      try {
        regex = new RegExp(args.pattern, args.ignoreCase ? "i" : "");
      } catch (err) {
        throw new Error(`Invalid regular expression: ${(err as Error).message}`);
      }
      const content = await fs.readFile(pack.filePath, "utf8");
      const lines = content.split("\n");
      const context = args.contextLines ?? 0;

      const out: string[] = [];
      let matches = 0;
      for (let i = 0; i < lines.length && matches < MAX_GREP_MATCHES; i++) {
        if (!regex.test(lines[i])) continue;
        matches++;
        const from = Math.max(0, i - context);
        const to = Math.min(lines.length - 1, i + context);
        for (let j = from; j <= to; j++) {
          out.push(`${j + 1}${j === i ? ":" : "-"} ${lines[j]}`);
        }
        if (context > 0) out.push("--");
      }

      const header =
        matches === 0
          ? `No matches for /${args.pattern}/ in [${pack.source}].`
          : `${matches}${matches === MAX_GREP_MATCHES ? "+" : ""} match(es) for /${args.pattern}/ in [${pack.source}]:`;
      return textResult([header, ...out].join("\n"));
    },
  );

  return server;
}
