# Competitive Landscape: Codebase → LLM-Context Tools

> Research compiled 2026-07. This document catalogs every notable tool in the
> "pack a codebase into a single AI-friendly context file" space, analyzes
> what each does well ("hit") and poorly ("miss"), and derives the Epistle
> roadmap from the gaps.

---

## 1. Tool Catalog

### 1.1 Repomix (TypeScript / npm) — the category leader
The most feature-complete tool in the space. Key capabilities:

- **Output styles**: XML (default), Markdown, JSON, Plain — via `--style`.
- **Compression**: `--compress` uses Tree-sitter to extract signatures only
  (~70% token reduction).
- **Token features**: per-file token counts, `--token-count-tree [threshold]`
  (hierarchical token visualization), `--token-budget` (fail if exceeded),
  selectable encoder (`--token-count-encoding`, o200k_base default).
- **Content shaping**: `--remove-comments` (15+ languages),
  `--remove-empty-lines`, `--output-show-line-numbers`, `--truncate-base64`,
  `--split-output <size>`, `--header-text`, `--instruction-file-path`.
- **Git**: `--include-logs [count]`, `--include-diffs` (working tree +
  staged), sort files by change frequency (churn) by default.
- **Ignore stack** (priority order): config custom patterns → `.repomixignore`
  → `.ignore` → `.gitignore` + `.git/info/exclude` → built-in defaults. Each
  layer can be disabled (`--no-gitignore`, `--no-default-patterns`, …).
- **Remote**: `--remote <url|user/repo>`, `--remote-branch`.
- **Security**: Secretlint scan of every file; suspicious files excluded with
  a warning; `--no-security-check` opt-out.
- **Config**: `repomix.config.json5/jsonc/json/js/ts` + `--init` generator +
  global config; per-file compression levels via `output.patterns`.
- **Modes**: `--mcp` (MCP server), `--watch`, `--stdin` (file list),
  `--quiet`, `--verbose`, `--copy`, `--stdout`.
- **Extras**: Claude Agent Skills generation, website (repomix.com), browser
  extensions, GitHub Action, Docker image, library API.
- **Output structure**: generation header ("this is a merged representation…"),
  file summary, directory tree, files, then instructions at the END (better
  for LLM attention).

### 1.2 code2prompt (Rust)
- Handlebars **template system** — fully custom prompt shapes.
- Interactive **TUI** for picking files.
- Token counting before submission; clipboard by default.
- Git: diff inclusion, git log, **branch comparison**.
- Smart readers for CSV / notebooks / JSONL.
- Ecosystem: core Rust lib, Python SDK, MCP server.

### 1.3 gitingest (Python)
- Famous UX trick: replace `github.com` → `gitingest.com` in any repo URL.
- Output = **summary + tree + content** triple; defaults to `digest.txt`.
- `-o -` for stdout; PAT support for private repos; `--include-submodules`;
  `--include-gitignored`; subdirectory URLs (`/tree/branch/path`).
- Python API (sync + async). Browser extensions. Self-hostable server.

### 1.4 files-to-prompt (Python, Simon Willison)
- Minimal & composable. Reads **file paths from stdin** (pipe from `find`),
  `-0/--null` for NUL-separated paths.
- `-c/--cxml` — Claude-optimized `<documents>` XML per Anthropic guidance.
- `-m/--markdown` with **smart backtick nesting** (extends fences when file
  content contains code fences).
- `-e/--extension` filters, `--include-hidden`, `--ignore` fnmatch patterns,
  `--ignore-files-only`, `-n/--line-numbers`.

### 1.5 yek (Rust)
- Performance-focused ("230× faster than repomix" on Next.js repo).
- **Priority ordering**: important files LAST (LLMs attend most to the end
  of context); priority from config rules + git history boost
  (`git_boost_max`).
- Size caps: `--max-size 10MB` or `--tokens 128k` — drops low-priority files
  to fit budget.
- Auto-detects piped output → streams instead of writing file.
- `--output-template` with `FILE_PATH`/`FILE_CONTENT` placeholders; JSON
  output; `--tree-only` / `--tree-header`; config in YAML/TOML/JSON.

### 1.6 onefilellm (Python)
- Multi-source aggregation: GitHub repos/PRs/issues, arXiv papers, YouTube
  transcripts, web docs crawl, local dirs — one XML output, auto-clipboard.

### 1.7 codebase-digest (Python)
- Consolidation + **analysis prompt library** (60+ prompts in 8 categories:
  quality, learning, refactoring, testing/security, business analysis,
  architecture, performance, evolution).
- Text/JSON/Markdown/XML/HTML outputs, `--max-depth`, `--show-size`,
  `--show-ignored`, `--no-content` (tree only), clipboard.

### 1.8 Others (minor)
- **llm-context** (Python): profiles per task type, clipboard-centric flow,
  MCP; smart selection of full files vs outlines.
- **ai-digest** (npm): aggregates to `codebase.md`, `.aidigestignore`,
  whitespace removal flag, watch mode.
- **repo2txt / uithub / repoprompt**: web/GUI variants of the same idea.
- **ContextForge / cargo-onefile**: niche single-language variants.

---

## 2. Cross-Tool Feature Matrix (the tricks that matter)

| Feature | repomix | code2prompt | gitingest | files-to-prompt | yek | Epistle 0.3 |
|---|---|---|---|---|---|---|
| Markdown output | ✅ | ✅ | ✅ | ✅ | template | ✅ |
| XML output (Claude-tuned) | ✅ | template | ❌ | ✅ cxml | template | ⚠️ ad-hoc |
| JSON / plain output | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Directory tree | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Token counting | ✅ multi-encoder | ✅ | ✅ | ❌ | ✅ | ✅ fixed |
| Token budget / fit-to-limit | ✅ fail | ❌ | ❌ | ❌ | ✅ drop | ⚠️ warn only |
| Token tree / hotspots | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ hogs |
| Comment removal | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Empty-line removal | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Signature-only compression | ✅ tree-sitter | ❌ | ❌ | ❌ | ❌ | ❌ |
| Line numbers | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Git churn sort | ✅ | ❌ | ❌ | ❌ | ✅ boost | ❌ |
| Include git diffs | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Include git log | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Changed-files-only mode | ❌ | ⚠️ | ❌ | ❌ | ❌ | ❌ |
| Config file | ✅ many | ✅ | ❌ | ❌ | ✅ | ❌ |
| `--init` config generator | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Tool-specific ignore file | ✅ .repomixignore | ❌ | ❌ | ❌ | ✅ | ✅ .llmignore |
| Nested .gitignore support | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ root only |
| Secret scanning | ✅ secretlint | ❌ | ❌ | ❌ | ❌ | ✅ 4 patterns |
| Remote repo ingest | ✅ | ❌ | ✅ core | ❌ | ❌ | ❌ |
| Clipboard | ✅ | ✅ default | ❌ | ❌ | ❌ | ✅ |
| Stdin file list | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Positional paths / globs | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ cwd only |
| Quiet/verbose modes | ✅ | ✅ | ❌ | ❌ | ✅ debug | ❌ |
| Important-files-last ordering | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Instruction/task injection | ✅ file | ✅ template | ❌ | ❌ | ❌ | ✅ --task |
| Persona presets | ❌ | via template | ❌ | ❌ | ❌ | ✅ unique |
| Prompt library | ❌ | ⚠️ templates | ❌ | ❌ | ❌ | ❌ |
| Watch mode | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| MCP server | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Split output | ✅ | ❌ | ❌ | ❌ | ✅ chunks | ❌ |
| Model context-fit report | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (invent) |

---

## 3. Hit / Miss Analysis

### Repomix
- **Hits**: the ignore-stack layering; tree-sitter compression; token tree;
  security scan default-on; instructions placed at end of output; config
  ecosystem; git churn sort default-on.
- **Misses**: heavyweight (slow on huge repos — yek's benchmark); XML default
  surprises Markdown users; no fit-to-budget dropping (budget just fails);
  no "changed files only" workflow.

### code2prompt
- **Hits**: templating is the ultimate escape hatch; TUI; branch compare.
- **Misses**: no ignore-file of its own; fewer content-shaping toggles; no
  security scanning; template authoring is a barrier.

### gitingest
- **Hits**: unbeatable URL-swap UX; summary-first output; async API.
- **Misses**: CLI is thin; no token budget, no compression, no comment
  stripping, no secret scan.

### files-to-prompt
- **Hits**: perfect Unix composability (stdin, -0); cxml; smart fence
  nesting (a correctness detail almost everyone else gets wrong!).
- **Misses**: intentionally minimal — no tree, no tokens, no config.

### yek
- **Hits**: speed; priority-last ordering insight; budget-aware dropping;
  stream detection.
- **Misses**: no secret scan; no comment removal; less-known ecosystem.

### codebase-digest
- **Hits**: the 60+ prompt library is a genuinely different value-add.
- **Misses**: tool itself is basic; unmaintained energy.

### Epistle 0.3 (self-assessment)
- **Hits**: personas (unique!), context-hog report with depth modes,
  dashboard, auto-redaction default-on, task injection, lite mode.
- **Misses**: root-only .gitignore (correctness bug on monorepos); no config
  file; no plain/JSON output; markdown fences break on files containing
  ``` (correctness bug); fixed encoder; warn-only budget; no comment
  stripping/compression; no git awareness; no positional paths; no
  quiet/verbose; secret patterns too narrow; `Task:` line in dashboard
  always shows "(none)" even when --task is set (bug).

---

## 4. Epistle Roadmap (derived)

> **Status (2026-07-07): all milestones below shipped in v0.4.0–v1.0.0.**
> Deliberately not built: watch mode and MCP server (Epistle is a
> pack-once CLI; both would pull in daemon lifecycle concerns better
> served by wrapping Epistle), tree-sitter compression (the zero-dependency
> signature extractor achieves comparable reduction without native/wasm
> install weight), and split-output (modern 200k+ windows and `--max-tokens`
> cover the need).
>
> **Revision (2026-07-08, v1.4.0): the MCP decision above was reversed.**
> The market moved: MCP is now how agentic tools (Claude Code, Cursor,
> Windsurf) consume external capabilities live, and both Repomix and
> code2prompt ship server modes. `epistle --mcp` now exposes
> `pack_codebase` / `pack_remote` / `read_output` / `grep_output` over
> stdio. The original daemon-lifecycle concern was answered by design:
> packs are stored in temp files and addressed by ID, only bounded
> summaries/chunks/grep results cross the protocol, and the server is a
> thin layer over the same `packDirectory()` pipeline the CLI uses — no
> watch loops, no state beyond the pack registry. Watch mode remains
> unbuilt (an MCP client re-packs on demand, which covers the use case
> with none of the file-watcher complexity).

**v0.4.0 — Correctness + parity foundations**
config file (`epistle.config.json` + `--init`), `.epistleignore`, nested
`.gitignore`s, `plain` + `json` formats, smart fence nesting fix, positional
path args, `--line-numbers`, `--dry-run`, `--max-file-size`, dashboard task
bug fix, test suite.

**v0.5.0 — Compression & budget**
`--remove-comments`, `--remove-empty-lines`, `--compress` (signature
extraction), `--max-tokens` fit-to-budget with priority-aware dropping
(yek-style), `--split-output`.

**v0.6.0 — Git awareness**
`--diff` (changed-files-only pack — gap in ALL tools), `--include-diffs`,
`--include-logs [n]`, `--sort churn|path|size|tokens`, priority-last
ordering option (`--order priority-last`).

**v0.7.0 — Security & token intelligence**
Expanded secret patterns (GitHub/Slack/Stripe/private-key/npm/etc.),
`--no-redact`, `--encoding` choice, **model fit report** (invented: show %
of Claude/GPT/Gemini context windows consumed), token tree threshold.

**v0.8.0 — UX & invented features**
`--quiet`/`--verbose`, NO_COLOR, stdin file lists, `--tree-only`,
**profiles** (named recipe presets in config — invented), **prompt library**
(`--recipe review|test|refactor|onboard` codebase-digest-style), watch mode
evaluation, remote repo ingest evaluation.

**v1.0.0 — Docs & polish**
README rewrite with comparison table, CHANGELOG, npm metadata, final QA.
