/**
 * Recipe library: curated analysis prompts appended to the pack as the
 * task section (codebase-digest popularized shipping prompts with the
 * packer; ours are task-shaped and composable with --task and --persona).
 */

export const RECIPES: Record<string, { title: string; prompt: string }> = {
  review: {
    title: "Code review",
    prompt: [
      "Perform a thorough code review of this codebase.",
      "1. Identify correctness bugs, race conditions, and unhandled edge cases (most severe first).",
      "2. Point out error-handling gaps and silent failure paths.",
      "3. Note API misuse or version-specific pitfalls in the dependencies you can see.",
      "For each finding: cite the file and line, explain the failure scenario concretely, and propose a minimal fix.",
      "If the codebase context seems incomplete for a finding, say so rather than guessing.",
    ].join("\n"),
  },
  test: {
    title: "Test generation",
    prompt: [
      "Design a test plan for this codebase, then write the highest-value tests.",
      "1. Map the critical paths and the riskiest untested logic.",
      "2. Write unit tests for pure logic and integration tests for I/O boundaries, using the project's existing test framework and conventions.",
      "3. Include edge cases: empty inputs, unicode, huge inputs, concurrent access where relevant.",
      "Prefer fewer, meaningful tests over exhaustive shallow ones.",
    ].join("\n"),
  },
  refactor: {
    title: "Refactoring plan",
    prompt: [
      "Propose a refactoring plan for this codebase.",
      "1. Identify duplication, dead code, and functions doing too much.",
      "2. Highlight coupling that makes the code hard to test or change.",
      "3. Propose a sequence of small, independently-shippable refactors ordered by value/risk ratio.",
      "Do not propose rewrites; every step must keep the test suite green.",
    ].join("\n"),
  },
  onboard: {
    title: "Onboarding tour",
    prompt: [
      "Give a new engineer an onboarding tour of this codebase.",
      "1. Explain what the project does and its architecture in plain language.",
      "2. Walk through the main entry points and the life of a typical request/invocation.",
      "3. Describe the key modules and how they collaborate.",
      "4. List the five files most worth reading first, with one sentence on why each matters.",
    ].join("\n"),
  },
  document: {
    title: "Documentation generation",
    prompt: [
      "Write documentation for this codebase.",
      "1. A concise README section: what it is, install, quickstart, common examples.",
      "2. Reference documentation for the public API surface only (skip internals).",
      "3. Flag any behavior you found surprising while reading — those need docs most.",
      "Match the documentation tone to the project's existing style.",
    ].join("\n"),
  },
  audit: {
    title: "Security audit",
    prompt: [
      "Perform a security audit of this codebase.",
      "1. Injection risks: SQL/command/path traversal, unsanitized inputs reaching dangerous sinks.",
      "2. Secrets handling, authentication and authorization gaps.",
      "3. Dependency risks visible from the manifests.",
      "4. Unsafe defaults (permissive CORS, debug endpoints, verbose errors).",
      "Rate each finding by severity and exploitability; include the vulnerable code path and a fix.",
    ].join("\n"),
  },
};

export function getRecipe(
  name: string,
): { title: string; prompt: string } | undefined {
  return RECIPES[name.toLowerCase()];
}

export function recipeNames(): string[] {
  return Object.keys(RECIPES);
}
