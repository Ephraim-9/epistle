# Changelog

All notable changes to Epistle are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [1.3.0] - 2026-07-08

### Added
- **Shell completions**: `epistle completion bash|zsh|fish` prints an
  install-ready completion script (install instructions in the script
  header). Scripts are generated from the live commander option list, so
  they cannot drift from the real flag set. Fixed-vocabulary flags
  (`--format`, `--sort`, `--persona`, `--encoding`, `--recipe`) complete
  their values; `--profile` completes dynamically from the profile names
  in the nearest `epistle.config.json` (via the quiet helper
  `epistle completion --list-profiles`); `--output`/`--config` complete
  file paths.

## [1.2.0] - 2026-07-07

### Added
- **JSON Schema for the config file** (`epistle.schema.json`, bundled in
  the npm package): editors autocomplete and validate
  `epistle.config.json`. The `--init` template now carries a `"$schema"`
  reference automatically.
- **Load-time config validation**: every field is checked against the
  schema shape with field-level error paths (e.g.
  `profiles.tiny.compress: must be a boolean`), enum listings for
  `format`/`sort`/`persona`/`encoding`, and did-you-mean suggestions for
  misspelled keys. All problems are reported at once, not one per run.
- GitHub Actions CI: build + full test suite on Node 18/20/22 for every
  push and pull request, plus a compiled-CLI smoke test.

## [1.1.0] - 2026-07-07

### Changed
- **4.2× faster end-to-end on large repos** (facebook/react, 7,128 files:
  23.0s → 5.4s; scan phase 5.1s → 1.4s). Three independent fixes, with
  byte-identical output verified against the previous version:
  - Scanner reads files with bounded parallelism (64 concurrent fs ops)
    instead of one at a time, and reads each file **once** — binary
    detection now sniffs the in-memory buffer instead of re-opening the
    file from disk.
  - Tokenizer swapped from `js-tiktoken` to `gpt-tokenizer` (still pure
    JS, no wasm/native deps): identical token counts, 5.6× faster
    encoding, 3× faster initialization. Encoders are cached, so the
    `--max-tokens` re-format pass no longer pays initialization twice.
  - Two accidentally-quadratic lookups (JSON per-file token stats, token
    budget file dropping) replaced with map lookups.

### Notes
- `formatOutput()` in the library API is now async.

## [1.0.0] - 2026-07-07

### Added
- Full README with quickstart, feature guide, and cross-tool comparison.
- `--init` template now ships two example profiles (`tiny`, `pr-review`).

### Notes
- Feature-complete against the v0.4–v0.8 roadmap derived from the
  competitive analysis in `docs/RESEARCH.md`. Watch mode, MCP server,
  tree-sitter compression, and split-output were evaluated and
  intentionally left out (rationale documented in the research doc).

## [0.8.0] - 2026-07-07

### Added
- **`--remote <url>` + `--remote-branch`**: shallow-clone and pack any
  remote repository (`user/repo` GitHub shorthand supported); auto-named
  output `epistle-<repo>.<ext>`; temp clone always cleaned up.
- **`--profile <name>`** *(invented)*: named presets in
  `epistle.config.json` under `profiles`, deep-merged over the base config.
- **`--recipe <name>`** *(invented twist on codebase-digest's prompt
  library)*: six curated, task-shaped analysis prompts — `review`, `test`,
  `refactor`, `onboard`, `document`, `audit` — appended as the task
  section and composable with `--task` and `--persona`.
- **`--stdin` / `-0`**: read the file list from stdin (newline- or
  NUL-separated), enabling `find`/`fzf`/`git ls-files` pipelines.
- **`--tree-only`**: emit just the directory tree.
- **`-q, --quiet`** and **`--verbose`**: quiet suppresses everything but
  errors; verbose adds config source, scan totals, and prune counts.
- Elapsed time in the success line.

### Changed
- Banner and spinner render only on interactive terminals (clean logs in
  CI and pipes); `NO_COLOR` respected via chalk.
- With piped stdout and no explicit `-o`, auto-named outputs (persona/
  remote defaults) now stream to stdout instead of writing a file.

## [0.7.0] - 2026-07-07

### Added
- **Expanded secret detection** (new `secrets` module): GitHub, GitLab,
  Slack, Stripe, npm, Hugging Face, SendGrid, Twilio tokens; PEM private
  key blocks; and a conservative `apiKey = "…"` assignment heuristic that
  preserves the key name. SRI hashes and plain hex still never match.
- **Credential-shaped file exclusion**: `.env*`, SSH keys, `.pem`/`.p12`,
  `.npmrc`, `.netrc`, service-account JSON, `secrets.yaml` are excluded
  from packs entirely and reported (redaction alone is not enough there).
- **`--no-redact`**: opt out of redaction; the output header then carries
  an explicit warning.
- **`--encoding <name>`**: choose the tokenizer (`o200k_base` default,
  `cl100k_base` for GPT-3.5/4-era counts).
- **`--fit`** *(invented — no competing tool has this)*: bar-chart report
  of how the pack fits popular context windows (Claude 200k, GPT-4o 128k,
  Gemini 1M, local 32k) with does-not-fit highlighting.

## [0.6.0] - 2026-07-07

### Added
- **`--diff [ref]`**: pack only files changed vs a ref (default HEAD),
  including untracked files — a workflow gap in every competing tool.
- **`--include-diffs`**: append working-tree and staged diffs to the output
  (all four formats).
- **`--include-logs [count]`**: append recent commit history (default 20).
- **`--sort <mode>`**: `path` (default), `churn` (most-edited files last —
  LLMs attend most to the end of context), or `size` (largest last).
- All git options configurable via `epistle.config.json`
  (`sort`, `includeDiffs`, `includeLogs`).
- Graceful degradation outside git repos (warning; `--diff` errors).
- Git module test suite against real temp repositories (28 tests total).

## [0.5.0] - 2026-07-07

### Added
- **`--remove-comments`**: comment stripping with a string-literal-safe
  state machine for C-like languages; also hash languages, HTML/XML, CSS,
  SQL, Lua.
- **`--remove-empty-lines`**: blank-line removal.
- **`--compress`**: dependency-free signature-only compression
  (imports/exports, class/function/type declarations kept; bodies elided)
  for TS/JS/Python/Go/Rust/Java/C#/Kotlin/Swift. ~77% token reduction
  measured on this repository.
- **`--max-tokens <count>`**: fit-to-budget enforcement that drops the
  heaviest files (never `package.json`), marks omissions in the tree and
  file sections, and reports what was cut.
- All four options available in `epistle.config.json`.
- Content-shaping savings reported after packing.

## [0.4.0] - 2026-07-07

### Added
- **Config file support**: `epistle.config.json` with `--config <path>`
  override and `--init` generator. CLI flags always win over config values.
- **`.epistleignore`** ignore file (`.llmignore` still honored).
- **Nested `.gitignore` support**: `.gitignore` files in subdirectories now
  apply to their directory, like git itself (monorepo correctness).
- **New output formats**: `--format plain` (separator-delimited text) and
  `--format json` (structured, machine-readable with per-file token counts).
- **Positional paths**: `epistle src lib/utils.ts` packs only those paths.
- **`--dry-run`**: preview the file list with token counts, sorted by
  weight, without writing anything.
- **`-n, --line-numbers`**: prefix content lines with padded line numbers.
- **`--max-file-size <kb>`**: configurable oversize threshold (was fixed
  100KB); skip messages now reflect the configured limit.
- Test suite (`npm test`, node:test via tsx) covering scanner and formatter.
- Expanded default excludes: build dirs, more lockfiles, minified assets,
  source maps, fonts, archives.
- Tech-stack detection now recognizes Rust/Go/Python/Ruby/Java manifests;
  more languages get correct markdown fence tags.

### Fixed
- **Markdown corruption**: files containing ``` fences are now wrapped in a
  longer fence (files-to-prompt-style backtick extension).
- Dashboard `Task:` line showed "(none)" even when `--task` was provided.
- Persona default output file extension now matches the chosen format.

## [0.3.0] and earlier
See git history: project auditor hog reporting and dashboard, lite mode,
include overrides, pruning stats, task injection, smart aliases,
auto-naming, `--clean`, scanner ignores, token budget warning, redaction
count, initial release.
