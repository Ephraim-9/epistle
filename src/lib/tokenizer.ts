/**
 * Token counting backed by gpt-tokenizer (pure JS, no wasm).
 * Encodings are loaded lazily and cached, so repeated formatting passes
 * (e.g. the --max-tokens re-format) never pay the rank-parsing cost twice.
 */

export const TOKEN_ENCODINGS = ["o200k_base", "cl100k_base"] as const;
export type TokenEncoding = (typeof TOKEN_ENCODINGS)[number];

/** Counts tokens in a string without materializing the token array. */
export type TokenCounter = (text: string) => number;

const counters = new Map<TokenEncoding, TokenCounter>();

export async function getTokenCounter(
  encoding: TokenEncoding = "o200k_base",
): Promise<TokenCounter> {
  const cached = counters.get(encoding);
  if (cached) return cached;

  const mod =
    encoding === "cl100k_base"
      ? await import("gpt-tokenizer/encoding/cl100k_base")
      : await import("gpt-tokenizer/encoding/o200k_base");

  const counter: TokenCounter = (text) => mod.countTokens(text);
  counters.set(encoding, counter);
  return counter;
}
