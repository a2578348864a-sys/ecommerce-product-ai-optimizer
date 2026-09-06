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
async function extractNatural(blocks:AmazonSellerContentBlockV1[]):Promise<{candidates:AmazonFactCandidateV1[];status:"not_needed"|"completed"|"failed";message?:string}> { if(blocks.length===0) return {candidates:[],status:"not_needed"}; if(process.env.AMAZON_FACT_ENRICHMENT_AI_ENABLED!=="true") return {candidates:[],status:"failed",message:"自然语言内容整理暂时未启用，已保留确定性规格候选。"}; const config=getAiConfig(); if(!config.ok) return {candidates:[],status:"failed",message:`自然语言内容整理暂时失败（${config.error.code}），已保留确定性规格候选。`}; const source=blocks.map(b=>`[${b.sourceBlockId}] ${b.text}`).join("\n"); let failureCode="provider_unavailable"; try { const result=await callAiText({messages:[{role:"system",content:"Extract only explicit seller-authored product facts. Return strict JSON {candidates:[{field,value,sourceBlockId,evidenceText,qualifier,confidence}]}. Use only the 8 fields capacity,functional_feature,use_scenario,care,construction,operation,compatibility,other. EvidenceText must be copied exactly. No reviews, competitors, recommendations, or inferred claims."},{role:"user",content:source}],temperature:0,thinkingMode:"disabled",maxTokens:1800,timeoutMs:AI_TIMEOUT_MS,responseFormat:{type:"json_object"}}); if(!result.ok){failureCode=result.error.code; throw new Error(result.error.code);} let parsed: unknown; try { parsed=JSON.parse(result.data); } catch { failureCode="json_parse_error"; throw new Error(failureCode); } const valid=validateAiExtraction(parsed,blocks); const mapped=valid.candidates.map((c,i)=>({id:`amazon-enrichment:ai:${i}`,taskId:"",asin:"",field:c.field,value:c.value,status:(c.qualifier==="direct"?"direct":"review") as any,sourceType:blocks.find(b=>b.sourceBlockId===c.sourceBlockId)?.section||"description",sources:[{sourceBlockId:c.sourceBlockId,sourceUrl:blocks.find(b=>b.sourceBlockId===c.sourceBlockId)?.sourceUrl||"",section:blocks.find(b=>b.sourceBlockId===c.sourceBlockId)?.section||"description",label:"Amazon seller content",text:c.evidenceText}],evidenceTexts:[c.evidenceText],approximate:c.qualifier==="approximate",negative:c.qualifier==="negative",conflict:false,conflictReason:null,reviewRequired:c.qualifier!=="direct"||c.field==="compatibility",createdAt:new Date().toISOString()})); return {candidates:mapped,status:"completed"}; } catch(error){ const detail=error instanceof Error?error.message:""; if(["numeric_mismatch","strong_claim_upgrade","capacity_unit_mismatch","invalid_schema","evidence_not_found_in_source"].includes(detail)) failureCode="invalid_parameters"; return {candidates:[],status:"failed",message:`自然语言内容整理暂时失败（${failureCode}），已保留确定性规格候选。`}; } }
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
export async function buildAmazonFactEnrichmentPreview(input:{taskId:string;asin:string;blocks:AmazonSellerContentBlockV1[];structured?:Record<string,string>;collectedAt?:string;expiresAt?:number}):Promise<AmazonFactEnrichmentPreviewV1>{ const blocks=normalizeSellerBlocks(input.blocks); const deterministic=mapSellerBlocksToCandidates({taskId:input.taskId,asin:input.asin,blocks,structured:input.structured},input.collectedAt); const natural=await extractNatural(blocks); const candidates=resolveCandidateConflicts([...deterministic,...natural.candidates.map(c=>({...c,taskId:input.taskId,asin:input.asin,id:`${c.id}:${input.taskId}`}))]); return {schema:"amazon-fact-enrichment.v1",taskId:input.taskId,asin:input.asin,collectedAt:input.collectedAt||new Date().toISOString(),candidates,sourceBlocks:blocks,naturalLanguageStatus:natural.status,naturalLanguageMessage:natural.message,expiresAt:input.expiresAt||Date.now()+15*60*1000}; }
