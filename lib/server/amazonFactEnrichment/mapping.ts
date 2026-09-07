import type { AmazonSellerContentBlockV1, AmazonFactSourceV1, AmazonFactCandidateV1, AmazonFactField, AmazonSellerContentSection } from "./contract";
import { AMAZON_FACT_FIELDS } from "./contract";
const LIMIT_BLOCKS=80, LIMIT_TEXT=1200;
export function normalizeSellerText(value: unknown, max=LIMIT_TEXT): string { return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max) : ""; }
export function normalizeSellerBlocks(blocks: Array<Partial<AmazonSellerContentBlockV1>>): AmazonSellerContentBlockV1[] {
 const seen=new Set<string>(); const out: AmazonSellerContentBlockV1[]=[];
 for (const raw of blocks.slice(0,LIMIT_BLOCKS)) { const text=normalizeSellerText(raw.text); const section=raw.section; if (!text || !["bullet","description","aplus"].includes(section||"")) continue; const id=normalizeSellerText(raw.sourceBlockId,120) || `${section}:${out.length}`; const key=`${section}:${text.toLowerCase()}`; if(seen.has(key)) continue; seen.add(key); out.push({sourceBlockId:id,section:section as AmazonSellerContentBlockV1["section"],label:normalizeSellerText(raw.label,200)||section!,text,sourceUrl:normalizeSellerText(raw.sourceUrl,500),...(raw.imageAlt?{imageAlt:normalizeSellerText(raw.imageAlt,300)}:{})}); }
 return out;
}
const FIELD_PATTERNS: Array<[AmazonFactField, RegExp]> = [
 ["capacity", /\b(?:capacity|holds?|volume|oz|ounces?|ml|liter|litre|gallon)\b|\bfits?\s+(?:about|approximately|around)?\s*\d+(?:\.\d+)?\s*(?:to|[-–])\s*\d+\s+[a-z]+/i],
 ["functional_feature", /\b(?:feature|leak[- ]?proof|insulated|non[- ]?slip|self[- ]?adhesive|adjustable|reusable|foldable|wireless)\b/i],
 ["use_scenario", /\b(?:ideal for|designed for|use in|suitable for|for countertop storage|for kitchen storage|for office use|for travel|for camping|for bathroom use|for bedroom use)\b/i],
 ["care", /\b(?:wash|clean|care|dishwasher|hand wash|maintenance)\b/i],
 ["construction", /\b(?:made of|material|steel|metal|plastic|silicone|wood|aluminum|aluminium|construction)\b/i],
 ["operation", /\b(?:press|twist|open|close|install|mount|attach|operate|button|lid|handle)\b/i],
 ["compatibility", /\b(?:compatible\s+with|works\s+with|fit\s+for|fits?\s+(?!(?:about|approximately|around)\b)(?!(?:\d|\d+\s*(?:to|[-–])))\s+(?:standard|most|any|this|your)\s+(?:model|device|holder|rack|cup\s*holders?|car|drawer|shelf)|fits?\s+(?!(?:about|approximately|around)\b)(?!(?:\d|\d+\s*(?:to|[-–])))\s+(?:model|device|holder|rack|cup\s*holders?|car|drawer|shelf)\b|\buniversal\b)/i],
];

function fieldsForSentence(text: string): AmazonFactField[] {
 const matches = FIELD_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([field]) => field);
 if (matches.includes("capacity")) return ["capacity"];
 if (matches.includes("compatibility")) return ["compatibility"];
 if (matches.includes("use_scenario")) return ["use_scenario"];
 return matches.length > 0 ? [matches[0]] : ["other"];
}

function normalizeDedupeText(value: string): string {
 return normalizeSellerText(value, 300).toLowerCase().replace(/^(?:product description|click to play video)\s*[:：-]?\s*/i, "").trim();
}

function mergeCandidateProvenance(target: AmazonFactCandidateV1, source: AmazonFactCandidateV1 | AmazonFactSourceV1) {
 const sources = "sources" in source ? source.sources : [source];
 const evidenceTexts = "evidenceTexts" in source ? source.evidenceTexts : [source.text];
 for (const item of sources) if (!target.sources.some((existing) => existing.sourceBlockId === item.sourceBlockId && existing.text === item.text)) target.sources.push(item);
 for (const text of evidenceTexts) if (!target.evidenceTexts.includes(text)) target.evidenceTexts.push(text);
}

export function dedupeAmazonFactCandidates(candidates: AmazonFactCandidateV1[]): AmazonFactCandidateV1[] {
 const exact = new Map<string, AmazonFactCandidateV1>();
 for (const candidate of candidates) {
  const valueKey = normalizeDedupeText(candidate.value);
  const evidenceKey = candidate.evidenceTexts.map(normalizeDedupeText).sort().join("|");
  const exactKey = `${valueKey}|${evidenceKey}`;
  const sameExact = exact.get(exactKey);
  if (sameExact) { mergeCandidateProvenance(sameExact, candidate); continue; }
  exact.set(exactKey, { ...candidate, sources: [...candidate.sources], evidenceTexts: [...candidate.evidenceTexts] });
 }
 const rows = [...exact.values()];
 const output: AmazonFactCandidateV1[] = [];
 for (const candidate of rows) {
  const candidateText = normalizeDedupeText(candidate.value);
  const near = output.find((existing) => {
   if (existing.field !== candidate.field) return false;
   const existingText = normalizeDedupeText(existing.value);
   const shorter = Math.min(existingText.length, candidateText.length);
   const longer = Math.max(existingText.length, candidateText.length);
   const existingWords = new Set(existingText.split(/[^a-z0-9]+/i).filter(Boolean));
   const candidateWords = new Set(candidateText.split(/[^a-z0-9]+/i).filter(Boolean));
   const overlap = [...existingWords].filter((word) => candidateWords.has(word)).length;
   const shorterWordCount = Math.min(existingWords.size, candidateWords.size);
   return shorter >= 24 && longer > 0 && (existingText.includes(candidateText) || candidateText.includes(existingText) || (shorterWordCount >= 5 && overlap / shorterWordCount >= 0.8));
  });
  if (!near) { output.push(candidate); continue; }
  if (candidateText.length > normalizeDedupeText(near.value).length) {
   const index = output.indexOf(near);
   mergeCandidateProvenance(candidate, near);
   output[index] = candidate;
  } else mergeCandidateProvenance(near, candidate);
 }
 return output;
}
function sourceType(section: AmazonFactSourceV1["section"]): AmazonFactCandidateV1["sourceType"] { return section === "product_information" ? "structured" : section; }
export function isWeightLike(value: string): boolean { return /(?:^|[^a-z])(?:\d+(?:\.\d+)?\s*)?(?:pounds?|lbs?|lb|kilograms?|kgs?|kg|grams?|g)(?=$|[^a-z])/i.test(value); }
export function mapSellerBlocksToCandidates(input:{taskId:string;asin:string;blocks:AmazonSellerContentBlockV1[];structured?:Record<string,string>}, now=new Date().toISOString()):AmazonFactCandidateV1[] {
 const rows: AmazonFactCandidateV1[]=[]; const byKey=new Map<string,AmazonFactCandidateV1>();
 const add=(field:AmazonFactField,value:string,source:AmazonFactSourceV1,approx=false,negative=false)=>{ const clean=normalizeSellerText(value,300); if(!clean) return; const key=`${field}:${clean.toLowerCase()}`; const existing=byKey.get(key); if(existing){existing.sources.push(source);existing.evidenceTexts.push(source.text);return;} const unitMismatch=field==="capacity" && isWeightLike(clean); const needsReview=approx||negative||field==="compatibility"||unitMismatch; const c:AmazonFactCandidateV1={id:`amazon-enrichment:${field}:${rows.length}`,taskId:input.taskId,asin:input.asin,field,value:clean,status:needsReview?"review":"direct",sourceType:sourceType(source.section),sources:[source],evidenceTexts:[source.text],approximate:approx,negative,conflict:false,conflictReason:unitMismatch?"capacity_unit_mismatch":null,reviewRequired:needsReview,createdAt:now}; byKey.set(key,c); rows.push(c); };
 for(const [field,value] of Object.entries(input.structured||{})){ if((AMAZON_FACT_FIELDS as readonly string[]).includes(field)) add(field as AmazonFactField,value,{sourceBlockId:`structured:${field}`,sourceUrl:`https://www.amazon.com/dp/${input.asin}`,section:"product_information",label:"Product Information",text:value}); }
 for(const block of input.blocks){ const sentences=block.text.split(/(?<=[.!?;])\s+|•|\n|,\s+(?=(?:ideal for|designed for|suitable for|use in)\b)/i).map(s=>normalizeSellerText(s,300)).filter(Boolean).slice(0,20); for(const sentence of sentences){ const fieldsToAdd=fieldsForSentence(sentence); const approx=/\b(?:about|approximately|around|between|\d+\s*[-–]\s*\d+)\b/i.test(sentence); const negative=/\b(?:not compatible|does not fit|cannot|not for)\b/i.test(sentence); for(const field of fieldsToAdd) add(field,sentence,{sourceBlockId:block.sourceBlockId,sourceUrl:block.sourceUrl || `https://www.amazon.com/dp/${input.asin}`,section:block.section,label:block.label,text:sentence},approx,negative); } }
 return dedupeAmazonFactCandidates(rows.slice(0,80));
}
