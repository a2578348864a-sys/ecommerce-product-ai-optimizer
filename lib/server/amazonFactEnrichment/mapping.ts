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
 ["capacity", /\b(?:capacity|holds?|volume|oz|ounces?|ml|liter|litre|gallon)\b/i],
 ["functional_feature", /\b(?:feature|leak[- ]?proof|insulated|non[- ]?slip|self[- ]?adhesive|adjustable|reusable|foldable|wireless)\b/i],
 ["use_scenario", /\b(?:for|ideal for|use in|kitchen|office|travel|camping|bathroom|bedroom|car|home)\b/i],
 ["care", /\b(?:wash|clean|care|dishwasher|hand wash|maintenance)\b/i],
 ["construction", /\b(?:made of|material|steel|metal|plastic|silicone|wood|aluminum|aluminium|construction)\b/i],
 ["operation", /\b(?:press|twist|open|close|install|mount|attach|operate|button|lid|handle)\b/i],
 ["compatibility", /\b(?:compatible|fits?|fit for|works with|universal)\b/i],
];
function fieldFor(text:string):AmazonFactField { for(const [f,p] of FIELD_PATTERNS) if(p.test(text)) return f; return "other"; }
function sourceType(section: AmazonSellerContentSection): AmazonFactCandidateV1["sourceType"] { return section; }
export function isWeightLike(value: string): boolean { return /(?:^|[^a-z])(?:\d+(?:\.\d+)?\s*)?(?:pounds?|lbs?|lb|kilograms?|kgs?|kg|grams?|g)(?=$|[^a-z])/i.test(value); }
export function mapSellerBlocksToCandidates(input:{taskId:string;asin:string;blocks:AmazonSellerContentBlockV1[];structured?:Record<string,string>}, now=new Date().toISOString()):AmazonFactCandidateV1[] {
 const rows: AmazonFactCandidateV1[]=[]; const byKey=new Map<string,AmazonFactCandidateV1>();
 const add=(field:AmazonFactField,value:string,source:AmazonFactSourceV1,approx=false,negative=false)=>{ const clean=normalizeSellerText(value,300); if(!clean) return; const key=`${field}:${clean.toLowerCase()}`; const existing=byKey.get(key); if(existing){existing.sources.push(source);existing.evidenceTexts.push(source.text);return;} const unitMismatch=field==="capacity" && isWeightLike(clean); const needsReview=approx||negative||field==="compatibility"||unitMismatch; const c:AmazonFactCandidateV1={id:`amazon-enrichment:${field}:${rows.length}`,taskId:input.taskId,asin:input.asin,field,value:clean,status:needsReview?"review":"direct",sourceType:sourceType(source.section),sources:[source],evidenceTexts:[source.text],approximate:approx,negative,conflict:false,conflictReason:unitMismatch?"capacity_unit_mismatch":null,reviewRequired:needsReview,createdAt:now}; byKey.set(key,c); rows.push(c); };
 for(const [field,value] of Object.entries(input.structured||{})){ if((AMAZON_FACT_FIELDS as readonly string[]).includes(field)) add(field as AmazonFactField,value,{sourceBlockId:`structured:${field}`,sourceUrl:"amazon://product-information",section:"description",label:"Product Information",text:value}); }
 for(const block of input.blocks){ const sentences=block.text.split(/(?<=[.!?;])\s+|•|\n/).map(s=>normalizeSellerText(s,300)).filter(Boolean).slice(0,20); for(const sentence of sentences){ const matches=FIELD_PATTERNS.filter(([,p])=>p.test(sentence)).map(([f])=>f); const fieldsToAdd=matches.length>0?matches:["other" as AmazonFactField]; const approx=/\b(?:about|approximately|around|between|\d+\s*[-–]\s*\d+)\b/i.test(sentence); const negative=/\b(?:not compatible|does not fit|cannot|not for)\b/i.test(sentence); for(const field of fieldsToAdd) add(field,sentence,{sourceBlockId:block.sourceBlockId,sourceUrl:block.sourceUrl,section:block.section,label:block.label,text:sentence},approx,negative); } }
 return rows.slice(0,80);
}
