# Epistle 📜

**Pack a codebase into a single, LLM-friendly context file — with compression, token budgets, git awareness, and secret redaction built in.**

Epistle scans a project (or a remote repo), filters out noise, redacts
credentials, shapes the content to fit your model's context window, and
emits one tidy file in Markdown, XML, plain text, or JSON.

```bash
npx epistle --stdout | pbcopy         # pack the current directory
npx epistle src lib --compress -o ctx.md
npx epistle yamadashy/repomix --fit   # pack a remote repo by shorthand
```

Fast on real repos: packing facebook/react (7,000+ files) takes ~5s.

## Why Epistle?

Every codebase-packing tool solves part of the problem. Epistle combines
the best ideas from the whole field — and adds a few of its own:

| Capability | Epistle | repomix | code2prompt | gitingest | files-to-prompt | yek |
|---|---|---|---|---|---|---|
| Markdown / XML / plain / JSON output | ✅ | ✅ | template | ❌ | partial | template |
| Fence-safe Markdown (files containing ```` ``` ````) | ✅ | ❌ | ❌ | ❌ | ✅ | — |
| Signature compression (AST, tree-sitter) | ✅ +heuristic fallback | ✅ | ❌ | ❌ | ❌ | ❌ |
| Comment / blank-line stripping | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Fit-to-budget file dropping | ✅ | ❌ (fails) | ❌ | ❌ | ❌ | ✅ |
| Changed-files-only pack (`--diff`) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Git churn ordering (important last) | ✅ | partial | ❌ | ❌ | ❌ | ✅ |
| Secret redaction (default ON) | ✅ | ✅ scan | ❌ | ❌ | ❌ | ❌ |
| Credential-file exclusion (.env, keys) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Context-window fit report (`--fit`) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Remote repo ingest (`owner/repo`) | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| MCP server mode (`--mcp`) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Shell completions | ✅ bash/zsh/fish | ✅ | ❌ | ❌ | ❌ | ❌ |
| Personas + prompt recipes | ✅ | ❌ | templates | ❌ | ❌ | ❌ |
| Config profiles + JSON Schema | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| stdin file lists (`find … | epistle --stdin`) | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |

*(See [docs/RESEARCH.md](docs/RESEARCH.md) for the full competitive analysis.)*

## Install

```bash
npm install -g epistle    # or: npx epistle
```

Requires Node.js ≥ 18.

## Quickstart

```bash
epistle -o context.md                 # pack cwd into context.md
epistle src test -o ctx.md            # only these paths
epistle --dry-run                     # preview files + token counts, write nothing
epistle --stdout | llm "explain this" # pipe into anything
epistle --copy                        # straight to clipboard
```

## Fitting big codebases into small windows

```bash
epistle --compress -o ctx.md          # keep signatures, elide bodies (~80% smaller)
epistle --remove-comments --remove-empty-lines -o ctx.md
epistle --max-tokens 100000 -o ctx.md # drop heaviest files until it fits
epistle --lite -o ctx.md              # prune styles, images, data files
epistle --fit                         # bar chart: % of Claude/GPT/Gemini windows used
epistle --hog-depth auto              # find your token hogs
```

`--max-file-size <kb>` caps individual files (default 100KB). Binary files
are always listed but never inlined.

`--compress` uses **real parse trees** (tree-sitter) for TypeScript, JSX,
Python, Go, and Rust, so multi-line signatures, decorators, and return
types survive intact. Other languages fall back to a fast line-based
heuristic. The tree-sitter grammars are an *optional dependency* — install
with `npm i -g epistle --omit=optional` to skip the ~55MB download and the
heuristic covers everything.

## Git awareness

```bash
epistle --diff -o review.md           # ONLY files changed vs HEAD (incl. untracked)
epistle --diff main -o pr.md          # ... or vs any ref
epistle --include-diffs --include-logs 10 -o ctx.md
epistle --sort churn                  # most-edited files last (LLMs read the end best)
epistle user/repo                     # shallow-clone + pack a remote repo (shorthand)
epistle --remote https://github.com/x/y.git --remote-branch dev
```

A lone `owner/repo` argument that doesn't exist as a local path is packed
as a remote repository — no `--remote` flag needed. A local path of the
same name always wins.

## Security

Secret redaction is **on by default**: OpenAI/Anthropic/GitHub/GitLab/
Slack/Stripe/npm/Hugging Face/SendGrid/Twilio token shapes, JWTs, PEM
private-key blocks, and `apiKey = "…"` assignments are replaced with
`[REDACTED_SECRET]`. Credential-shaped files (`.env*`, SSH keys, `.pem`,
`.npmrc`, service-account JSON…) are excluded entirely and reported.

```bash
epistle --no-redact                   # opt out (output carries a warning)
```

## Prompt engineering built in

```bash
epistle --persona architect           # system-style header (arch|sec|ref aliases)
epistle --recipe review               # curated prompts: review | test | refactor
                                      #   | onboard | document | audit
epistle -t "Focus on the scheduler"   # your own task, composable with recipes
```

## Output formats

```bash
epistle --format markdown             # default: tree + ToC + fenced files
epistle --format xml                  # CDATA-wrapped, Claude-friendly
epistle --format plain                # separator-delimited text
epistle --format json                 # machine-readable, per-file tokens
epistle --tree-only                   # just the directory tree
epistle -n                            # line numbers
epistle --encoding cl100k_base        # GPT-3.5/4-era token counts
```

## Filtering

Ignore sources, in order: built-in defaults (lockfiles, `node_modules`,
build dirs, binaries…) → root `.gitignore` → nested `.gitignore`s →
`.llmignore` → `.epistleignore` → config `exclude` → `--exclude`.
`--include` force-includes after all filtering.

```bash
epistle -e "**/*.test.ts" "fixtures/**" -i "dist/types.d.ts"
find . -name "*.py" -newer main.py | epistle --stdin
git ls-files -z src | epistle --stdin -0
```

## Configuration

```bash
epistle --init                        # writes epistle.config.json
```

The generated file carries a `"$schema"` reference, so editors autocomplete
and validate it; Epistle also validates it at load time with field-level
errors.

```jsonc
{
  "$schema": "https://unpkg.com/epistle/epistle.schema.json",
  "output": { "file": "context.md", "format": "markdown", "lineNumbers": false, "copy": false },
  "exclude": ["**/*.snap"],
  "maxFileSizeKB": 100,
  "compress": false,
  "removeComments": false,
  "maxTokens": 150000,
  "sort": "churn",
  "includeLogs": 10,
  "profiles": {
    "pr-review": { "includeDiffs": true, "sort": "churn" },
    "tiny": { "compress": true, "removeComments": true, "maxTokens": 30000 }
  }
}
```

CLI flags always override config. Select a profile with
`epistle --profile tiny`.

## Console UX

- All diagnostics go to **stderr**; the pack itself is the only thing on
  stdout, so piping is always safe.
- `-q/--quiet` for errors-only, `--verbose` for scan details and timings.
- Banner/spinner only on interactive terminals; `NO_COLOR` respected.
- After each pack: token-colored dashboard, top context hogs
  (`--hog-depth 0|N|auto`), and `--fit` context-window bars.

## MCP server mode

Expose Epistle's pack pipeline to agentic MCP clients (Claude Code,
Cursor, …) over stdio:

```bash
epistle --mcp
```

Tools: `pack_codebase` (local dir, with compression / diff-vs-ref / token
budgets / git history), `pack_remote` (shallow-clone `owner/repo`),
`read_output` (page a pack by line range), `grep_output` (regex search a
pack). Packs are stored server-side and addressed by ID, so only bounded
summaries, chunks, and matches cross the protocol — a multi-megabyte pack
costs the client a few hundred tokens until it asks for content.

Example client config:

```jsonc
{ "mcpServers": { "epistle": { "command": "epistle", "args": ["--mcp"] } } }
```

## Shell completions

```bash
epistle completion bash > /etc/bash_completion.d/epistle
epistle completion zsh  > "${fpath[1]}/_epistle"
epistle completion fish > ~/.config/fish/completions/epistle.fish
```

Flags, formats, and recipes complete out of the box; `--profile` completes
dynamically from the profiles in your `epistle.config.json`.

## All options

Run `epistle --help` for the complete list.

## License

MIT — see [LICENSE](LICENSE).
