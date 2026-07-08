/**
 * Shell completion script generation for bash, zsh, and fish.
 *
 * Scripts are generated from the live commander option list, so they can
 * never drift from the real flag set. Value-taking flags with a fixed
 * vocabulary (--format, --sort, …) complete their values; --profile
 * completes dynamically by calling `epistle completion --list-profiles`,
 * which reads profile names from the user's epistle.config.json.
 */

export const COMPLETION_SHELLS = ["bash", "zsh", "fish"] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

export interface CompletionOption {
  /** Long flag including dashes, e.g. "--format" */
  long?: string;
  /** Short flag including dash, e.g. "-o" */
  short?: string;
  /** True when the flag accepts a value argument */
  takesValue: boolean;
  description: string;
}

/** Static value vocabularies per long flag. */
export interface CompletionValues {
  [longFlag: string]: string[];
}

/** Long flags whose values are looked up at completion time. */
const DYNAMIC_PROFILE_FLAG = "--profile";
/** Long flags whose argument is a file path. */
const FILE_VALUE_FLAGS = new Set(["--output", "--config"]);

const LIST_PROFILES_CMD = "epistle completion --list-profiles";

function sanitize(text: string): string {
  // Descriptions end up inside single- or double-quoted shell strings.
  return text.replace(/['"`\\\n]/g, " ").replace(/\s+/g, " ").trim();
}

function bashScript(
  options: CompletionOption[],
  values: CompletionValues,
): string {
  const allFlags = options
    .flatMap((o) => [o.long, o.short])
    .filter(Boolean)
    .join(" ");

  const valueCases: string[] = [];
  for (const opt of options) {
    if (!opt.long || !opt.takesValue) continue;
    const pattern = opt.short ? `${opt.long}|${opt.short}` : opt.long;
    if (values[opt.long]) {
      valueCases.push(
        `    ${pattern})\n      COMPREPLY=( $(compgen -W "${values[opt.long].join(" ")}" -- "$cur") )\n      return 0\n      ;;`,
      );
    } else if (opt.long === DYNAMIC_PROFILE_FLAG) {
      valueCases.push(
        `    ${pattern})\n      COMPREPLY=( $(compgen -W "$(${LIST_PROFILES_CMD} 2>/dev/null)" -- "$cur") )\n      return 0\n      ;;`,
      );
    } else if (FILE_VALUE_FLAGS.has(opt.long)) {
      valueCases.push(
        `    ${pattern})\n      COMPREPLY=( $(compgen -f -- "$cur") )\n      return 0\n      ;;`,
      );
    }
  }

  return `# bash completion for epistle
# Install: epistle completion bash > /etc/bash_completion.d/epistle
#      or: eval "$(epistle completion bash)" in ~/.bashrc
_epistle() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "$prev" in
${valueCases.join("\n")}
  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "${allFlags}" -- "$cur") )
    return 0
  fi

  COMPREPLY=( $(compgen -f -- "$cur") )
}
complete -o filenames -F _epistle epistle
`;
}

function zshScript(
  options: CompletionOption[],
  values: CompletionValues,
): string {
  const specs: string[] = [];
  for (const opt of options) {
    const desc = sanitize(opt.description);
    let action = "";
    if (opt.takesValue) {
      if (opt.long && values[opt.long]) {
        action = `:value:(${values[opt.long].join(" ")})`;
      } else if (opt.long === DYNAMIC_PROFILE_FLAG) {
        action = `:profile:($(${LIST_PROFILES_CMD} 2>/dev/null))`;
      } else if (opt.long && FILE_VALUE_FLAGS.has(opt.long)) {
        action = ":file:_files";
      } else {
        action = ":value:";
      }
    }
    if (opt.long) specs.push(`    '${opt.long}[${desc}]${action}'`);
    if (opt.short) specs.push(`    '${opt.short}[${desc}]${action}'`);
  }

  return `#compdef epistle
# zsh completion for epistle
# Install: epistle completion zsh > "\${fpath[1]}/_epistle"
#      or: eval "$(epistle completion zsh)" in ~/.zshrc
_epistle() {
  _arguments -s \\
${specs.join(" \\\n")} \\
    '*:file:_files'
}
if [ "$funcstack[1]" = "_epistle" ]; then
  _epistle "$@"
else
  compdef _epistle epistle
fi
`;
}

function fishScript(
  options: CompletionOption[],
  values: CompletionValues,
): string {
  const lines: string[] = [
    "# fish completion for epistle",
    "# Install: epistle completion fish > ~/.config/fish/completions/epistle.fish",
  ];
  for (const opt of options) {
    const parts = ["complete -c epistle"];
    if (opt.short) parts.push(`-s ${opt.short.replace(/^-/, "")}`);
    if (opt.long) parts.push(`-l ${opt.long.replace(/^--/, "")}`);
    if (opt.takesValue) {
      if (opt.long && values[opt.long]) {
        parts.push(`-x -a "${values[opt.long].join(" ")}"`);
      } else if (opt.long === DYNAMIC_PROFILE_FLAG) {
        parts.push(`-x -a "(${LIST_PROFILES_CMD} 2>/dev/null)"`);
      } else if (opt.long && FILE_VALUE_FLAGS.has(opt.long)) {
        parts.push("-r -F");
      } else {
        parts.push("-x");
      }
    }
    parts.push(`-d "${sanitize(opt.description)}"`);
    lines.push(parts.join(" "));
  }
  lines.push("");
  return lines.join("\n");
}

export function generateCompletionScript(
  shell: CompletionShell,
  options: CompletionOption[],
  values: CompletionValues,
): string {
  switch (shell) {
    case "bash":
      return bashScript(options, values);
    case "zsh":
      return zshScript(options, values);
    case "fish":
      return fishScript(options, values);
  }
}
