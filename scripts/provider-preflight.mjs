import { createHash } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const PROVIDER_MODES = new Set(["mock", "real"]);
const AI_PROVIDERS = new Set(["deepseek", "openai"]);
const SECRET_FIELDS = ["DEEPSEEK_API_KEY", "OPENAI_API_KEY"];

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function secretSummary(value) {
  const normalized = text(value);
  return {
    present: normalized.length > 0,
    length: normalized.length,
    fingerprint: normalized
      ? createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 12)
      : null,
  };
}

function defaultStorageCheck(rawPath) {
  try {
    const absolutePath = resolve(rawPath);
    const stat = statSync(absolutePath);
    if (!stat.isDirectory()) return { ok: false, reason: "not_directory" };
    accessSync(absolutePath, constants.R_OK | constants.W_OK);
    return { ok: true };
  } catch {
    return { ok: false, reason: "not_readable_writable" };
  }
}

function validHttpsUrl(value, env) {
  try {
    const url = new URL(value);
    const configuredHosts = text(env?.OPENAI_IMAGE_BASE_HOSTS);
    const allowedHosts = new Set((configuredHosts || "api.65535.space")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean));
    return url.protocol === "https:"
      && allowedHosts.has(url.hostname.toLowerCase())
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function addRequired(issues, env, field, secret = false) {
  if (!text(env[field])) {
    issues.push({ code: secret ? "missing_secret" : "missing_config", field });
    return false;
  }
  return true;
}

export function validateProviderConfig(env, options = {}) {
  const issues = [];
  const aiProvider = text(env.AI_PROVIDER);
  if (!aiProvider) issues.push({ code: "missing_config", field: "AI_PROVIDER" });
  else if (!AI_PROVIDERS.has(aiProvider)) issues.push({ code: "invalid_config", field: "AI_PROVIDER" });

  if (aiProvider === "deepseek") addRequired(issues, env, "DEEPSEEK_API_KEY", true);
  if (aiProvider === "openai") addRequired(issues, env, "OPENAI_API_KEY", true);

  for (const field of ["LISTING_PROVIDER_MODE", "IMAGE_PROVIDER_MODE"]) {
    const mode = text(env[field]);
    if (!mode) issues.push({ code: "missing_config", field });
    else if (!PROVIDER_MODES.has(mode)) issues.push({ code: "invalid_config", field });
  }

  if (text(env.LISTING_PROVIDER_MODE) === "real" && text(env.OPENAI_LISTING_ENABLED).toLowerCase() !== "true") {
    issues.push({ code: "disabled_gate", field: "OPENAI_LISTING_ENABLED" });
  }

  if (text(env.IMAGE_PROVIDER_MODE) === "real" && text(env.OPENAI_IMAGE_GENERATION_ENABLED).toLowerCase() !== "true") {
    issues.push({ code: "disabled_gate", field: "OPENAI_IMAGE_GENERATION_ENABLED" });
  }

  if (text(env.IMAGE_PROVIDER_MODE) === "real") {
    addRequired(issues, env, "OPENAI_API_KEY", true);
    const hasBaseUrl = addRequired(issues, env, "OPENAI_IMAGE_BASE_URL");
    if (hasBaseUrl && !validHttpsUrl(text(env.OPENAI_IMAGE_BASE_URL), env)) {
      issues.push({ code: "invalid_config", field: "OPENAI_IMAGE_BASE_URL" });
    }
    addRequired(issues, env, "OPENAI_IMAGE_MODEL");
    addRequired(issues, env, "OPENAI_IMAGE_RESULT_HOSTS");
  }

  const storageRoot = text(env.AI_IMAGE_DRAFT_STORAGE_ROOT);
  let storageAccessible = false;
  if (!storageRoot) {
    issues.push({ code: "missing_config", field: "AI_IMAGE_DRAFT_STORAGE_ROOT" });
  } else {
    const checkStorage = options.checkStorage || defaultStorageCheck;
    const storage = checkStorage(storageRoot);
    storageAccessible = storage?.ok === true;
    if (!storageAccessible) {
      issues.push({ code: "storage_not_readable_writable", field: "AI_IMAGE_DRAFT_STORAGE_ROOT" });
    }
  }

  const secrets = Object.fromEntries(SECRET_FIELDS.map((field) => [field, secretSummary(env[field])]));
  return {
    ok: issues.length === 0,
    issues,
    summary: {
      aiProvider: { present: aiProvider.length > 0, valid: AI_PROVIDERS.has(aiProvider) },
      researchProviderConfigured: (aiProvider === "deepseek" && text(env.DEEPSEEK_API_KEY).length > 0)
        || (aiProvider === "openai" && text(env.OPENAI_API_KEY).length > 0),
      listingProviderMode: {
        present: text(env.LISTING_PROVIDER_MODE).length > 0,
        valid: PROVIDER_MODES.has(text(env.LISTING_PROVIDER_MODE)),
        value: text(env.LISTING_PROVIDER_MODE),
      },
      imageProviderMode: {
        present: text(env.IMAGE_PROVIDER_MODE).length > 0,
        valid: PROVIDER_MODES.has(text(env.IMAGE_PROVIDER_MODE)),
        value: text(env.IMAGE_PROVIDER_MODE),
      },
      imageBaseUrl: {
        present: text(env.OPENAI_IMAGE_BASE_URL).length > 0,
        valid: validHttpsUrl(text(env.OPENAI_IMAGE_BASE_URL), env),
      },
      imageModelPresent: text(env.OPENAI_IMAGE_MODEL).length > 0,
      imageResultHostsPresent: text(env.OPENAI_IMAGE_RESULT_HOSTS).length > 0,
      listingGateEnabled: text(env.OPENAI_LISTING_ENABLED).toLowerCase() === "true",
      imageGateEnabled: text(env.OPENAI_IMAGE_GENERATION_ENABLED).toLowerCase() === "true",
      storage: { present: storageRoot.length > 0, readableWritable: storageAccessible },
      secrets,
    },
  };
}

export function formatProviderPreflightSummary(result, options = {}) {
  const summary = result?.summary ?? {};
  const researchConfigured = summary.aiProvider?.valid === true
    && summary.researchProviderConfigured === true;
  const listingMode = summary.listingProviderMode?.present
    ? text(options.listingProviderMode || summary.listingProviderMode?.value)
    : "missing";
  const imageMode = summary.imageProviderMode?.present
    ? text(options.imageProviderMode || summary.imageProviderMode?.value)
    : "missing";
  const listingConfigured = summary.listingProviderMode?.valid === true
    && (listingMode !== "real" || summary.listingGateEnabled === true)
    && researchConfigured;
  const imageConfigured = summary.imageProviderMode?.valid === true
    && (imageMode !== "real" || summary.imageGateEnabled === true)
    && (imageMode !== "real" || summary.secrets?.OPENAI_API_KEY?.present === true)
    && (imageMode !== "real" || summary.imageBaseUrl?.valid === true)
    && summary.imageModelPresent === true
    && summary.imageResultHostsPresent === true
    && summary.storage?.readableWritable === true;

  return [
    `RESEARCH_PROVIDER: ${researchConfigured ? "configured" : "missing"}`,
    `LISTING_PROVIDER: ${listingConfigured ? "configured" : "missing"} mode=${listingMode || "missing"}`,
    `IMAGE_PROVIDER: ${imageConfigured ? "configured" : "missing"} mode=${imageMode || "missing"}`,
    `IMAGE_BASE_HOST: ${summary.imageBaseUrl?.valid === true ? "allowed" : "rejected"}`,
    `PM2_RUNTIME: ${options.runtimeConfigLoaded === true ? "config_loaded" : "mismatch"}`,
  ].join("\n");
}

export function runProviderPreflight() {
  nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const result = validateProviderConfig(process.env);
  process.stdout.write(`${formatProviderPreflightSummary(result, {
    runtimeConfigLoaded: true,
    listingProviderMode: process.env.LISTING_PROVIDER_MODE,
    imageProviderMode: process.env.IMAGE_PROVIDER_MODE,
  })}\n`);
  return result.ok ? 0 : 1;
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
  process.exitCode = runProviderPreflight();
}
