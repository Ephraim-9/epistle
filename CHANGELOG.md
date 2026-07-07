# Changelog

All notable changes to Epistle are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

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
