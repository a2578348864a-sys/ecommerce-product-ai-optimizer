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
export type AmazonNaturalLanguageFailureStage = "provider" | "response_parse" | "schema" | "evidence";
export type AmazonNaturalLanguageFailureCode =
  | "provider_invalid_parameters"
  | "provider_timeout"
  | "provider_network_error"
  | "provider_invalid_api_key"
  | "provider_missing_api_key"
  | "provider_missing_model"
  | "provider_missing_base_url"
  | "provider_insufficient_balance"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_error"
  | "provider_unknown_error"
  | "ai_empty_response"
  | "ai_json_parse_error"
  | "ai_invalid_schema"
  | "ai_evidence_not_found"
  | "ai_numeric_mismatch"
  | "ai_strong_claim_upgrade"
  | "ai_capacity_unit_mismatch";
export type AmazonNaturalLanguageSchemaFailureCode =
  | "top_level_not_object"
  | "top_level_extra_keys"
  | "candidates_not_array"
  | "candidate_not_object"
  | "candidate_extra_keys"
  | "field_invalid"
  | "value_not_string"
  | "source_block_id_not_string"
  | "source_block_unknown"
  | "evidence_text_not_string"
  | "qualifier_invalid"
  | "confidence_invalid";
export type AmazonFactEnrichmentPreviewV1 = {
  schema: typeof AMAZON_FACT_ENRICHMENT_SCHEMA; taskId: string; asin: string; collectedAt: string;
  candidates: AmazonFactCandidateV1[]; sourceBlocks: AmazonSellerContentBlockV1[];
  naturalLanguageStatus: "not_needed" | "completed" | "failed";
  naturalLanguageMessage?: string;
  naturalLanguageFailureStage?: AmazonNaturalLanguageFailureStage;
  naturalLanguageFailureCode?: AmazonNaturalLanguageFailureCode;
  naturalLanguageSchemaFailureCode?: AmazonNaturalLanguageSchemaFailureCode;
  naturalLanguageProviderHttpStatusClass?: "not_started" | "success" | "client_error" | "rate_limited" | "server_error" | "timeout" | "network_error" | "unknown";
  expiresAt: number;
};
