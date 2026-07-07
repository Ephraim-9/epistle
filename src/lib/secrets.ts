/**
 * Secret detection and redaction.
 *
 * Patterns target well-known credential shapes (provider-prefixed tokens)
 * plus one conservative assignment heuristic. We deliberately avoid generic
 * long-token patterns so SHA/SRI hashes and IDs don't trigger false
 * positives.
 */

interface SecretPattern {
  name: string;
  re: RegExp;
  /** Optional replacer; defaults to full-match replacement */
  replace?: (match: string, ...groups: string[]) => string;
}

const REDACTED = "[REDACTED_SECRET]";

function patterns(): SecretPattern[] {
  return [
    // OpenAI / Anthropic style (sk-, sk-ant-, sk-proj-)
    { name: "openai-style-key", re: /sk-[A-Za-z0-9_-]{16,}/g },
    // AWS access key IDs
    { name: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    // Google API keys
    { name: "google-api-key", re: /AIza[0-9A-Za-z\-_]{20,}/g },
    // GitHub tokens (classic + fine-grained)
    {
      name: "github-token",
      re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
    },
    // GitLab personal access tokens
    { name: "gitlab-token", re: /\bglpat-[A-Za-z0-9\-_]{20,}\b/g },
    // Slack tokens
    { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
    // Stripe live/restricted keys
    { name: "stripe-key", re: /\b[rs]k_live_[A-Za-z0-9]{16,}\b/g },
    // npm automation tokens
    { name: "npm-token", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
    // Hugging Face
    { name: "huggingface-token", re: /\bhf_[A-Za-z0-9]{30,}\b/g },
    // SendGrid
    { name: "sendgrid-key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g },
    // Twilio API key SID-paired secrets
    { name: "twilio-key", re: /\bSK[0-9a-fA-F]{32}\b/g },
    // JWT-like triplets
    {
      name: "jwt",
      re: /\b[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}\b/g,
    },
    // PEM private key blocks (entire block collapsed)
    {
      name: "private-key-block",
      re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    },
    // Conservative assignment heuristic: apiKey = "longvalue"
    {
      name: "credential-assignment",
      re: /\b((?:api[_-]?key|api[_-]?secret|auth[_-]?token|access[_-]?token|client[_-]?secret|password|passwd)\s*[:=]\s*)(["'])(?!\$\{)[^"'\s]{8,}\2/gi,
      replace: (_m, prefix: string, quote: string) =>
        `${prefix}${quote}${REDACTED}${quote}`,
    },
  ];
}

export interface RedactResult {
  redacted: string;
  count: number;
  /** Pattern names that fired, for reporting */
  kinds: string[];
}

export function redactSecrets(text: string): RedactResult {
  let result = text;
  let count = 0;
  const kinds = new Set<string>();

  for (const { name, re, replace } of patterns()) {
    const reCopy = new RegExp(re.source, re.flags);
    result = result.replace(reCopy, (...args) => {
      count++;
      kinds.add(name);
      if (replace) {
        return replace(args[0] as string, ...(args.slice(1) as string[]));
      }
      return REDACTED;
    });
  }

  return { redacted: result, count, kinds: Array.from(kinds) };
}

/**
 * File names that likely hold credentials wholesale. These are excluded from
 * packs entirely (redaction alone is not sufficient for e.g. .env files).
 */
const SUSPICIOUS_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.[A-Za-z0-9._-]+)?$/,
  /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.netrc$/,
  /(^|\/)credentials(\.json)?$/i,
  /(^|\/)serviceaccount.*\.json$/i,
  /(^|\/)secrets?\.(json|ya?ml|toml)$/i,
];

export function isSuspiciousFile(relPath: string): boolean {
  return SUSPICIOUS_FILE_PATTERNS.some((re) => re.test(relPath));
}
