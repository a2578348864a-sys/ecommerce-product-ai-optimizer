export const FAMILY_TOP5_SCHEMA_VERSION = "investigation-product-family-data.v1" as const;
export const FAMILY_TOP5_PROVENANCE_SCHEMA_VERSION = "family-top5-provenance.v1" as const;
export const FAMILY_TOP5_MANIFEST_SCHEMA_VERSION = "family-top5-review-manifest.v2" as const;
export const FAMILY_REVIEW_EXPORT_SCHEMA_VERSION = "family-top5-human-review.v1" as const;

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

export type MemberListing = FamilyListing;

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

export interface FamilyTop5ProvenanceV1 {
  schemaVersion: typeof FAMILY_TOP5_PROVENANCE_SCHEMA_VERSION;
  probe: {
    probeCommit: string;
    probeTree: string;
    artifactId: string;
    inputHash: string;
    runBindingHash: string;
    fixturePath: string;
    fixtureSha256: string;
    manifestSha256: string;
  };
  providerAwareV2: {
    version: string;
    inputHash: string;
    contentHash: string;
    sourceProbeInputHash: string;
    sourceFixtureSha256: string;
  };
  familyPackage: {
    familyGrouperVersion: string;
    sourceV2InputHash: string;
    sourceV2ContentHash: string;
    familyDataSha256: string;
    familyManifestSha256: string;
    generatedHtmlSha256: string;
    familyCount: number;
    topFamilyCount: number;
    remainingFamilyCount: number;
  };
  appFixture: {
    sourceArtifactId: string;
    copiedFromPath: string;
    sourceSha256: string;
    localFixtureSha256: string;
    provenanceSchemaVersion: typeof FAMILY_TOP5_PROVENANCE_SCHEMA_VERSION;
  };
}

export interface SourceArtifactBinding {
  sourceArtifactId: string;
  probeInputHash: string;
  probeRunBindingHash: string;
  providerAwareV2InputHash: string;
  providerAwareV2ContentHash: string;
  familyDataSha256: string;
  familyManifestSha256: string;
  appManifestSha256: string;
  provenanceSha256: string;
}

export type DataReadiness =
  | "ready"
  | "artifact_missing"
  | "artifact_integrity_failed"
  | "provenance_invalid"
  | "schema_unsupported";

export type FamilyReviewDecisionValue = "continue_research" | "watch" | "reject";

export interface FamilyReviewDecision {
  familyId: string;
  representativeStableId: string;
  memberStableIds: string[];
  decision: FamilyReviewDecisionValue;
  notes: string;
}

export interface SelectedFamily {
  familyId: string;
  representativeStableId: string;
  memberStableIds: string[];
}

export interface FamilyReviewExport {
  schemaVersion: typeof FAMILY_REVIEW_EXPORT_SCHEMA_VERSION;
  reviewedAt: string;
  reviewedFamilies: FamilyReviewDecision[];
  selectedFamilyIds: string[];
  selectedFamilies: SelectedFamily[];
  reviewerConfirmation: {
    confirmedByHuman: true;
    statement: "人工已逐项复核上述 5 个商品家族";
  };
  sourceArtifactBinding: SourceArtifactBinding;
}
