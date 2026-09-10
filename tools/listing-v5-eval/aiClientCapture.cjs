/**
 * Evaluation-only stand-in for `@/lib/server/aiClient`.
 *
 * Purpose: make one real Provider answer *forensically reproducible* without
 * spending a second Provider call, and keep secret material out of the
 * artifact.
 *
 * Two modes, selected by the harness through the environment:
 *   LISTING_V5_CAPTURE_FILE -> wrap the real client, record the parsed payload
 *                              returned to the pipeline, after a secret scan.
 *                              The wrapped result is returned unchanged, so
 *                              production behaviour is identical.
 *   LISTING_V5_REPLAY_FILE  -> never touch the Provider at all: answer from the
 *                              frozen artifact. `callAiText` throws, so a
 *                              replay can never silently reach the network.
 *
 * `callAiJson` is delegated to the real client verbatim: this file adds
 * observation only and never re-implements the Provider/parse path.
 *
 * The real client is required by absolute path (LISTING_V5_REAL_AI_CLIENT) so
 * that this file can replace it without changing production imports.
 */
"use strict";

const fs = require("node:fs");

const REAL_CLIENT = process.env.LISTING_V5_REAL_AI_CLIENT || "";
if (!REAL_CLIENT) throw new Error("aiClientCapture: LISTING_V5_REAL_AI_CLIENT is required");
const real = require(REAL_CLIENT);

const CAPTURE_FILE = process.env.LISTING_V5_CAPTURE_FILE || "";
const REPLAY_FILE = process.env.LISTING_V5_REPLAY_FILE || "";
const CASE_KEY = process.env.LISTING_V5_CASE || "";
/** Hard stop for evaluation modes that must provably spend zero Provider calls. */
const FORBID_PROVIDER = process.env.LISTING_V5_FORBID_PROVIDER === "1";

const SECRET_ENV_KEYS = ["AI_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY", "AI_AUTH_TOKEN"];
const SECRET_PATTERNS = [
  { name: "openai_style_key", pattern: /sk-[A-Za-z0-9_-]{8,}/ },
  { name: "bearer_header", pattern: /\bbearer\s+[A-Za-z0-9._-]{8,}/i },
  { name: "auth_header", pattern: /\bauthorization\b\s*[:=]\s*\S{6,}/i },
  { name: "api_key_assignment", pattern: /\b(api[_-]?key|apikey|access[_-]?token|secret[_-]?key)\b\s*[:=]\s*\S{6,}/i },
  { name: "cookie_assignment", pattern: /\b(set-cookie|cookie)\b\s*[:=]\s*\S{6,}/i },
];

/** Returns the names of every secret signal found; never returns secret text. */
function scanForSecrets(text) {
  const hits = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) hits.push(name);
  }
  for (const key of SECRET_ENV_KEYS) {
    const value = (process.env[key] || "").trim();
    if (value.length >= 8 && text.includes(value)) hits.push(`env:${key}`);
  }
  return hits;
}

function writeArtifact(record) {
  if (!CAPTURE_FILE) return;
  try {
    fs.writeFileSync(CAPTURE_FILE, JSON.stringify(record, null, 2), "utf8");
    process.stderr.write(`[capture] artifact written: ${CAPTURE_FILE}\n`);
  } catch (error) {
    process.stderr.write(`[capture] artifact write failed: ${error && error.message ? error.message : String(error)}\n`);
  }
}

function capture(providerResult) {
  if (!CAPTURE_FILE) return;
  const diagnostics = providerResult && providerResult.diagnostics ? providerResult.diagnostics : null;
  const payload = providerResult && providerResult.ok === true ? providerResult.data : null;
  const payloadJson = payload === null ? "" : JSON.stringify(payload, null, 2);
  const base = {
    artifact: "listing-v5-repair-frozen-response.v1",
    capturedAt: new Date().toISOString(),
    case: CASE_KEY,
    providerCallStarted: providerResult ? providerResult.providerCallStarted === true : false,
    providerOk: providerResult ? providerResult.ok === true : false,
    providerErrorCode: providerResult && providerResult.ok === false && providerResult.error ? providerResult.error.code : null,
    diagnostics,
    /** Raw provider text length as measured inside the client. */
    responseCharLength: diagnostics ? diagnostics.responseCharLength : null,
    replayNote: "The payload below is the parsed answer handed to the pipeline. Replaying it re-runs the real normalizer with zero Provider calls.",
  };

  // Never persist unverified content: scan first, write only on a clean scan.
  const hits = scanForSecrets(payloadJson);
  if (hits.length > 0) {
    writeArtifact({ ...base, secretScan: "FAIL", secretHits: hits, payloadWithheld: true, payload: null, payloadJson: null });
    process.stderr.write(`[capture] SECRET SCAN FAILED (${hits.join(",")}); payload withheld\n`);
    return;
  }
  writeArtifact({ ...base, secretScan: "PASS", secretHits: [], payloadWithheld: false, payloadJsonLength: payloadJson.length, payload, payloadJson });
}

let providerCallCount = 0;

async function callAiText(params) {
  if (FORBID_PROVIDER) {
    throw new Error("provider forbidden in this evaluation mode: a Provider call was attempted (callAiText)");
  }
  if (REPLAY_FILE) {
    throw new Error("replay mode: Provider calls are forbidden (callAiText)");
  }
  providerCallCount += 1;
  process.stderr.write(`[capture] real provider call #${providerCallCount}\n`);
  return real.callAiText(params);
}

async function callAiJson(params) {
  if (FORBID_PROVIDER) {
    throw new Error("provider forbidden in this evaluation mode: a Provider call was attempted (callAiJson)");
  }
  if (REPLAY_FILE) {
    const frozen = JSON.parse(fs.readFileSync(REPLAY_FILE, "utf8"));
    const diagnostics = frozen && frozen.diagnostics ? frozen.diagnostics : null;
    return {
      ok: true,
      data: frozen.payload,
      providerCallStarted: false,
      diagnostics: diagnostics
        ? { ...diagnostics, providerHttpStatusClass: "not_started", elapsedMs: 0 }
        : undefined,
    };
  }
  providerCallCount += 1;
  process.stderr.write(`[capture] real provider call #${providerCallCount}\n`);
  const result = await real.callAiJson(params);
  capture(result);
  return result;
}

module.exports = {
  ...real,
  callAiText,
  callAiJson,
  __listingV5CaptureMode: REPLAY_FILE ? "replay" : CAPTURE_FILE ? "capture" : "passthrough",
  __listingV5ProviderCallCount: () => providerCallCount,
};
