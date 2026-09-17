import type { CopyStrategyBullet, CopyStrategyV1 } from "./types";

export const COPY_STRATEGY_PLANNER_SUGGESTION_SCHEMA =
  "copy-strategy-planner-suggestion.v1" as const;

export type CopyStrategyPlannerSuggestionBullet = {
  role: string;
  structure: "feature_benefit_scenario";
  reason: string;
  referenceOnly: true;
};

/**
 * A value-free bridge between Copy Strategy and the Listing Planner UI.
 * This contract intentionally contains directions only; it cannot carry
 * facts, claims, evidence, or generated Listing copy.
 */
export type CopyStrategyPlannerSuggestionV1 = {
  version: typeof COPY_STRATEGY_PLANNER_SUGGESTION_SCHEMA;
  referenceOnly: true;
  targetRoles: string[];
  recommendedAngles: string[];
  bulletStructureSuggestions: CopyStrategyPlannerSuggestionBullet[];
  titleApproach: string | null;
  descriptionApproach: string | null;
  requiresHumanApproval: true;
};

const EMPTY_SUGGESTION: CopyStrategyPlannerSuggestionV1 = {
  version: COPY_STRATEGY_PLANNER_SUGGESTION_SCHEMA,
  referenceOnly: true,
  targetRoles: [],
  recommendedAngles: [],
  bulletStructureSuggestions: [],
  titleApproach: null,
  descriptionApproach: null,
  requiresHumanApproval: true,
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function roleForBullet(bullet: CopyStrategyBullet, index: number): string {
  const purpose = clean(bullet.purpose).toLowerCase();
  if (purpose.includes("need") || purpose.includes("pain")) return "pain_relief";
  if (purpose.includes("scenario") || purpose.includes("usage")) return "use_scenario";
  if (purpose.includes("benefit")) return "core_outcome";
  return index === 0 ? "core_outcome" : index === 1 ? "pain_relief" : "use_scenario";
}

function suggestionFrom(strategy: CopyStrategyV1): CopyStrategyPlannerSuggestionV1 {
  const targetRoles: string[] = [];
  if (strategy.mainAngle) targetRoles.push("core_outcome");
  if (strategy.buyerPainPoints.length > 0) targetRoles.push("pain_relief");
  if (strategy.bulletStrategies.length > 0) targetRoles.push("use_scenario");
  if (strategy.emotionalHook) targetRoles.push("emotional_hook");

  const recommendedAngles = unique([strategy.mainAngle ?? "", strategy.emotionalHook ?? ""]);
  const bulletStructureSuggestions = strategy.bulletStrategies.map((bullet, index) => ({
    role: roleForBullet(bullet, index),
    structure: "feature_benefit_scenario" as const,
    reason: clean(bullet.purpose) || "用已确认的写作方向组织 Feature → Benefit → Scenario。",
    referenceOnly: true as const,
  }));

  return {
    version: COPY_STRATEGY_PLANNER_SUGGESTION_SCHEMA,
    referenceOnly: true,
    targetRoles: unique(targetRoles),
    recommendedAngles,
    bulletStructureSuggestions,
    titleApproach: clean(strategy.titleStrategy) || null,
    descriptionApproach: clean(strategy.descriptionStrategy) || null,
    requiresHumanApproval: true,
  };
}

/** Build a Planner-facing preview without changing any Listing input or output. */
export function buildCopyStrategyPlannerSuggestion(
  strategy?: CopyStrategyV1 | null,
): CopyStrategyPlannerSuggestionV1 {
  if (!strategy) return { ...EMPTY_SUGGESTION, targetRoles: [], recommendedAngles: [], bulletStructureSuggestions: [] };
  return suggestionFrom(strategy);
}

/** Runtime contract check used by tests and future callers at the boundary. */
export function isCopyStrategyPlannerSuggestionV1(value: unknown): value is CopyStrategyPlannerSuggestionV1 {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.version !== COPY_STRATEGY_PLANNER_SUGGESTION_SCHEMA || record.referenceOnly !== true || record.requiresHumanApproval !== true) return false;
  if (!Array.isArray(record.targetRoles) || !record.targetRoles.every((item) => typeof item === "string")) return false;
  if (!Array.isArray(record.recommendedAngles) || !record.recommendedAngles.every((item) => typeof item === "string")) return false;
  if (!Array.isArray(record.bulletStructureSuggestions)) return false;
  if (typeof record.titleApproach !== "string" && record.titleApproach !== null) return false;
  if (typeof record.descriptionApproach !== "string" && record.descriptionApproach !== null) return false;
  return record.bulletStructureSuggestions.every((item) => {
    if (!item || typeof item !== "object") return false;
    const bullet = item as Record<string, unknown>;
    return typeof bullet.role === "string"
      && bullet.structure === "feature_benefit_scenario"
      && typeof bullet.reason === "string"
      && bullet.referenceOnly === true;
  });
}

export function assertCopyStrategyPlannerSuggestionV1(value: unknown): asserts value is CopyStrategyPlannerSuggestionV1 {
  if (!isCopyStrategyPlannerSuggestionV1(value)) {
    throw new Error("Invalid copy-strategy-planner-suggestion.v1 payload");
  }
}
