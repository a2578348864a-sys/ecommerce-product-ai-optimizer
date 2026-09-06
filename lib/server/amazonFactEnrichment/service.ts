import { callAiText, getAiConfig } from "@/lib/server/aiClient";
import { AMAZON_FACT_FIELDS } from "./contract";
import type { AmazonFactCandidateV1, AmazonFactEnrichmentPreviewV1, AmazonSellerContentBlockV1, AmazonUnstructuredFactExtractionV1 } from "./contract";
import { isWeightLike, mapSellerBlocksToCandidates, normalizeSellerBlocks } from "./mapping";
const AI_TIMEOUT_MS=30000;
export function validateAiExtraction(raw: unknown, blocks: AmazonSellerContentBlockV1[]): AmazonUnstructuredFactExtractionV1 {
 const allowedIds=new Set(blocks.map(b=>b.sourceBlockId));
 if(!raw || typeof raw!=="object" || Object.keys(raw as object).some(k=>k!=="candidates") || !Array.isArray((raw as any).candidates)) throw new Error("invalid_schema");
 const out=[]; const allowedKeys=new Set(["field","value","sourceBlockId","evidenceText","qualifier","confidence"]);
 for(const c of (raw as any).candidates){
  if(!c || typeof c!=="object" || Object.keys(c).some(k=>!allowedKeys.has(k)) || typeof c.field!=="string" || typeof c.value!=="string" || typeof c.sourceBlockId!=="string" || typeof c.evidenceText!=="string" || !["direct","approximate","negative","conditional"].includes(c.qualifier) || !["high","medium"].includes(c.confidence)) throw new Error("invalid_schema");
  if(!AMAZON_FACT_FIELDS.includes(c.field) || !allowedIds.has(c.sourceBlockId)) throw new Error("invalid_schema");
  const block=blocks.find(b=>b.sourceBlockId===c.sourceBlockId)!; const evidence=c.evidenceText.trim(); const value=c.value.trim();
  if(!value || !evidence || !block.text.includes(evidence)) throw new Error("evidence_not_found_in_source");
  const nums=(v:string)=>[...v.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(m=>m[0]); const sourceNums=nums(evidence); const valueNums=nums(value);
  if(valueNums.some(n=>!sourceNums.includes(n))) throw new Error("numeric_mismatch");
  if(c.field==="capacity" && isWeightLike(value)) throw new Error("capacity_unit_mismatch");
  if(/\b(?:dishwasher[- ]?safe|waterproof|rustproof|stainless steel|never falls|guaranteed|100% leak[- ]?proof)\b/i.test(value) && !/\b(?:dishwasher[- ]?safe|waterproof|rustproof|stainless steel|never falls|guaranteed|100% leak[- ]?proof)\b/i.test(evidence)) throw new Error("strong_claim_upgrade");
  out.push({field:c.field,value,sourceBlockId:c.sourceBlockId,evidenceText:evidence,qualifier:c.qualifier,confidence:c.confidence});
 }
 return {candidates:out.slice(0,40)} as AmazonUnstructuredFactExtractionV1;
}

type NaturalLanguageResult = {
 status: "not_needed" | "completed" | "failed";
 candidates: AmazonFactCandidateV1[];
 message?: string;
 failureStage?: "provider" | "response_parse" | "schema" | "evidence";
 failureCode?:
   | "provider_invalid_parameters" | "provider_timeout" | "provider_network_error"
   | "provider_invalid_api_key" | "provider_insufficient_balance" | "provider_rate_limited"
   | "provider_missing_api_key" | "provider_missing_model" | "provider_missing_base_url"
   | "provider_unavailable" | "provider_error" | "provider_unknown_error"
   | "ai_empty_response" | "ai_json_parse_error" | "ai_invalid_schema"
   | "ai_evidence_not_found" | "ai_numeric_mismatch" | "ai_strong_claim_upgrade"
   | "ai_capacity_unit_mismatch";
 providerHttpStatusClass?: "not_started" | "success" | "client_error" | "rate_limited"
   | "server_error" | "timeout" | "network_error" | "unknown";
};

function providerFailureCode(code: string): NonNullable<NaturalLanguageResult["failureCode"]> {
 switch (code) {
  case "missing_api_key": return "provider_missing_api_key";
  case "missing_model": return "provider_missing_model";
  case "missing_base_url": return "provider_missing_base_url";
  case "invalid_parameters": return "provider_invalid_parameters";
  case "timeout": return "provider_timeout";
  case "network_error": return "provider_network_error";
  case "invalid_api_key": return "provider_invalid_api_key";
  case "insufficient_balance": return "provider_insufficient_balance";
  case "rate_limited": return "provider_rate_limited";
  case "provider_unavailable": return "provider_unavailable";
  case "provider_error": return "provider_error";
  default: return "provider_unknown_error";
 }
}

function validationFailure(detail: string): Pick<NaturalLanguageResult, "failureStage" | "failureCode"> {
 switch (detail) {
  case "evidence_not_found_in_source": return { failureStage: "evidence", failureCode: "ai_evidence_not_found" };
  case "numeric_mismatch": return { failureStage: "evidence", failureCode: "ai_numeric_mismatch" };
  case "strong_claim_upgrade": return { failureStage: "evidence", failureCode: "ai_strong_claim_upgrade" };
  case "capacity_unit_mismatch": return { failureStage: "evidence", failureCode: "ai_capacity_unit_mismatch" };
  case "invalid_schema": return { failureStage: "schema", failureCode: "ai_invalid_schema" };
  default: return { failureStage: "schema", failureCode: "ai_invalid_schema" };
 }
}

async function extractNatural(blocks: AmazonSellerContentBlockV1[]): Promise<NaturalLanguageResult> {
 if (blocks.length === 0) return { candidates: [], status: "not_needed" };
 if (process.env.AMAZON_FACT_ENRICHMENT_AI_ENABLED !== "true") {
  return { candidates: [], status: "failed", message: "自然语言内容整理暂时未启用，已保留确定性规格候选。" };
 }
 const config = getAiConfig();
 if (!config.ok) {
  return {
   candidates: [], status: "failed", failureStage: "provider", failureCode: providerFailureCode(config.error.code),
   message: "自然语言内容整理暂时失败，已保留确定性规格候选。",
  };
 }
 const source = blocks.map((block) => `[${block.sourceBlockId}] ${block.text}`).join("\n");
 const result = await callAiText({
  messages: [
   { role: "system", content: "Extract only explicit seller-authored product facts. Return strict JSON {candidates:[{field,value,sourceBlockId,evidenceText,qualifier,confidence}]}. Use only the 8 fields capacity,functional_feature,use_scenario,care,construction,operation,compatibility,other. EvidenceText must be copied exactly. No reviews, competitors, recommendations, or inferred claims." },
   { role: "user", content: source },
  ],
  temperature: 0,
  thinkingMode: "disabled",
  maxTokens: 1800,
  timeoutMs: AI_TIMEOUT_MS,
  responseFormat: { type: "json_object" },
 });
 if (!result.ok) {
  if (result.error.code === "empty_response") {
   return { candidates: [], status: "failed", failureStage: "response_parse", failureCode: "ai_empty_response", providerHttpStatusClass: result.diagnostics?.providerHttpStatusClass, message: "自然语言内容整理暂时失败，已保留确定性规格候选。" };
  }
  return { candidates: [], status: "failed", failureStage: "provider", failureCode: providerFailureCode(result.error.code), providerHttpStatusClass: result.diagnostics?.providerHttpStatusClass, message: "自然语言内容整理暂时失败，已保留确定性规格候选。" };
 }
 let parsed: unknown;
 try {
  parsed = JSON.parse(result.data);
 } catch {
  return { candidates: [], status: "failed", failureStage: "response_parse", failureCode: "ai_json_parse_error", providerHttpStatusClass: result.diagnostics?.providerHttpStatusClass, message: "自然语言内容整理暂时失败，已保留确定性规格候选。" };
 }
 let valid: AmazonUnstructuredFactExtractionV1;
 try {
  valid = validateAiExtraction(parsed, blocks);
 } catch (error) {
  const detail = error instanceof Error ? error.message : "invalid_schema";
  const failure = validationFailure(detail);
  return { candidates: [], status: "failed", ...failure, providerHttpStatusClass: result.diagnostics?.providerHttpStatusClass, message: "自然语言内容整理暂时失败，已保留确定性规格候选。" };
 }
 const candidates = valid.candidates.map((candidate, index) => {
  const block = blocks.find((item) => item.sourceBlockId === candidate.sourceBlockId);
  return {
   id: `amazon-enrichment:ai:${index}`,
   taskId: "",
   asin: "",
   field: candidate.field,
   value: candidate.value,
   status: (candidate.qualifier === "direct" ? "direct" : "review") as AmazonFactCandidateV1["status"],
   sourceType: block?.section || "description",
   sources: [{ sourceBlockId: candidate.sourceBlockId, sourceUrl: block?.sourceUrl || "", section: block?.section || "description", label: "Amazon seller content", text: candidate.evidenceText }],
   evidenceTexts: [candidate.evidenceText],
   approximate: candidate.qualifier === "approximate",
   negative: candidate.qualifier === "negative",
   conflict: false,
   conflictReason: null,
   reviewRequired: candidate.qualifier !== "direct" || candidate.field === "compatibility",
   createdAt: new Date().toISOString(),
  };
 });
 return { candidates, status: "completed", providerHttpStatusClass: result.diagnostics?.providerHttpStatusClass };
}

export function resolveCandidateConflicts(candidates: AmazonFactCandidateV1[]): AmazonFactCandidateV1[] {
 const rows: AmazonFactCandidateV1[] = [];
 const byValue = new Map<string, AmazonFactCandidateV1>();
 for (const candidate of candidates) {
  const key = `${candidate.field}:${candidate.value.trim().toLowerCase()}`;
  const existing = byValue.get(key);
  if (existing) {
   existing.sources.push(...candidate.sources);
   existing.evidenceTexts.push(...candidate.evidenceTexts);
   existing.reviewRequired = existing.reviewRequired || candidate.reviewRequired;
   continue;
  }
  const copy: AmazonFactCandidateV1 = { ...candidate, sources: [...candidate.sources], evidenceTexts: [...candidate.evidenceTexts] };
  byValue.set(key, copy);
  rows.push(copy);
 }
 const byField = new Map<string, AmazonFactCandidateV1[]>();
 for (const candidate of rows) {
  const group = byField.get(candidate.field) ?? [];
  group.push(candidate);
  byField.set(candidate.field, group);
 }
 const multiValueFields = new Set(["functional_feature", "use_scenario", "care", "construction", "operation", "other"]);
 const hasPair = (group: AmazonFactCandidateV1[], positive: RegExp, negative: RegExp) => group.some((candidate) => positive.test(candidate.value)) && group.some((candidate) => negative.test(candidate.value));
 for (const [field, group] of byField) {
  if (field === "compatibility") {
   for (const candidate of group) { candidate.reviewRequired = true; if (candidate.status === "direct") candidate.status = "review"; }
   const target = (value: string) => value.toLowerCase().replace(/\bnot\s+compatible\s+with\b|\bcompatible\s+with\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
   const positive = group.filter((candidate) => !candidate.negative);
   const negative = group.filter((candidate) => candidate.negative);
   if (positive.some((candidate) => negative.some((other) => target(candidate.value) === target(other.value)))) {
    for (const candidate of group) { candidate.conflict = true; candidate.status = "conflict"; candidate.reviewRequired = true; candidate.conflictReason = "positive_negative_same_target"; }
   }
   continue;
  }
  if (field === "capacity") {
   if (group.length > 1) for (const candidate of group) { candidate.status = "review"; candidate.reviewRequired = true; candidate.conflict = false; candidate.conflictReason = "multiple_capacity_values"; }
   continue;
  }
  if (!multiValueFields.has(field) || group.length < 2) continue;
  const contradictory = (field === "care" && hasPair(group, /dishwasher[- ]?safe/i, /hand\s+wash\s+only/i)) || (field === "operation" && hasPair(group, /assembly\s+required/i, /no\s+assembly/i));
  if (contradictory) for (const candidate of group) { candidate.conflict = true; candidate.status = "conflict"; candidate.reviewRequired = true; candidate.conflictReason = "explicit_mutually_exclusive_claims"; }
 }
 return rows;
}
export async function buildAmazonFactEnrichmentPreview(input: {
 taskId: string;
 asin: string;
 blocks: AmazonSellerContentBlockV1[];
 structured?: Record<string, string>;
 collectedAt?: string;
 expiresAt?: number;
}): Promise<AmazonFactEnrichmentPreviewV1> {
 const blocks = normalizeSellerBlocks(input.blocks);
 const deterministic = mapSellerBlocksToCandidates({ taskId: input.taskId, asin: input.asin, blocks, structured: input.structured }, input.collectedAt);
 const natural = await extractNatural(blocks);
 const candidates = resolveCandidateConflicts([
  ...deterministic,
  ...natural.candidates.map((candidate) => ({ ...candidate, taskId: input.taskId, asin: input.asin, id: `${candidate.id}:${input.taskId}` })),
 ]);
 return {
  schema: "amazon-fact-enrichment.v1",
  taskId: input.taskId,
  asin: input.asin,
  collectedAt: input.collectedAt || new Date().toISOString(),
  candidates,
  sourceBlocks: blocks,
  naturalLanguageStatus: natural.status,
  naturalLanguageMessage: natural.message,
  ...(natural.failureStage ? { naturalLanguageFailureStage: natural.failureStage } : {}),
  ...(natural.failureCode ? { naturalLanguageFailureCode: natural.failureCode } : {}),
  ...(natural.providerHttpStatusClass ? { naturalLanguageProviderHttpStatusClass: natural.providerHttpStatusClass } : {}),
  expiresAt: input.expiresAt || Date.now() + 15 * 60 * 1000,
 };
}
