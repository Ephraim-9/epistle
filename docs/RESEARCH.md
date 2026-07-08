# Competitive Landscape: Codebase → LLM-Context Tools

> Research compiled 2026-07. This document catalogs every notable tool in the
> "pack a codebase into a single AI-friendly context file" space, analyzes
> what each does well ("hit") and poorly ("miss"), and derives the Epistle
> roadmap from the gaps.

---

## 0. Re-scan note (2026-07-08)

The catalog in §1 is the original frozen snapshot. A re-scan of the fast
movers found the following changes since it was written, and Epistle's
response:

- **Repomix (now ~1.16.0)** shipped: *watch mode*; *bare `owner/repo`
  remote shorthand* (no `--remote` flag); `output.filePathStyle:
  cwd-relative`; `--compress` made resilient (one unparseable file no
  longer aborts the pack); and an **argument-injection fix** validating
  refs / inserting `--end-of-options` before user-supplied refs in
  `git fetch`/`checkout`.
  → Epistle adopted the two that earn their weight: **`owner/repo`
    shorthand** (v1.7.0) and the **argument-injection hardening**
    (v1.7.0 — Epistle's remote clone and `--diff` ref were vulnerable to
    the same class). Per-file compression resilience was already
    Epistle's design (v1.6.0 AST engine falls back per file, never
    aborts). Watch mode stays deliberately unbuilt (see §4 revision).
- **code2prompt / gitingest** — no structural changes vs the snapshot;
  both already had MCP servers, which Epistle matched in v1.4.0.
- **Landscape trend**: MCP server mode is now table stakes (Epistle:
  v1.4.0), and tools continue moving from "dump everything" to ranked
  selection (Epistle: churn sort + priority-last ordering, since v0.6.0).

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
>
> **Revision (2026-07-08, v1.6.0): tree-sitter compression shipped after
> benchmarking.** Measured on facebook/react (4,435 JS/TS/PY files,
> 4.16M tokens): line heuristic 81.3% reduction in 0.15s; AST 84.7% in
> 6.7s with zero parse failures. The ratio gap is small, but the
> *correctness* gap is not: the heuristic drops every parameter line of
> multi-line signatures, decorator arguments, and return types — exactly
> the content a skeleton exists to preserve (verified on crafted edge
> cases; the AST output keeps all of them). Design: web-tree-sitter +
> tree-sitter-wasms ship as **optionalDependencies** (~55MB), the same
> `--compress` flag prefers the AST engine (TS/JS/TSX/JSX, Python, Go,
> Rust) and falls back per-file to the heuristic for other languages —
> or entirely when installed with `--omit=optional` (note: npm honors
> that flag for local installs, not global ones). Grammar wasms are
> ABI-tied to web-tree-sitter 0.20.x; the pins must move together.
>
> **Distribution decision (2026-07-08, v1.5.1):** the npm tarball is the
> single supported channel, verified end-to-end (`npm pack` → global
> install → pack/completions smoke test). Homebrew and Docker — which
> Repomix ships — were evaluated and **deliberately skipped**:
> - *Homebrew*: a formula (or tap) must be re-released for every
>   version, and Epistle's audience already has Node — `npm i -g
>   epistle` / `npx epistle` is strictly less friction than adding a
>   brew dependency on the node keg. Revisit only if a standalone
>   compiled binary (bun/pkg) ever ships for non-Node users.
> - *Docker*: packing requires bind-mounting the target repo and
>   fighting output-file uid/gid; every real use (local or CI) is
>   served better by `npx epistle`. An image adds a registry, build
>   pipeline, and version skew for zero reach.

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

---

## 5. Hardening cycle (2026-07-08, v1.1.0–v1.7.0)

A second pass targeting real weaknesses rather than flag count:

- **v1.1.0 — Performance.** Scanner parallelized (bounded 64-way,
  single-read binary detection) and tokenizer swapped js-tiktoken →
  gpt-tokenizer. facebook/react full pack **22.95s → 5.43s (4.2×)**,
  byte-identical output; scan phase 5.1s → ~0.9s after v1.5.0.
- **CI.** GitHub Actions: build + 70 tests on Node 18/20/22 (Linux) and
  Node 22 (Windows, macOS). Previously zero automated enforcement.
- **v1.2.0 — Config schema + validation.** `epistle.schema.json`
  (bundled, wired into `--init` via `$schema`); load-time validation
  with field-level errors and did-you-mean suggestions.
- **v1.3.0 — Shell completions.** `epistle completion bash|zsh|fish`,
  generated from the live option list; profiles/recipes complete
  dynamically.
- **v1.4.0 — MCP server.** `epistle --mcp` over stdio (pack_codebase,
  pack_remote, read_output, grep_output). Reverses the v1.0.0 skip
  decision (see §4 revision).
- **v1.5.0 — Edge-case audit.** Gitignore negation cascade across nested
  levels; symlink resolution fixed (was silently dropping symlinked
  files) with cycle safety; monorepo tech-stack detection; Windows path
  normalization.
- **v1.5.1 — Distribution.** npm pack → global install verified
  end-to-end; MIT LICENSE + metadata added; Homebrew/Docker evaluated
  and declined (rationale in §4).
- **v1.6.0 — Tree-sitter compression.** AST engine for TS/JS/Python/Go/
  Rust behind `--compress`, heuristic fallback; 84.7% vs 81.3% on react
  with correct multi-line signatures. Reverses the v1.0.0 skip (§4).
- **v1.7.0 — Landscape re-scan.** `owner/repo` shorthand and git
  argument-injection hardening adopted from Repomix's 2026 changes
  (see §0).

Still deliberately unbuilt: **watch mode** (an MCP client re-packs on
demand) and **split-output** (200k+ windows + `--max-tokens` cover it).
