import { test } from "node:test";
import assert from "node:assert/strict";
import { isSuspiciousFile, redactSecrets } from "../src/lib/secrets.js";

test("redacts provider-prefixed tokens", () => {
  const samples = [
    "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
    "xoxb-1234567890-abcdefghij",
    "sk_live_abcdefghijklmnop",
    "npm_" + "a".repeat(36),
    "hf_" + "a".repeat(30),
    "glpat-abcdefghij1234567890",
  ];
  for (const s of samples) {
    const { redacted, count } = redactSecrets(`token = ${s}`);
    assert.ok(count >= 1, `should redact: ${s}`);
    assert.ok(!redacted.includes(s), `should not contain: ${s}`);
  }
});

test("redacts PEM private key blocks entirely", () => {
  const pem =
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\nsecret\n-----END RSA PRIVATE KEY-----";
  const { redacted, count } = redactSecrets(pem);
  assert.equal(count, 1);
  assert.ok(!redacted.includes("MIIEow"));
});

test("credential assignment heuristic keeps the key name", () => {
  const src = 'const apiKey = "supersecretvalue123";';
  const { redacted, count } = redactSecrets(src);
  assert.equal(count, 1);
  assert.ok(redacted.includes("apiKey"));
  assert.ok(!redacted.includes("supersecretvalue123"));
});

test("does not redact SRI hashes or ordinary identifiers", () => {
  const src = [
    'integrity="sha256-abcdefghijklmnopqrstuvwxyz012345678901234567"',
    "const someVariableName = computeSomething();",
    "0123456789abcdef0123456789abcdef01234567", // plain hex
  ].join("\n");
  const { count } = redactSecrets(src);
  assert.equal(count, 0);
});

test("isSuspiciousFile flags credential files", () => {
  for (const p of [
    ".env",
    ".env.production",
    "config/.env.local",
    "keys/server.pem",
    ".ssh/id_rsa",
    "gcp/serviceaccount-prod.json",
    "secrets.yaml",
    ".npmrc",
  ]) {
    assert.equal(isSuspiciousFile(p), true, `should flag ${p}`);
  }
  for (const p of [
    "src/env.ts",
    "environment.md",
    "keymap.json",
    "src/secretsanta.ts",
  ]) {
    assert.equal(isSuspiciousFile(p), false, `should NOT flag ${p}`);
  }
});
