// ═══ Family-aware Top 5 — Read-only data contract ═══
// Frozen from: Provider-Aware-Family-Top5-Review-07
// Do not modify field meanings without updating the upstream generator.

export const FAMILY_TOP5_SCHEMA_VERSION = "investigation-product-family-data.v1" as const;

export interface FamilyListing {
  stableId: string;
  title: string;
  price: number;
  rating: number;
  reviewCount: number;
  link: string;
  packInfo: string;
  thumbnailUrl: string | null;
  originalRank: number;
}

export interface RepresentativeListing extends FamilyListing {
  parsedNameZh: string;
  installation: string;
  materials: string[];
  capacities: number[];
  dimensions: string[];
}

export interface MemberListing extends FamilyListing {
  // same as FamilyListing, kept for clarity
}

export interface ProductFamily {
  familyId: string;
  familyStatus: "variant_or_listing_conflict" | "singleton";
  familyKeyType: "model_number" | "stable_id";
  familyRank: number;
  normalizedBrand: string;
  normalizedModelNumber: string | null;
  representativeStableId: string;
  representativeListingRank: number;
  memberCount: number;
  memberStableIds: string[];
  sellerEvidenceStatus: "not_observed";
  sellerWarning: string | null;
  representativeListing: RepresentativeListing;
  memberListings: MemberListing[];
  variantDifferences: string[];
  duplicateSignals: string[];
  factualReasons: string[];
  cautionReasons: string[];
  unknowns: string[];
  decisionReadiness: "visual_review_ready" | "visual_evidence_missing" | "specification_incomplete" | "parse_conflict";
  notTopFamilyReason?: string;
}

export interface ProductFamilyReviewDataV1 {
  schemaVersion: typeof FAMILY_TOP5_SCHEMA_VERSION;
  codeBaseline: { commit: string; tree: string; branch: string };
  parserVersion: string;
  familyGrouperVersion: string;
  fixture: { source: string };
  listingCount: number;
  familyCount: number;
  topFamilyCount: number;
  remainingFamilyCount: number;
  topFamilies: ProductFamily[];
  remainingFamilies: ProductFamily[];
}

export type DataReadiness =
  | "ready"
  | "artifact_missing"
  | "artifact_integrity_failed"
  | "schema_unsupported";

export interface FamilyReviewDecision {
  familyId: string;
  representativeStableId: string;
  memberStableIds: string[];
  decision: "继续调查" | "暂时观察" | "不继续调查";
  notes: string;
}

export interface FamilyReviewExport {
  schemaVersion: "family-review-response.v1";
  exportedAt: string;
  codeBaseline: { commit: string; tree: string };
  reviewedFamilies: FamilyReviewDecision[];
  overall: { topPicks: string[]; comments: string };
}
