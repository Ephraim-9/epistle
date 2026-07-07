import fs from "node:fs/promises";
import path from "node:path";

/**
 * Epistle project configuration, loadable from epistle.config.json.
 * Every field is optional; CLI flags always win over config values.
 */
export interface EpistleConfig {
  /** JSON Schema reference for editor autocomplete; ignored at runtime */
  $schema?: string;
  output?: {
    file?: string;
    format?: string;
    lineNumbers?: boolean;
    copy?: boolean;
  };
  include?: string[];
  exclude?: string[];
  maxFileSizeKB?: number;
  persona?: string;
  lite?: boolean;
  task?: string;
  /** Strip comments from source files */
  removeComments?: boolean;
  /** Remove blank lines from file contents */
  removeEmptyLines?: boolean;
  /** Signature-only compression for supported languages */
  compress?: boolean;
  /** Drop lowest-priority files until output fits this many tokens */
  maxTokens?: number;
  /** File ordering: "path", "churn" (most-edited last), or "size" (largest last) */
  sort?: string;
  /** Append working-tree and staged git diffs to the output */
  includeDiffs?: boolean;
  /** Append recent commit history (true for 20 commits, or a number) */
  includeLogs?: boolean | number;
  /** Automatic secret redaction (default true) */
  redact?: boolean;
  /** Tokenizer encoding: "o200k_base" or "cl100k_base" */
  encoding?: string;
  /** Named presets; select one with --profile. Profile values override base config. */
  profiles?: Record<string, Omit<EpistleConfig, "profiles">>;
}

/** Merge a profile over a base config (profile wins; output is deep-merged). */
export function applyProfile(
  base: EpistleConfig,
  profileName: string,
): EpistleConfig {
  const profile = base.profiles?.[profileName];
  if (!profile) {
    const available = Object.keys(base.profiles ?? {});
    throw new Error(
      `Unknown profile "${profileName}".` +
        (available.length > 0
          ? ` Available profiles: ${available.join(", ")}`
          : " No profiles are defined in the config file."),
    );
  }
  return {
    ...base,
    ...profile,
    output: { ...base.output, ...profile.output },
    include: profile.include ?? base.include,
    exclude: profile.exclude ?? base.exclude,
  };
}

export const CONFIG_FILE_NAME = "epistle.config.json";

/** Published copy of the schema bundled with the npm package. */
export const SCHEMA_URL = "https://unpkg.com/epistle/epistle.schema.json";

export const DEFAULT_CONFIG_TEMPLATE: EpistleConfig = {
  $schema: SCHEMA_URL,
  output: {
    file: "epistle-context.md",
    format: "markdown",
    lineNumbers: false,
    copy: false,
  },
  include: [],
  exclude: [],
  maxFileSizeKB: 100,
  lite: false,
  profiles: {
    tiny: {
      compress: true,
      removeComments: true,
      removeEmptyLines: true,
    },
    "pr-review": {
      includeDiffs: true,
      includeLogs: 10,
      sort: "churn",
    },
  },
};

// ---------------------------------------------------------------------------
// Load-time validation (mirrors epistle.schema.json; keep the two in sync)
// ---------------------------------------------------------------------------

const OUTPUT_KEYS = ["file", "format", "lineNumbers", "copy"] as const;
const FORMAT_VALUES = ["markdown", "xml", "plain", "json"];
const SORT_VALUES = ["path", "churn", "size"];
const PERSONA_VALUES = ["architect", "security", "refactor", "arch", "sec", "ref"];
const ENCODING_VALUES = ["o200k_base", "cl100k_base"];

const BASE_KEYS = [
  "$schema",
  "output",
  "include",
  "exclude",
  "maxFileSizeKB",
  "persona",
  "lite",
  "task",
  "removeComments",
  "removeEmptyLines",
  "compress",
  "maxTokens",
  "sort",
  "includeDiffs",
  "includeLogs",
  "redact",
  "encoding",
  "profiles",
] as const;

function suggestKey(key: string, validKeys: readonly string[]): string {
  const lower = key.toLowerCase();
  const match = validKeys.find(
    (k) => k.toLowerCase() === lower || k.toLowerCase().startsWith(lower.slice(0, 4)),
  );
  return match ? ` (did you mean "${match}"?)` : "";
}

function checkEnum(
  errors: string[],
  where: string,
  value: unknown,
  allowed: string[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(
      `${where}: must be one of ${allowed.map((v) => `"${v}"`).join(", ")} (got ${JSON.stringify(value)})`,
    );
  }
}

function checkType(
  errors: string[],
  where: string,
  value: unknown,
  expected: "string" | "boolean",
): void {
  if (typeof value !== expected) {
    errors.push(`${where}: must be a ${expected} (got ${JSON.stringify(value)})`);
  }
}

function checkPositiveNumber(
  errors: string[],
  where: string,
  value: unknown,
): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(`${where}: must be a positive number (got ${JSON.stringify(value)})`);
  }
}

function checkStringArray(
  errors: string[],
  where: string,
  value: unknown,
): void {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    errors.push(`${where}: must be an array of strings (got ${JSON.stringify(value)})`);
  }
}

function validateOutput(
  errors: string[],
  prefix: string,
  value: unknown,
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${prefix}: must be an object (got ${JSON.stringify(value)})`);
    return;
  }
  const output = value as Record<string, unknown>;
  for (const key of Object.keys(output)) {
    if (!(OUTPUT_KEYS as readonly string[]).includes(key)) {
      errors.push(
        `${prefix}.${key}: unknown key${suggestKey(key, OUTPUT_KEYS)}. Valid keys: ${OUTPUT_KEYS.join(", ")}`,
      );
    }
  }
  if (output.file !== undefined) checkType(errors, `${prefix}.file`, output.file, "string");
  if (output.format !== undefined) checkEnum(errors, `${prefix}.format`, output.format, FORMAT_VALUES);
  if (output.lineNumbers !== undefined) checkType(errors, `${prefix}.lineNumbers`, output.lineNumbers, "boolean");
  if (output.copy !== undefined) checkType(errors, `${prefix}.copy`, output.copy, "boolean");
}

function validateSection(
  errors: string[],
  prefix: string,
  section: Record<string, unknown>,
  allowProfiles: boolean,
): void {
  const validKeys = allowProfiles
    ? BASE_KEYS
    : BASE_KEYS.filter((k) => k !== "profiles" && k !== "$schema");
  for (const key of Object.keys(section)) {
    if (!(validKeys as readonly string[]).includes(key)) {
      errors.push(
        `${prefix}${key}: unknown key${suggestKey(key, validKeys)}. Valid keys: ${validKeys.join(", ")}`,
      );
    }
  }

  const v = section;
  if (v.output !== undefined) validateOutput(errors, `${prefix}output`, v.output);
  if (v.include !== undefined) checkStringArray(errors, `${prefix}include`, v.include);
  if (v.exclude !== undefined) checkStringArray(errors, `${prefix}exclude`, v.exclude);
  if (v.maxFileSizeKB !== undefined) checkPositiveNumber(errors, `${prefix}maxFileSizeKB`, v.maxFileSizeKB);
  if (v.persona !== undefined) checkEnum(errors, `${prefix}persona`, v.persona, PERSONA_VALUES);
  if (v.lite !== undefined) checkType(errors, `${prefix}lite`, v.lite, "boolean");
  if (v.task !== undefined) checkType(errors, `${prefix}task`, v.task, "string");
  if (v.removeComments !== undefined) checkType(errors, `${prefix}removeComments`, v.removeComments, "boolean");
  if (v.removeEmptyLines !== undefined) checkType(errors, `${prefix}removeEmptyLines`, v.removeEmptyLines, "boolean");
  if (v.compress !== undefined) checkType(errors, `${prefix}compress`, v.compress, "boolean");
  if (v.maxTokens !== undefined) checkPositiveNumber(errors, `${prefix}maxTokens`, v.maxTokens);
  if (v.sort !== undefined) checkEnum(errors, `${prefix}sort`, v.sort, SORT_VALUES);
  if (v.includeDiffs !== undefined) checkType(errors, `${prefix}includeDiffs`, v.includeDiffs, "boolean");
  if (v.includeLogs !== undefined && typeof v.includeLogs !== "boolean") {
    if (typeof v.includeLogs !== "number" || !Number.isFinite(v.includeLogs) || v.includeLogs <= 0) {
      errors.push(
        `${prefix}includeLogs: must be a boolean or a positive commit count (got ${JSON.stringify(v.includeLogs)})`,
      );
    }
  }
  if (v.redact !== undefined) checkType(errors, `${prefix}redact`, v.redact, "boolean");
  if (v.encoding !== undefined) checkEnum(errors, `${prefix}encoding`, v.encoding, ENCODING_VALUES);
}

/**
 * Validate a parsed config object. Returns a list of field-level problems;
 * empty means the config is valid.
 */
export function validateConfig(parsed: Record<string, unknown>): string[] {
  const errors: string[] = [];
  validateSection(errors, "", parsed, true);

  if (parsed.profiles !== undefined) {
    const profiles = parsed.profiles;
    if (profiles === null || typeof profiles !== "object" || Array.isArray(profiles)) {
      errors.push(`profiles: must be an object of named presets (got ${JSON.stringify(profiles)})`);
    } else {
      for (const [name, profile] of Object.entries(profiles as Record<string, unknown>)) {
        if (profile === null || typeof profile !== "object" || Array.isArray(profile)) {
          errors.push(`profiles.${name}: must be an object (got ${JSON.stringify(profile)})`);
          continue;
        }
        validateSection(errors, `profiles.${name}.`, profile as Record<string, unknown>, false);
      }
    }
  }

  return errors;
}

export interface LoadConfigResult {
  config: EpistleConfig;
  /** Absolute path the config was loaded from, if any */
  configPath?: string;
}

/**
 * Load config from an explicit path or from epistle.config.json in rootDir.
 * A missing default config is fine (returns empty config); an explicit path
 * that cannot be read or parsed is an error.
 */
export async function loadConfig(
  rootDir: string,
  explicitPath?: string,
): Promise<LoadConfigResult> {
  const configPath = explicitPath
    ? path.resolve(rootDir, explicitPath)
    : path.join(rootDir, CONFIG_FILE_NAME);

  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch (err) {
    if (explicitPath) {
      throw new Error(
        `Cannot read config file "${explicitPath}": ${(err as Error).message}`,
      );
    }
    return { config: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Invalid JSON in config file "${configPath}": ${(err as Error).message}`,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Config file "${configPath}" must contain a JSON object at the top level.`,
    );
  }

  const problems = validateConfig(parsed as Record<string, unknown>);
  if (problems.length > 0) {
    throw new Error(
      `Invalid config in "${configPath}":\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
  }

  return { config: parsed as EpistleConfig, configPath };
}

/** Write a starter config file; refuses to overwrite an existing one. */
export async function initConfig(rootDir: string): Promise<string> {
  const configPath = path.join(rootDir, CONFIG_FILE_NAME);
  try {
    await fs.access(configPath);
    throw new Error(
      `${CONFIG_FILE_NAME} already exists. Delete it first if you want a fresh one.`,
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  const body = JSON.stringify(DEFAULT_CONFIG_TEMPLATE, null, 2) + "\n";
  await fs.writeFile(configPath, body, { encoding: "utf8", flag: "wx" });
  return configPath;
}
