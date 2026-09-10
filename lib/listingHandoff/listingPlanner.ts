import "server-only";

import { callAiJson } from "@/lib/server/aiClient";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import { LISTING_COMPOSER_VERSION, LISTING_GENERATION_POLICY_VERSION } from "@/lib/listingHandoff/listingGenerationInput";
import type { ListingBrief } from "@/lib/listingHandoff/listingBrief";
import type { CopyStrategyV1 } from "@/lib/listingHandoff/copyStrategy/types";
import type { ListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import type { ListingPlan, ListingPlanRole } from "@/lib/listingHandoff/listingPlan";
import { composeOptimizedListingDraft } from "@/lib/listingHandoff/listingComposition";
import { composeControlledBullets } from "@/lib/listingHandoff/listingComposition";
import { verifyListingClaims, listingClaimsHaveEvidence } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import { validateCopyQualityContract } from "@/lib/listingHandoff/listingRuntimeSkill";
import { validateRuntimeBulletContract } from "@/lib/listingHandoff/listingRuntimeSkill";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";

export const LISTING_PLANNER_SCHEMA_VERSION = "listing_planner.v1" as const;
export const PLANNER_TOP_LEVEL_KEYS = ["schemaVersion", "title", "bullets", "description", "backendKeywordIds"] as const;
export const PLANNER_TITLE_KEYS = ["factIds", "keywordIds"] as const;
export const PLANNER_BULLET_KEYS = ["role", "factIds", "keywordIds", "templateId"] as const;
export const PLANNER_DESCRIPTION_KEYS = ["factIds"] as const;
const ROLES: readonly ListingPlanRole[] = ["core_outcome", "pain_relief", "use_scenario", "ease_of_use", "proof_or_fit"];
export const PLANNER_TEMPLATE_BY_ROLE: Record<ListingPlanRole, string> = {
  core_outcome: "core_outcome_a",
  pain_relief: "pain_relief_a",
  use_scenario: "use_scenario_a",
  ease_of_use: "ease_of_use_a",
  proof_or_fit: "proof_or_fit_a",
};

export type ListingPlannerDecision = {
  schemaVersion: typeof LISTING_PLANNER_SCHEMA_VERSION;
  title: { factIds: string[]; keywordIds: string[] };
  bullets: Array<{ role: ListingPlanRole; factIds: string[]; keywordIds: string[]; templateId: string }>;
  description: { factIds: string[] };
  backendKeywordIds: string[];
};

export type ListingPlannerInput = {
  facts: Array<{ factId: string; field: string; label: string; value: string }>;
  plan: ListingPlan;
  keywordBrief: ListingKeywordBrief | null;
  listingBrief: ListingBrief | null;
  /** Reference-only shopper framing; never used as facts or evidence. */
  copyStrategy?: CopyStrategyV1;
  prohibitedClaims: string[];
  creativeContext?: ListingGenerationInput["creativeContext"];
  englishRenderings?: ListingGenerationInput["englishRenderings"];
};

export type ListingPlannerResult =
  | { ok: true; data: ListingPlannerDecision; changed: boolean; rawSelectionCount: number; validSelectionCount: number; rejectedSelectionCount: number; filledSelectionCount: number; semanticStatus: "full" | "partial" | "none"; validSelections: ListingPlannerDecision["bullets"]; rejectedSelections: PlannerRejectedSelection[] }
  | { ok: false; error: { code: "planner_timeout" | "planner_provider_error" | "planner_schema_invalid" | "planner_json_parse_failed"; message: string; failureStage: PlannerFailureStage; schemaFailureCode?: PlannerSchemaFailureCode; unknownKeys?: string[] } };
type PlannerErrorCode = "planner_timeout" | "planner_provider_error" | "planner_schema_invalid" | "planner_json_parse_failed";
export type PlannerFailureStage = "provider" | "parse" | "schema" | "semantic_validation" | "renderer";
export type PlannerSchemaFailureCode = "top_level_not_object" | "top_level_extra_keys" | "schema_version_invalid" | "title_invalid" | "title_extra_keys" | "bullets_not_array" | "bullet_not_object" | "bullet_extra_keys" | "bullet_role_invalid" | "bullet_fact_ids_invalid" | "bullet_keyword_ids_invalid" | "bullet_template_invalid" | "description_invalid" | "description_extra_keys" | "backend_keywords_invalid";

export type PlannerClient = (input: ListingPlannerInput) => Promise<unknown>;
let injectedPlannerClient: PlannerClient | null = null;
export function setListingPlannerClientForTests(client: PlannerClient | null): void { injectedPlannerClient = client; }

export type PlannerPromptView = {
  availableTitleFactIds: string[];
  availableBulletOptions: RendererQualifiedOption[];
  availableDescriptionFactIds: string[];
  safeKeywords: Array<{ id: string; text: string }>;
  researchSignals: Array<{ source: "voc" | "keyword" | "competitor" | "sourcing"; signalId: string; summary: string }>;
};

export type RendererQualifiedOption = { role: ListingPlanRole; factIds: string[]; templateId: string; keywordIds: string[]; optionKey?: string };
export type RendererRejectedOption = { role: string; factIds: string[]; templateId: string; reasonCode: string };
export type RendererQualifiedCatalog = { options: RendererQualifiedOption[]; rejected: RendererRejectedOption[]; qualifiedRoles: string[] };
export type PlannerRejectedSelection = { index: number; reasonCode: string; role?: string };
export type PlannerSelectionEvaluation = {
  validSelections: ListingPlannerDecision["bullets"];
  rejectedSelections: PlannerRejectedSelection[];
  semanticStatus: "full" | "partial" | "none";
};
export type CompletedPlannerSelections = {
  selections: ListingPlannerDecision["bullets"];
  filledCount: number;
};
export type FinalizablePlannerPlan = { plan: ListingPlan; selections: ListingPlannerDecision["bullets"]; finalizablePlanKey: string };
export type FinalizablePlannerCatalog = { plans: FinalizablePlannerPlan[]; candidateCount: number; rejectedCount: number };

function optionKeyOf(option: { role: string; factIds: string[]; templateId: string }): string {
  return [option.role, [...option.factIds].sort().join(","), option.templateId].join("|");
}

export function buildRendererQualifiedOptions(input: ListingPlannerInput): RendererQualifiedCatalog {
  const options: RendererQualifiedOption[] = [];
  const rejected: RendererRejectedOption[] = [];
  for (const bp of input.plan.bulletPlans) {
    if (!bp.role || !ROLES.includes(bp.role)) continue;
    for (const factId of bp.featureFactIds) {
      const candidatePlan: ListingPlan = { ...input.plan, bulletPlans: [{ ...bp, featureFactIds: [factId], keywordIds: [] }] };
      const rendered = composeControlledBullets(inputToGeneration(input), candidatePlan);
      const bullet = rendered.bullets[0] ?? "";
      const fact = input.facts.find((f) => f.factId === factId);
      const reason = (code: string) => rejected.push({ role: bp.role!, factIds: [factId], templateId: PLANNER_TEMPLATE_BY_ROLE[bp.role!], reasonCode: code });
      if (!bullet || !fact) { reason("renderability"); continue; }
      if (/[一-鿿㐀-䶿]/.test(bullet)) { reason("english_only"); continue; }
      const runtimeIssues = validateRuntimeBulletContract({ bullet, anchorValues: [fact.value], label: "Candidate bullet" });
      if (runtimeIssues.length > 0) { reason(String(runtimeIssues[0]?.code ?? "runtime")); continue; }
      const whole = composeOptimizedListingDraft(inputToGeneration(input), candidatePlan, null);
      const evidence = verifyListingClaims({ source: "deterministic_composition_v1", version: 1, generatedAt: "", model: "local", humanReviewRequired: true, titles: whole.titles, bullets: [bullet], description: whole.description, keywords: [], sellingPoints: [], riskNotes: [], complianceWarnings: [], blockedClaims: [], reviewChecklist: [] }, inputToGeneration(input));
      if (!listingClaimsHaveEvidence(evidence)) { reason("unsupported_claim"); continue; }
      const copy = validateCopyQualityContract({ title: whole.titles[0] ?? "", bullets: [bullet], description: whole.description, cannotSay: input.prohibitedClaims, facts: input.facts.map((f) => ({ factId: f.factId, field: f.field, label: f.label, value: f.value })), bulletPlans: [bp], typeLabel: input.facts.find((f) => f.field === "product_type")?.value ?? "product" });
      if (!copy.ok) { reason(String(copy.issues[0]?.code ?? "copy_quality")); continue; }
      options.push({ role: bp.role, factIds: [factId], templateId: PLANNER_TEMPLATE_BY_ROLE[bp.role], keywordIds: [], optionKey: optionKeyOf({ role: bp.role, factIds: [factId], templateId: PLANNER_TEMPLATE_BY_ROLE[bp.role] }) });
    }
  }
  return { options, rejected, qualifiedRoles: [...new Set(options.map((o) => o.role))] };
}

function inputToGeneration(input: ListingPlannerInput): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1", source: { handoffRevision: 0, researchRevision: 0 },
      productFacts: input.facts.map((f) => ({ field: f.field, label: f.label, value: f.value })), stableSourceFacts: [], creativeReferences: [], creativePreferences: {}, prohibitedClaims: input.prohibitedClaims, unknowns: [], humanReviewRequired: true, researchMode: "market_research_only", promotionEligible: false,
    creativeContext: input.creativeContext,
    englishRenderings: input.englishRenderings,
    copyStrategy: input.copyStrategy,
  };
}

export function buildPlannerPromptView(input: ListingPlannerInput): PlannerPromptView {
  const availableTitleFactIds = input.plan.titlePlan.flatMap((item) => input.facts.some((f) => f.factId === item) ? [item] : []);
  const availableDescriptionFactIds = input.facts.map((f) => f.factId).filter((id) => input.plan.descriptionPlan.toLocaleLowerCase().includes(id.toLocaleLowerCase()));
  const availableBulletOptions = buildRendererQualifiedOptions(input).options.map(({ role, factIds, templateId, keywordIds }) => ({ role, factIds, templateId, keywordIds }));
  const keywordTerms = input.keywordBrief ? [input.keywordBrief.primaryKeyword, ...input.keywordBrief.supportingKeywords, ...input.keywordBrief.backendSearchTerms].filter(Boolean) : [];
  const safeKeywords = [...new Set(keywordTerms)].slice(0, 50).map((text) => ({ id: text, text }));
  const source = input.creativeContext;
  const researchSignals: PlannerPromptView["researchSignals"] = [];
  const add = (kind: PlannerPromptView["researchSignals"][number]["source"], values: string[]) => values.slice(0, 8).forEach((summary, index) => researchSignals.push({ source: kind, signalId: `${kind}-${index + 1}`, summary: String(summary).slice(0, 160) }));
  if (source) { add("voc", source.vocInsights); add("keyword", source.keywordCandidates); add("competitor", source.competitiveContext.map(String)); add("sourcing", source.sourcingContext.map(String)); }
  return { availableTitleFactIds, availableBulletOptions, availableDescriptionFactIds, safeKeywords, researchSignals };
}

export function buildListingPlannerPrompt(input: ListingPlannerInput): string {
  const view = buildPlannerPromptView(input);
  const exampleBullets = view.availableBulletOptions.slice(0, 3).map((option) => ({ role: option.role, factIds: option.factIds, keywordIds: option.keywordIds, templateId: option.templateId }));
  return [
    "You are a Listing Planner, not a copywriter. Return exactly one JSON object.",
    "Select only IDs and template IDs from PLANNER_INPUT. Values are read-only context. Do not rewrite values, add claims, output prose, or add explanatory properties.",
    "Research signals are REFERENCE_ONLY and may influence priority only.",
    "COPY_STRATEGY is REFERENCE_ONLY and may guide audience, angle, tone and role ordering only; never treat it as a product fact or claim.",
    ...(input.copyStrategy ? ["COPY_STRATEGY_START", JSON.stringify({ targetBuyer: input.copyStrategy.targetBuyer, buyerPainPoints: input.copyStrategy.buyerPainPoints.slice(0, 6), mainAngle: input.copyStrategy.mainAngle, copyTone: input.copyStrategy.copyTone, bulletStrategies: input.copyStrategy.bulletStrategies.slice(0, 5).map((item) => ({ order: item.order, structure: item.structure, purpose: item.purpose })), titleStrategy: input.copyStrategy.titleStrategy, descriptionStrategy: input.copyStrategy.descriptionStrategy, avoidExpressions: input.copyStrategy.avoidExpressions.slice(0, 8) }), "COPY_STRATEGY_END"] : []),
    "For each bullet, use exactly the four keys: role, factIds, keywordIds, templateId.",
    "OUTPUT_SCHEMA=" + JSON.stringify({ schemaVersion: LISTING_PLANNER_SCHEMA_VERSION, title: { factIds: view.availableTitleFactIds.slice(0, 2), keywordIds: [] }, bullets: exampleBullets, description: { factIds: view.availableDescriptionFactIds.slice(0, 2) }, backendKeywordIds: [] }),
    "PLANNER_INPUT=" + JSON.stringify(view),
  ].join("\n");
}

function parsePlannerStructure(raw: unknown): { ok: true; data: ListingPlannerDecision } | PlannerValidationFailure {
  if (!isRecord(raw)) return { ok: false, message: "planner response was not an object", failureStage: "schema", schemaFailureCode: "top_level_not_object" };
  const topUnknown = unknownKeys(raw, PLANNER_TOP_LEVEL_KEYS);
  if (!exactKeys(raw, PLANNER_TOP_LEVEL_KEYS)) return { ok: false, message: "planner response contains unknown fields", failureStage: "schema", schemaFailureCode: "top_level_extra_keys", unknownKeys: topUnknown };
  if (raw.schemaVersion !== LISTING_PLANNER_SCHEMA_VERSION) return { ok: false, message: "planner schemaVersion is invalid", failureStage: "schema", schemaFailureCode: "schema_version_invalid" };
  if (!isRecord(raw.title)) return { ok: false, message: "planner title is invalid", failureStage: "schema", schemaFailureCode: "title_invalid" };
  if (!exactKeys(raw.title, PLANNER_TITLE_KEYS)) return { ok: false, message: "planner title contains unknown fields", failureStage: "schema", schemaFailureCode: "title_extra_keys", unknownKeys: unknownKeys(raw.title, PLANNER_TITLE_KEYS) };
  if (!Array.isArray(raw.title.factIds) || !Array.isArray(raw.title.keywordIds)) return { ok: false, message: "planner title arrays are invalid", failureStage: "schema", schemaFailureCode: "title_invalid" };
  if (!isRecord(raw.description)) return { ok: false, message: "planner description is invalid", failureStage: "schema", schemaFailureCode: "description_invalid" };
  if (!exactKeys(raw.description, PLANNER_DESCRIPTION_KEYS) || !Array.isArray(raw.description.factIds)) return { ok: false, message: "planner description is invalid", failureStage: "schema", schemaFailureCode: "description_extra_keys" };
  if (!Array.isArray(raw.bullets)) return { ok: false, message: "planner bullets is not an array", failureStage: "schema", schemaFailureCode: "bullets_not_array" };
  if (!Array.isArray(raw.backendKeywordIds)) return { ok: false, message: "planner backendKeywordIds is invalid", failureStage: "schema", schemaFailureCode: "backend_keywords_invalid" };
  const bullets: ListingPlannerDecision["bullets"] = [];
  for (const item of raw.bullets) {
    if (!isRecord(item)) return { ok: false, message: "planner bullet is not an object", failureStage: "schema", schemaFailureCode: "bullet_not_object" };
    if (!exactKeys(item, PLANNER_BULLET_KEYS)) return { ok: false, message: "planner bullet contains unknown fields", failureStage: "schema", schemaFailureCode: "bullet_extra_keys", unknownKeys: unknownKeys(item, PLANNER_BULLET_KEYS) };
    if (typeof item.role !== "string" || !Array.isArray(item.factIds) || !Array.isArray(item.keywordIds) || typeof item.templateId !== "string") return { ok: false, message: "planner bullet fields are invalid", failureStage: "schema", schemaFailureCode: "bullet_role_invalid" };
    const factIds = strings(item.factIds, 12);
    const keywordIds = strings(item.keywordIds, 12);
    if (factIds.length !== item.factIds.length || keywordIds.length !== item.keywordIds.length) return { ok: false, message: "planner bullet ids are invalid", failureStage: "schema", schemaFailureCode: "bullet_fact_ids_invalid" };
    bullets.push({ role: item.role as ListingPlanRole, factIds, keywordIds, templateId: item.templateId });
  }
  return { ok: true, data: { schemaVersion: LISTING_PLANNER_SCHEMA_VERSION, title: { factIds: strings(raw.title.factIds, 12), keywordIds: strings(raw.title.keywordIds, 12) }, bullets, description: { factIds: strings(raw.description.factIds, 12) }, backendKeywordIds: strings(raw.backendKeywordIds, 50) } };
}

export function evaluatePlannerSelections(decision: ListingPlannerDecision, input: ListingPlannerInput): PlannerSelectionEvaluation {
  const catalog = buildRendererQualifiedOptions(input);
  const qualifiedKeys = new Set(catalog.options.map((option) => optionKeyOf(option)));
  const factIds = new Set(input.facts.map((f) => f.factId));
  const keywordIds = new Set([...(input.keywordBrief ? [input.keywordBrief.primaryKeyword, ...input.keywordBrief.supportingKeywords, ...input.keywordBrief.backendSearchTerms] : [])].filter(Boolean));
  const baseByRole = new Map(input.plan.bulletPlans.map((bp) => [bp.role, bp]));
  const validSelections: ListingPlannerDecision["bullets"] = [];
  const rejectedSelections: PlannerRejectedSelection[] = [];
  const seenRoles = new Set<string>();
  decision.bullets.forEach((item, index) => {
    const reject = (reasonCode: string) => rejectedSelections.push({ index, reasonCode, ...(typeof item.role === "string" ? { role: item.role } : {}) });
    if (!ROLES.includes(item.role) || !baseByRole.has(item.role)) return reject("invalid_role");
    if (seenRoles.has(item.role)) return reject("duplicate_role");
    if (item.factIds.length === 0 || item.factIds.some((id) => !factIds.has(id) || !baseByRole.get(item.role)?.featureFactIds.includes(id))) return reject("invalid_fact_ids");
    if (item.keywordIds.some((id) => !keywordIds.has(id))) return reject("invalid_keyword");
    if (item.templateId !== PLANNER_TEMPLATE_BY_ROLE[item.role]) return reject("invalid_template");
    if (!qualifiedKeys.has(optionKeyOf(item))) return reject("unqualified_option");
    seenRoles.add(item.role);
    validSelections.push(item);
  });
  return { validSelections, rejectedSelections, semanticStatus: validSelections.length === 0 ? "none" : rejectedSelections.length === 0 ? "full" : "partial" };
}

export function completePlannerSelections(validSelections: ListingPlannerDecision["bullets"], catalog: RendererQualifiedCatalog, basePlan: ListingPlan, targetBulletCount: number): CompletedPlannerSelections {
  const desired = Math.min(5, Math.max(3, Number.isFinite(targetBulletCount) ? Math.trunc(targetBulletCount) : 3));
  const out = [...validSelections];
  const roles = new Set(out.map((item) => item.role));
  const baseOrder = new Map(basePlan.bulletPlans.map((bp, index) => [bp.role, index]));
  const candidates = [...catalog.options].sort((a, b) => (roles.has(a.role) ? 1 : 0) - (roles.has(b.role) ? 1 : 0) || (baseOrder.get(a.role) ?? 99) - (baseOrder.get(b.role) ?? 99) || a.optionKey!.localeCompare(b.optionKey!));
  for (const option of candidates) {
    if (out.length >= desired) break;
    if (roles.has(option.role)) continue;
    roles.add(option.role);
    out.push({ role: option.role, factIds: [...option.factIds], keywordIds: [...option.keywordIds], templateId: option.templateId });
  }
  return { selections: out.slice(0, 5), filledCount: Math.max(0, out.length - validSelections.length) };
}

function finalizablePlanKey(selections: ListingPlannerDecision["bullets"]): string {
  return selections.map((item) => `${item.role}:${[...item.factIds].sort().join(",")}:${item.templateId}`).join("|");
}

export function buildFinalizablePlannerCatalog(input: ListingPlannerInput, targetBulletCount = input.plan.bulletPlans.length): FinalizablePlannerCatalog {
  const qualified = buildRendererQualifiedOptions(input);
  const desired = Math.min(5, Math.max(3, Math.trunc(targetBulletCount || 3)));
  const candidates: ListingPlannerDecision["bullets"][] = [];
  const walk = (start: number, chosen: ListingPlannerDecision["bullets"], roles: Set<string>) => {
    if (candidates.length >= 128) return;
    if (chosen.length >= 3 && chosen.length <= desired) candidates.push([...chosen]);
    if (chosen.length >= desired) return;
    for (let i = start; i < qualified.options.length; i += 1) {
      const option = qualified.options[i];
      if (!option || roles.has(option.role)) continue;
      roles.add(option.role);
      chosen.push({ role: option.role, factIds: [...option.factIds], keywordIds: [...option.keywordIds], templateId: option.templateId });
      walk(i + 1, chosen, roles);
      chosen.pop();
      roles.delete(option.role);
      if (candidates.length >= 128) return;
    }
  };
  walk(0, [], new Set());
  const plans: FinalizablePlannerPlan[] = [];
  for (const selections of candidates) {
    const selectedPlan = applyListingPlannerDecision(input.plan, { schemaVersion: LISTING_PLANNER_SCHEMA_VERSION, title: { factIds: [], keywordIds: [] }, bullets: selections, description: { factIds: [] }, backendKeywordIds: [] });
    const generation = inputToGeneration(input);
    const rendered = composeOptimizedListingDraft(generation, selectedPlan, input.keywordBrief);
    const draft = { source: "deterministic_composition_v1" as const, version: 1, generatedAt: new Date(0).toISOString(), model: "local", composerVersion: LISTING_COMPOSER_VERSION, generationPolicyVersion: LISTING_GENERATION_POLICY_VERSION, polishApplied: false as const, polishModel: null, humanReviewRequired: true as const, titles: rendered.titles, bullets: rendered.bullets, description: rendered.description, keywords: rendered.keywords, backendSearchTerms: rendered.backendSearchTerms, sellingPoints: [rendered.bullets[0] ?? "Supported product detail"], riskNotes: ["Human review required."], complianceWarnings: [], blockedClaims: [], reviewChecklist: ["Verify every fact before publishing."] };
    const schema = validateAiListingPackDraft(draft);
    if (!schema.ok || rendered.bullets.length < 3) continue;
    const evidence = verifyListingClaims(schema.data, generation);
    if (!listingClaimsHaveEvidence(evidence)) continue;
    const runtimeFacts = input.facts.map((fact) => ({ factId: fact.factId, field: fact.field, label: fact.label, value: fact.value }));
    const runtime = rendered.bullets.flatMap((bullet, index) => validateRuntimeBulletContract({ bullet, anchorValues: runtimeFacts.map((fact) => fact.value), label: `Finalizable candidate bullet ${index + 1}` }));
    if (runtime.length > 0) continue;
    const copy = validateCopyQualityContract({ title: rendered.titles[0] ?? "", bullets: rendered.bullets, description: rendered.description, cannotSay: input.prohibitedClaims, facts: runtimeFacts, bulletPlans: selectedPlan.bulletPlans, typeLabel: input.facts.find((fact) => fact.field === "product_type")?.value ?? "product" });
    if (!copy.ok) continue;
    const distinctFacts = new Set(selections.flatMap((selection) => selection.factIds));
    if (distinctFacts.size < 3) continue;
    plans.push({ plan: selectedPlan, selections, finalizablePlanKey: finalizablePlanKey(selections) });
  }
  return { plans, candidateCount: candidates.length, rejectedCount: Math.max(0, candidates.length - plans.length) };
}

export function completePlannerSelectionsToFinalizablePlan(validSelections: ListingPlannerDecision["bullets"], catalog: FinalizablePlannerCatalog): { plan: FinalizablePlannerPlan | null; filledCount: number; retainedCount: number } {
  const validKeys = new Set(validSelections.map((selection) => finalizablePlanKey([selection])));
  const ranked = [...catalog.plans].sort((a, b) => {
    const score = (plan: FinalizablePlannerPlan) => plan.selections.reduce((sum, selection) => sum + (validKeys.has(finalizablePlanKey([selection])) ? 1 : 0), 0);
    return score(b) - score(a) || a.selections.length - b.selections.length || a.finalizablePlanKey.localeCompare(b.finalizablePlanKey);
  });
  const chosen = ranked[0] ?? null;
  if (!chosen) return { plan: null, filledCount: 0, retainedCount: 0 };
  const retainedCount = chosen.selections.filter((selection) => validSelections.some((valid) => finalizablePlanKey([valid]) === finalizablePlanKey([selection]))).length;
  return { plan: chosen, filledCount: Math.max(0, chosen.selections.length - retainedCount), retainedCount };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function strings(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, max) : [];
}
function unknownKeys(value: Record<string, unknown>, keys: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !keys.includes(key)).slice(0, 8).map((key) => key.slice(0, 64));
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((k, index) => k === expected[index]);
}

export type PlannerValidationFailure = { ok: false; message: string; failureStage: PlannerFailureStage; schemaFailureCode: PlannerSchemaFailureCode; unknownKeys?: string[] };
export function validateListingPlannerDecision(raw: unknown, input: ListingPlannerInput): { ok: true; data: ListingPlannerDecision } | PlannerValidationFailure {
  if (!isRecord(raw)) return { ok: false, message: "planner response was not an object", failureStage: "schema", schemaFailureCode: "top_level_not_object" };
  const topUnknown = unknownKeys(raw, PLANNER_TOP_LEVEL_KEYS);
  if (!exactKeys(raw, PLANNER_TOP_LEVEL_KEYS)) return { ok: false, message: "planner response contains unknown fields", failureStage: "schema", schemaFailureCode: "top_level_extra_keys", unknownKeys: topUnknown };
  if (raw.schemaVersion !== LISTING_PLANNER_SCHEMA_VERSION) return { ok: false, message: "planner schemaVersion is invalid", failureStage: "schema", schemaFailureCode: "schema_version_invalid" };
  if (!isRecord(raw.title)) return { ok: false, message: "planner title is invalid", failureStage: "schema", schemaFailureCode: "title_invalid" };
  if (!exactKeys(raw.title, PLANNER_TITLE_KEYS)) return { ok: false, message: "planner title contains unknown fields", failureStage: "schema", schemaFailureCode: "title_extra_keys", unknownKeys: unknownKeys(raw.title, PLANNER_TITLE_KEYS) };
  if (!isRecord(raw.description)) return { ok: false, message: "planner description is invalid", failureStage: "schema", schemaFailureCode: "description_invalid" };
  if (!exactKeys(raw.description, PLANNER_DESCRIPTION_KEYS)) return { ok: false, message: "planner description contains unknown fields", failureStage: "schema", schemaFailureCode: "description_extra_keys", unknownKeys: unknownKeys(raw.description, PLANNER_DESCRIPTION_KEYS) };
  if (!Array.isArray(raw.bullets)) return { ok: false, message: "planner bullets is not an array", failureStage: "schema", schemaFailureCode: "bullets_not_array" };
  if (!Array.isArray(raw.backendKeywordIds)) return { ok: false, message: "planner backendKeywordIds is invalid", failureStage: "schema", schemaFailureCode: "backend_keywords_invalid" };
  const factIds = new Set(input.facts.map((f) => f.factId));
  const keywordIds = new Set([
    ...(input.keywordBrief ? [input.keywordBrief.primaryKeyword, ...input.keywordBrief.supportingKeywords, ...input.keywordBrief.backendSearchTerms] : []),
  ].filter(Boolean));
  const titleFactIds = strings(raw.title.factIds, 12);
  const titleKeywordIds = strings(raw.title.keywordIds, 12);
  const descriptionFactIds = strings(raw.description.factIds, 12);
  const backendKeywordIds = strings(raw.backendKeywordIds, 50);
  if (new Set(titleFactIds).size !== titleFactIds.length || new Set(titleKeywordIds).size !== titleKeywordIds.length || new Set(descriptionFactIds).size !== descriptionFactIds.length || new Set(backendKeywordIds).size !== backendKeywordIds.length) return { ok: false, message: "planner contains duplicate ids", failureStage: "semantic_validation", schemaFailureCode: "bullet_fact_ids_invalid" };
  if (titleFactIds.some((id) => !factIds.has(id)) || descriptionFactIds.some((id) => !factIds.has(id))) return { ok: false, message: "planner referenced unknown fact id", failureStage: "semantic_validation", schemaFailureCode: "bullet_fact_ids_invalid" };
  if (titleKeywordIds.some((id) => !keywordIds.has(id)) || backendKeywordIds.some((id) => !keywordIds.has(id))) return { ok: false, message: "planner referenced unknown keyword id", failureStage: "semantic_validation", schemaFailureCode: "bullet_keyword_ids_invalid" };
  if (raw.bullets.length < 3 || raw.bullets.length > 5) return { ok: false, message: "planner must select 3-5 bullets", failureStage: "semantic_validation", schemaFailureCode: "bullet_role_invalid" };
  const baseByRole = new Map(input.plan.bulletPlans.map((bp) => [bp.role, bp]));
  const qualifiedCatalog = buildRendererQualifiedOptions(input);
  const qualifiedKeys = new Set(qualifiedCatalog.options.map((option) => optionKeyOf(option)));
  const seenRoles = new Set<string>();
  const bullets: ListingPlannerDecision["bullets"] = [];
  for (const item of raw.bullets) {
    if (!isRecord(item)) return { ok: false, message: "planner bullet is not an object", failureStage: "schema", schemaFailureCode: "bullet_not_object" };
    if (!exactKeys(item, PLANNER_BULLET_KEYS)) return { ok: false, message: "planner bullet contains unknown fields", failureStage: "schema", schemaFailureCode: "bullet_extra_keys", unknownKeys: unknownKeys(item, PLANNER_BULLET_KEYS) };
    const role = item.role;
    if (typeof role !== "string" || !ROLES.includes(role as ListingPlanRole) || seenRoles.has(role)) return { ok: false, message: "planner bullet role is invalid or duplicated", failureStage: "semantic_validation", schemaFailureCode: "bullet_role_invalid" };
    const base = baseByRole.get(role as ListingPlanRole);
    if (!base) return { ok: false, message: "planner selected a role absent from the existing plan", failureStage: "semantic_validation", schemaFailureCode: "bullet_role_invalid" };
    const selectedFacts = strings(item.factIds, 12);
    const allowed = new Set(base.featureFactIds);
    if (selectedFacts.length === 0 || selectedFacts.some((id) => !allowed.has(id) || !factIds.has(id))) return { ok: false, message: "planner bullet fact is outside its existing role plan", failureStage: "semantic_validation", schemaFailureCode: "bullet_fact_ids_invalid" };
    const selectedKeywords = strings(item.keywordIds, 12);
    if (selectedKeywords.some((id) => !keywordIds.has(id))) return { ok: false, message: "planner bullet keyword is not approved", failureStage: "semantic_validation", schemaFailureCode: "bullet_keyword_ids_invalid" };
    if (item.templateId !== PLANNER_TEMPLATE_BY_ROLE[role as ListingPlanRole]) return { ok: false, message: "planner template is not allowed for role", failureStage: "semantic_validation", schemaFailureCode: "bullet_template_invalid" };
    if (!qualifiedKeys.has(optionKeyOf({ role, factIds: selectedFacts, templateId: item.templateId as string }))) return { ok: false, message: "planner bullet tuple is not renderer-qualified", failureStage: "semantic_validation", schemaFailureCode: "bullet_fact_ids_invalid" };
    seenRoles.add(role);
    bullets.push({ role: role as ListingPlanRole, factIds: selectedFacts, keywordIds: selectedKeywords, templateId: item.templateId as string });
  }
  return { ok: true, data: { schemaVersion: LISTING_PLANNER_SCHEMA_VERSION, title: { factIds: titleFactIds, keywordIds: titleKeywordIds }, bullets, description: { factIds: descriptionFactIds }, backendKeywordIds } };
}

export function applyListingPlannerDecision(plan: ListingPlan, decision: ListingPlannerDecision): ListingPlan {
  const byRole = new Map(plan.bulletPlans.map((bp) => [bp.role, bp]));
  return {
    ...plan,
    bulletPlans: decision.bullets.map((item) => ({
      ...(byRole.get(item.role) ?? plan.bulletPlans[0]),
      role: item.role,
      featureFactIds: item.factIds,
      keywordIds: item.keywordIds,
    })),
  };
}

export function plannerChangedPlan(base: ListingPlan, selected: ListingPlan): boolean {
  return JSON.stringify(base.bulletPlans.map((x) => ({ role: x.role, facts: x.featureFactIds, keywords: x.keywordIds }))) !== JSON.stringify(selected.bulletPlans.map((x) => ({ role: x.role, facts: x.featureFactIds, keywords: x.keywordIds })));
}

export function renderPlannerListing(input: ListingGenerationInput, plan: ListingPlan, brief: ListingKeywordBrief | null) {
  return composeOptimizedListingDraft(input, plan, brief);
}

async function defaultPlannerClient(input: ListingPlannerInput): Promise<unknown> {
  const result = await callAiJson<unknown>({ messages: [{ role: "system", content: "Select only IDs and templates for a deterministic Amazon listing renderer. Never output prose." }, { role: "user", content: buildListingPlannerPrompt(input) }], temperature: 0, maxTokens: 2200, thinkingMode: "disabled" });
  if (!result.ok) throw { code: result.error.code === "timeout" ? "planner_timeout" : result.error.code === "json_parse_error" ? "planner_json_parse_failed" : "planner_provider_error", message: result.error.message };
  return result.data;
}

export async function generateListingPlanDecision(input: ListingPlannerInput): Promise<ListingPlannerResult> {
  let raw: unknown;
  try { raw = await (injectedPlannerClient ?? defaultPlannerClient)(input); } catch (error) {
    const rawCode = isRecord(error) && typeof error.code === "string" ? error.code : "planner_provider_error";
    const code: PlannerErrorCode = ["planner_timeout", "planner_json_parse_failed", "planner_schema_invalid"].includes(rawCode) ? rawCode as PlannerErrorCode : "planner_provider_error";
    return { ok: false, error: { code, message: isRecord(error) ? String(error.message ?? "planner provider error") : "planner provider error", failureStage: code === "planner_timeout" || code === "planner_provider_error" ? "provider" : "parse" } };
  }
  const structural = parsePlannerStructure(raw);
  if (!structural.ok) return { ok: false, error: { code: "planner_schema_invalid", message: structural.message, failureStage: structural.failureStage, schemaFailureCode: structural.schemaFailureCode, ...(structural.unknownKeys ? { unknownKeys: structural.unknownKeys } : {}) } };
  const evaluation = evaluatePlannerSelections(structural.data, input);
  const completed = completePlannerSelections(evaluation.validSelections, buildRendererQualifiedOptions(input), input.plan, input.plan.bulletPlans.length);
  const data: ListingPlannerDecision = { ...structural.data, bullets: completed.selections };
  const selected = applyListingPlannerDecision(input.plan, data);
  return { ok: true, data, changed: plannerChangedPlan(input.plan, selected), rawSelectionCount: structural.data.bullets.length, validSelectionCount: evaluation.validSelections.length, rejectedSelectionCount: evaluation.rejectedSelections.length, filledSelectionCount: completed.filledCount, semanticStatus: evaluation.semanticStatus, validSelections: evaluation.validSelections, rejectedSelections: evaluation.rejectedSelections };
}
