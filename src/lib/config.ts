import fs from "node:fs/promises";
import path from "node:path";

/**
 * Epistle project configuration, loadable from epistle.config.json.
 * Every field is optional; CLI flags always win over config values.
 */
export interface EpistleConfig {
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

export const DEFAULT_CONFIG_TEMPLATE: EpistleConfig = {
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
};

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
