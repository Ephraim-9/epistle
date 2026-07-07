# Changelog

All notable changes to Epistle are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

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
