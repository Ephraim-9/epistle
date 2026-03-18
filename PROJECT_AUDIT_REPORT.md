# Epistle v0.3.0 – Project Audit Report

**Date:** March 18, 2026  
**Scope:** Redundancy, Edge Cases, Performance, Logic Integrity, Security, Terminal UI  
**Auditor:** Senior Software Architect & Security Engineer

---

## Executive Summary

Epistle is a Node.js CLI that packs a local codebase into an LLM-friendly context file. This audit identifies **2 Critical** issues, **4 Warnings**, and **5 Optimizations** across redundancy, edge-case handling, logic integrity, security, and terminal compatibility.

---

## 1. Redundancy Analysis

### 1.1 `aggregateDirectoryTokens` vs `formatOutput` – Overlap Check

**Finding: Minimal Redundancy**

| Component | Responsibility | Traversal / Computation |
|-----------|----------------|-------------------------|
| `scanProject` (scanner.ts) | Single FS traversal via `fast-glob` | `fg("**/*", ...)` – one glob pass |
| `formatOutput` (formatter.ts) | Builds tree, redacts, computes stats | In-memory over `ScannedFile[]` |
| `computeFileTokenStats` | Token counting via tiktoken | Single pass over files |
| `aggregateDirectoryTokens` | Aggregates tokens into dir map | Single pass over `FileTokenStat[]` |

**Conclusion:** No duplicate filesystem traversal. Token counting happens once in `computeFileTokenStats`; `aggregateDirectoryTokens` only aggregates precomputed stats.

**Minor redundancy:** `scanner.ts` sorts files (lines 203–208) and `formatOutput` sorts again (line 217: `[...files].sort()`). The duplicate sort is redundant.

---

## 2. Edge-Case Stress Test: Scanner

**Note:** The scanner does **not** use a custom recursive walker. It uses `fast-glob` for traversal.

### 2.1 Circular Symlinks

| Scenario | Behavior |
|----------|----------|
| Symlink `A → B → A` | `fs.realpath()` throws `ELOOP` (or similar). The `try/catch` (lines 158–169) catches and skips. ✅ |
| Broken symlink | `realpath` or `stat` throws; symlink is skipped. ✅ |

**Verdict:** Circular and broken symlinks are handled safely.

### 2.2 Empty Subdirectories

`fast-glob` uses `onlyFiles: true`, so directories are never returned. Empty dirs do not affect the scan. ✅

### 2.3 Repositories with 10k+ Files

| Concern | Analysis |
|---------|----------|
| Memory | All file contents are held in `ScannedFile[].content`. 10k × ~50KB ≈ 500MB+ RAM risk. ⚠️ |
| I/O | O(n) operations: `lstat`, optional `realpath`+`stat`, `isBinaryFile`, `readFile` per file. No batching. ⚠️ |
| Timeouts | No explicit timeout or cancellation. ⚠️ |

**Verdict:** Works for typical repos; large codebases (10k+ files) may hit memory and I/O limits without safeguards.

### 2.4 Double Glob with `includeGlobs`

When `--include` is used, a second `fg(includeGlobs, ...)` call runs. For large trees this adds another glob pass. Minor cost; acceptable for current design.

---

## 3. Logic Integrity: `--hog-depth` and Auto Depth

### 3.1 Shallow Repositories

| Scenario | Behavior |
|----------|----------|
| Root-only files (e.g. `index.ts`) | `aggregateDirectoryTokens` yields only root entry `""`. `computeAutoDirDepth` returns `undefined`. Fallback `?? 1` is used. `computeTopDirHogs(depth=1)` finds no dirs → `topDirs = []`. Hog report shows only file hogs. ✅ |
| Single depth (e.g. `src/a.ts`) | `dirTokenMap` has `"src"` at depth 1. Auto depth = 1. ✅ |

**Verdict:** No crash on shallow repos; behavior is correct.

### 3.2 Percentages with `--lite` Skips

`totalTokens` is computed from files that pass the `--lite` filter. Hog percentages are `(entry.tokens / totalTokens) * 100`. They reflect share of the **included** context, not the original repo. ✅ Correct semantics.

### 3.3 `totalTokens === 0`

`computeHogsForProject` returns early with empty `hogEntries` when `totalTokens <= 0`. No division-by-zero. ✅

---

## 4. Safety & Security: `redactSecrets`

### 4.1 Current Patterns (formatter.ts:87–93)

| Pattern | Coverage |
|---------|----------|
| `sk-[A-Za-z0-9]{16,}` | OpenAI-style keys ✅ |
| `AKIA[0-9A-Z]{16}` | AWS access keys ✅ |
| `AIza[0-9A-Za-z\-_]{20,}` | Google API keys ✅ |
| JWT-like (3× 20+ char segments) | Generic JWT ✅ |

### 4.2 Gaps for 2026-Era API Keys

| Provider | Format | Status |
|----------|--------|--------|
| Anthropic / Claude | `sk-ant-` prefix | ❌ **Not covered** |
| Cursor Admin API | `key_` + long hex string | ❌ **Not covered** |
| GitHub | `ghp_`, `gho_`, `ghu_`, etc. | ❌ **Not covered** |
| GitLab | `glpat-` | ❌ **Not covered** |
| Stripe | `sk_live_`, `sk_test_` | ❌ **Not covered** |
| Slack | `xoxb-`, `xoxp-` | ❌ **Not covered** |

### 4.3 False Positive Risk

The JWT pattern  
`\b[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}\b`  
can match non-secret base64 blobs in code (e.g. encoded config, test fixtures). Moderate risk of over-redaction.

**Recommendation:** Add provider-specific prefixes for Anthropic, Cursor, GitHub, etc., and consider tightening or scoping the JWT pattern (e.g. only in strings or typical env var contexts).

---

## 5. Terminal UI: `bin.ts` Dashboard

### 5.1 Box-Drawing Characters

```text
┏ ━ ┓ ┃ ┗ ┛
```

These are Unicode (U+250F, U+2501, U+2503, U+2517, U+251B). On non-UTF-8 terminals (e.g. legacy Windows CMD, CP437) they may render as replacement chars or mojibake.

### 5.2 Emoji Usage

- `🚀` (line 159)
- `⚠️` (lines 239, 255)
- `📁` (line 384)
- `📄` (line 384)

Emoji rendering is unreliable on some Windows consoles and minimal terminals.

### 5.3 Chalk and Gradient-String

- Chalk 5.x uses ANSI escape codes; generally safe on POSIX and Windows 10+.
- `gradient.atlas()` (line 140) uses richer color sequences; may not fall back on very limited terminals.

### 5.4 Recommendations

- Add an ASCII fallback when `TERM` is minimal or when UTF-8 is not detected.
- Provide a `--no-unicode` or `--plain` flag for CI/headless environments.
- Consider `process.env.CI` or `!process.stdout.isTTY` to auto-enable plain output.

---

## 6. Additional Critical Finding: `ignoredEntries` Logic

### 6.1 Bug in `scanner.ts`

```typescript
// Line 212
const ignoredEntries = totalEntries - filteredEntries.length;
```

When `--include` adds paths not in `allEntries`, `filteredEntries.length` can exceed `totalEntries`, so `ignoredEntries` becomes **negative**.

### 6.2 Mitigation in bin.ts

```typescript
// Line 341
const prunedCount = Math.max(ignoredEntries, 0);
```

This hides negatives but produces misleading “Pruned: 0” when the true pruned count is positive and extra files were force-included.

### 6.3 Correct Semantics

`ignoredEntries` should represent “entries pruned by ignore/exclude rules”:

```typescript
const ignoredEntries = allEntries.filter((rel) => ig.ignores(rel)).length;
```

This stays correct regardless of `includeGlobs`.

---

## Categorized Findings

### Critical

| ID | Finding | Location | Recommendation |
|----|---------|----------|----------------|
| C1 | `ignoredEntries` can be negative when `--include` adds files | `scanner.ts:212` | Use `allEntries.filter(rel => ig.ignores(rel)).length` |
| C2 | `redactSecrets` misses Anthropic/Claude (`sk-ant-`), Cursor (`key_`), GitHub (`ghp_`), etc. | `formatter.ts:82–93` | Add patterns for 2026-era API key formats |

### Warning

| ID | Finding | Location | Recommendation |
|----|---------|----------|----------------|
| W1 | No memory or I/O safeguards for 10k+ file repos | `scanner.ts` | Add configurable limits and/or streaming for large scans |
| W2 | Box-drawing and emoji may break on non-UTF-8 terminals | `bin.ts:363–371, 384` | Add `--plain` / ASCII fallback and TTY/CI detection |
| W3 | JWT-style pattern risks false positives on base64 in code | `formatter.ts:92` | Narrow scope or add allowlist for common non-secret patterns |
| W4 | No explicit timeout for `realpath` on exotic symlink setups | `scanner.ts:158` | Document behavior or add optional timeout wrapper |

### Optimization

| ID | Finding | Location | Recommendation |
|----|---------|----------|----------------|
| O1 | Redundant sort: scanner and formatter both sort files | `scanner.ts:203`, `formatter.ts:217` | Remove formatter sort if scanner contract guarantees order |
| O2 | Second glob pass when `includeGlobs` is used | `scanner.ts:123–129` | Consider merging include logic into single glob when feasible |
| O3 | `buildTree` and `aggregateDirectoryTokens` both walk path segments | `formatter.ts` | Acceptable; different outputs. No change required |
| O4 | Synchronous iteration over files (no concurrency control) | `scanner.ts:144–200` | Consider controlled parallelism (e.g. p-limit) for I/O |
| O5 | `gradient.atlas` may not degrade gracefully | `bin.ts:140` | Add fallback to `chalk.cyan` when gradient fails or on dumb terminals |

---

## Appendix: File Reference

| File | Purpose |
|------|---------|
| `src/lib/scanner.ts` | FS scan via fast-glob, symlink handling, binary/oversized filtering |
| `src/lib/formatter.ts` | Tree build, token stats, secret redaction, markdown/XML output |
| `src/bin.ts` | CLI, hog report, dashboard UI, persona handling |

---

*Report generated for Epistle v0.3.0. All line numbers refer to the audited source state.*
