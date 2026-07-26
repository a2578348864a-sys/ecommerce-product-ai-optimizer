import {
  mapSellerSpriteHeaders,
  REQUIRED_SELLERSPRITE_FIELDS,
} from "./fields";

export type SellerSpriteReportType = "search_results" | "category_current";
export type SellerSpriteDetectedReportType = SellerSpriteReportType | "unknown";

export interface SellerSpriteReportTypeDetectionEvidence {
  hasSearchRankColumn: boolean;
  hasRootCategoryColumn: boolean;
  hasRootCategoryBsrColumn: boolean;
  hasSubCategoryColumn: boolean;
  hasSubCategoryBsrColumn: boolean;
}

export interface SellerSpriteReportTypeDetection {
  reportType: SellerSpriteDetectedReportType;
  evidence: SellerSpriteReportTypeDetectionEvidence;
}

export function detectSellerSpriteReportType(
  headers: ReadonlyArray<string | null>,
): SellerSpriteReportTypeDetection {
  const mapping = mapSellerSpriteHeaders(headers);
  const has = (field: keyof typeof mapping.fieldIndexes) => (
    mapping.fieldIndexes[field] !== undefined
  );
  const evidence: SellerSpriteReportTypeDetectionEvidence = {
    hasSearchRankColumn: has("searchRank"),
    hasRootCategoryColumn: has("rootCategory"),
    hasRootCategoryBsrColumn: has("rootCategoryBsr"),
    hasSubCategoryColumn: has("subCategory"),
    hasSubCategoryBsrColumn: has("subCategoryBsr"),
  };
  const hasRequiredIdentity = REQUIRED_SELLERSPRITE_FIELDS.every(has);
  const relevantAmbiguity = mapping.ambiguousFields.some((field) => (
    REQUIRED_SELLERSPRITE_FIELDS.includes(field)
    || field === "searchRank"
    || field === "rootCategory"
    || field === "rootCategoryBsr"
    || field === "subCategory"
    || field === "subCategoryBsr"
  ));
  if (!hasRequiredIdentity || relevantAmbiguity) {
    return { reportType: "unknown", evidence };
  }
  if (evidence.hasSearchRankColumn) {
    return { reportType: "search_results", evidence };
  }
  if (
    evidence.hasRootCategoryColumn
    && evidence.hasRootCategoryBsrColumn
    && evidence.hasSubCategoryColumn
    && evidence.hasSubCategoryBsrColumn
  ) {
    return { reportType: "category_current", evidence };
  }
  return { reportType: "unknown", evidence };
}
