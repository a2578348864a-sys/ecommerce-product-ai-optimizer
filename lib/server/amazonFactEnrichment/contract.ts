export const AMAZON_FACT_ENRICHMENT_SCHEMA = "amazon-fact-enrichment.v1" as const;
export const AMAZON_FACT_FIELDS = ["capacity","functional_feature","use_scenario","care","construction","operation","compatibility","other"] as const;
export type AmazonFactField = typeof AMAZON_FACT_FIELDS[number];
export type AmazonSellerContentSection = "bullet" | "description" | "aplus";
export type AmazonFactSourceSection = "product_information" | AmazonSellerContentSection;
export type AmazonSellerContentBlockV1 = {
  sourceBlockId: string;
  section: AmazonSellerContentSection;
  label: string;
  text: string;
  sourceUrl: string;
  imageAlt?: string;
};
export type AmazonFactSourceV1 = { sourceBlockId: string; sourceUrl: string; section: AmazonFactSourceSection; label: string; text: string };
export type AmazonFactCandidateV1 = {
  id: string; taskId: string; asin: string; field: AmazonFactField; value: string;
  status: "direct" | "review" | "conflict";
  sourceType: "structured" | AmazonSellerContentSection;
  sources: AmazonFactSourceV1[]; evidenceTexts: string[];
  approximate: boolean; negative: boolean; conflict: boolean; conflictReason: string | null;
  reviewRequired: boolean; createdAt: string;
};
export type AmazonUnstructuredFactExtractionV1 = {
  candidates: Array<{ field: AmazonFactField; value: string; sourceBlockId: string; evidenceText: string; qualifier: "direct"|"approximate"|"negative"|"conditional"; confidence: "high"|"medium" }>;
};
export type AmazonFactEnrichmentPreviewV1 = {
  schema: typeof AMAZON_FACT_ENRICHMENT_SCHEMA; taskId: string; asin: string; collectedAt: string;
  candidates: AmazonFactCandidateV1[]; sourceBlocks: AmazonSellerContentBlockV1[];
  naturalLanguageStatus: "not_needed" | "completed" | "failed";
  naturalLanguageMessage?: string; expiresAt: number;
};
