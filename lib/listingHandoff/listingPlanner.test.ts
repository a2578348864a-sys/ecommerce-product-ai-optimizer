import { describe, expect, it, afterEach } from "vitest";
import type { ListingGenerationInput } from "./listingGenerationInput";
import type { ListingPlan } from "./listingPlan";
import { applyListingPlannerDecision, buildFinalizablePlannerCatalog, buildListingPlannerPrompt, buildPlannerPromptView, completePlannerSelections, completePlannerSelectionsToFinalizablePlan, evaluatePlannerSelections, generateListingPlanDecision, buildRendererQualifiedOptions, LISTING_PLANNER_SCHEMA_VERSION, renderPlannerListing, setListingPlannerClientForTests, validateListingPlannerDecision } from "./listingPlanner";
import { composeControlledBullets } from "./listingComposition";

const input: ListingGenerationInput = {
  schema: "listing-generation-input.v1", source: { handoffRevision: 1, researchRevision: 1 },
  productFacts: [
    { field: "brand", label: "Brand", value: "Acme" },
    { field: "product_type", label: "Product type", value: "Storage organizer" },
    { field: "material", label: "Material", value: "Ceramic" },
    { field: "capacity", label: "Capacity", value: "3 compartments" },
    { field: "included_components", label: "Included components", value: "Divider tray" },
    { field: "usage", label: "Usage", value: "Countertop storage" },
  ],
  stableSourceFacts: [], creativeReferences: [], creativePreferences: {}, prohibitedClaims: [], unknowns: [], humanReviewRequired: true, researchMode: "market_research_only", promotionEligible: false,
  creativeContext: { vocInsights: ["research only"], aiReferences: [], keywordCandidates: ["competitor claim"], competitiveContext: [], sourcingContext: [] },
};
const plan: ListingPlan = {
  schema: "listing-plan.v2", status: "ready", primaryKeyword: null, supportingKeywords: [], backendSearchTerms: [], missingFacts: [], prohibitedClaims: [], planQuality: "optimized",
  titlePlan: ["brand", "product_type"],
  bulletPlans: [
    { role: "core_outcome", shopperNeed: "identity", shopperAngle: "material", featureFactIds: ["material"], keywordIds: [], claimMode: "verified", cannotSay: [] },
    { role: "pain_relief", shopperNeed: "capacity", shopperAngle: "capacity", featureFactIds: ["capacity"], keywordIds: [], claimMode: "verified", cannotSay: [] },
    { role: "use_scenario", shopperNeed: "use", shopperAngle: "use", featureFactIds: ["usage"], keywordIds: [], claimMode: "verified", cannotSay: [] },
    { role: "ease_of_use", shopperNeed: "included", shopperAngle: "included", featureFactIds: ["included_components"], keywordIds: [], claimMode: "verified", cannotSay: [] },
  ],
  descriptionPlan: "brand, product type and material",
};

const valid = { schemaVersion: LISTING_PLANNER_SCHEMA_VERSION, title: { factIds: ["brand", "product_type"], keywordIds: [] }, bullets: [
  { role: "use_scenario", factIds: ["usage"], keywordIds: [], templateId: "use_scenario_a" },
  { role: "core_outcome", factIds: ["material"], keywordIds: [], templateId: "core_outcome_a" },
  { role: "pain_relief", factIds: ["capacity"], keywordIds: [], templateId: "pain_relief_a" },
], description: { factIds: ["brand", "material"] }, backendKeywordIds: [] };

describe("deterministic listing planner", () => {
  afterEach(() => setListingPlannerClientForTests(null));

  it("phase 1 spike renders title, three distinct bullets and description without a provider", () => {
    const selected = applyListingPlannerDecision(plan, valid as never);
    const rendered = renderPlannerListing(input, selected, null);
    expect(rendered.titles[0]).toBeTruthy();
    expect(rendered.bullets.length).toBeGreaterThanOrEqual(3);
    expect(new Set(selected.bulletPlans.map((bp) => bp.featureFactIds[0])).size).toBeGreaterThanOrEqual(3);
    expect(rendered.description).toBeTruthy();
    expect(rendered.titles.join(" ") + rendered.bullets.join(" ") + rendered.description).not.toMatch(/13\s*lb|BPA-free|waterproof/i);
  });

  it("rejects prose, research ids, duplicate roles and invalid templates", () => {
    expect(validateListingPlannerDecision({ ...valid, titleText: "invented prose" }, { facts: input.productFacts.map((f) => ({ ...f, factId: f.field })), plan, keywordBrief: null, listingBrief: null, prohibitedClaims: [], creativeContext: input.creativeContext }).ok).toBe(false);
    expect(validateListingPlannerDecision({ ...valid, bullets: [{ ...valid.bullets[0], factIds: ["research-only"] }, ...valid.bullets.slice(1)] }, { facts: input.productFacts.map((f) => ({ ...f, factId: f.field })), plan, keywordBrief: null, listingBrief: null, prohibitedClaims: [], creativeContext: input.creativeContext }).ok).toBe(false);
    expect(validateListingPlannerDecision({ ...valid, bullets: valid.bullets.map((b) => ({ ...b, role: "use_scenario" })) }, { facts: input.productFacts.map((f) => ({ ...f, factId: f.field })), plan, keywordBrief: null, listingBrief: null, prohibitedClaims: [], creativeContext: input.creativeContext }).ok).toBe(false);
    expect(validateListingPlannerDecision({ ...valid, bullets: [{ ...valid.bullets[0], templateId: "freeform_copy" }, ...valid.bullets.slice(1)] }, { facts: input.productFacts.map((f) => ({ ...f, factId: f.field })), plan, keywordBrief: null, listingBrief: null, prohibitedClaims: [], creativeContext: input.creativeContext }).ok).toBe(false);
  });

  it("builds a minimal wire prompt and exposes bounded schema diagnostics", () => {
    const plannerInput = { facts: input.productFacts.map((f) => ({ ...f, factId: f.field })), plan, keywordBrief: null, listingBrief: null, prohibitedClaims: [], creativeContext: input.creativeContext };
    const view = buildPlannerPromptView(plannerInput);
    expect(view.availableBulletOptions[0]).toEqual(expect.objectContaining({ role: "core_outcome", factIds: ["material"], templateId: "core_outcome_a", keywordIds: [] }));
    const prompt = buildListingPlannerPrompt(plannerInput);
    for (const forbidden of ["shopperNeed", "shopperAngle", "claimMode", "cannotSay", "titleText", "bulletText", "descriptionText", "generatedValue"]) expect(prompt).not.toContain(forbidden);
    const invalid = validateListingPlannerDecision({ ...valid, bullets: [{ ...valid.bullets[0], shopperNeed: "free prose" }, ...valid.bullets.slice(1)] }, plannerInput);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) { expect(invalid.failureStage).toBe("schema"); expect(invalid.schemaFailureCode).toBe("bullet_extra_keys"); expect(invalid.unknownKeys).toEqual(["shopperNeed"]); }
    const exampleLine = prompt.split("\n").find((line) => line.startsWith("OUTPUT_SCHEMA="))!;
    const example = JSON.parse(exampleLine.slice("OUTPUT_SCHEMA=".length));
    expect(validateListingPlannerDecision(example, plannerInput).ok).toBe(true);
  });

  it("falls back cleanly when the planner provider fails and never retries", async () => {
    let calls = 0;
    setListingPlannerClientForTests(async () => { calls += 1; throw { code: "planner_timeout", message: "timeout" }; });
    const result = await generateListingPlanDecision({ facts: input.productFacts.map((f) => ({ ...f, factId: f.field })), plan, keywordBrief: null, listingBrief: null, prohibitedClaims: [], creativeContext: input.creativeContext });
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it("keeps valid preferences and deterministically fills rejected selections", () => {
    const plannerInput = { facts: input.productFacts.map((f) => ({ ...f, factId: f.field })), plan, keywordBrief: null, listingBrief: null, prohibitedClaims: [], creativeContext: input.creativeContext };
    const partial = { ...valid, bullets: [valid.bullets[0], { ...valid.bullets[1], role: "unknown_role" }, valid.bullets[2]] };
    const structural = validateListingPlannerDecision(valid, plannerInput);
    expect(structural.ok).toBe(true);
    if (!structural.ok) return;
    const decision = { ...structural.data, bullets: partial.bullets as never };
    const evaluation = evaluatePlannerSelections(decision, plannerInput);
    expect(evaluation.validSelections).toHaveLength(2);
    expect(evaluation.rejectedSelections[0]?.reasonCode).toBe("invalid_role");
    expect(evaluation.semanticStatus).toBe("partial");
    const completed = completePlannerSelections(evaluation.validSelections, buildRendererQualifiedOptions(plannerInput), plan, 3);
    expect(completed.filledCount).toBe(1);
    expect(completed.selections).toHaveLength(3);
    expect(new Set(completed.selections.map((item) => item.role)).size).toBe(3);
  });

  it("keeps fact and role provenance aligned when a middle plan group is skipped", () => {
    const controlled = composeControlledBullets(input, {
      ...plan,
      bulletPlans: [
        { ...plan.bulletPlans[0], featureFactIds: ["material"] },
        { ...plan.bulletPlans[1], featureFactIds: ["missing_fact"] },
        { ...plan.bulletPlans[2], featureFactIds: ["usage"] },
      ],
    });
    expect(controlled.bullets).toHaveLength(2);
    expect(controlled.factRefsByBullet.map((refs) => refs[0]?.field)).toEqual(["material", "usage"]);
    expect(controlled.rolesByBullet).toEqual(["core_outcome", "use_scenario"]);
  });

  it("builds a finalizable plan catalog and deterministically binds partial selections", () => {
    const plannerInput = { facts: input.productFacts.map((f) => ({ ...f, factId: f.field })), plan, keywordBrief: null, listingBrief: null, prohibitedClaims: [], creativeContext: input.creativeContext };
    const catalog = buildFinalizablePlannerCatalog(plannerInput, 4);
    expect(catalog.plans.length).toBeGreaterThan(0);
    expect(catalog.plans.every((candidate) => candidate.plan.bulletPlans.length >= 3 && candidate.plan.bulletPlans.length <= 4)).toBe(true);
    const partial = [valid.bullets[0], valid.bullets[1]] as never;
    const bound = completePlannerSelectionsToFinalizablePlan(partial, catalog);
    expect(bound.plan).not.toBeNull();
    expect(bound.retainedCount).toBeGreaterThanOrEqual(1);
    expect(bound.filledCount).toBeGreaterThanOrEqual(1);
    const reconstructedCore = bound.plan!.plan.bulletPlans.find((bp) => bp.role === "core_outcome");
    expect(reconstructedCore).toEqual(expect.objectContaining({ shopperNeed: "identity", shopperAngle: "material", claimMode: "verified", cannotSay: [] }));
  });
});
