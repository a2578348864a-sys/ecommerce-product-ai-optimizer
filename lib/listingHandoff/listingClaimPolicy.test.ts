import { describe, expect, it } from "vitest";
import {
  canonicalClaimTerm,
  classifyClaimPolicy,
  hitsProhibited,
  normalizeClaimText,
  type ClaimPolicyInput,
} from "@/lib/listingHandoff/listingClaimPolicy";

describe("ListingClaimPolicy 红测：规范化与单一裁决出口", () => {
  it("红：空格/连字符同义 — leakproof = leak-proof = leak proof 命中 cannotSay", () => {
    expect(canonicalClaimTerm("leakproof")).toBe("leakproof");
    expect(canonicalClaimTerm("leak-proof")).toBe("leakproof");
    expect(canonicalClaimTerm("Leak Proof")).toBe("leakproof");
    expect(canonicalClaimTerm("leak proof")).toBe("leakproof");
    expect(normalizeClaimText("  Leak  PROOF  ")).toBe("leak proof");
    const prohibited = ["leakproof"];
    expect(hitsProhibited("Leak Proof, Water Bottle", prohibited).hit).toBe(true);
    expect(hitsProhibited("Leak-Proof Tumbler", prohibited).hit).toBe(true);
  });

  it("红：dishwasher-safe = dishwasher safe 同义", () => {
    expect(canonicalClaimTerm("Dishwasher-Safe")).toBe("dishwashersafe");
    expect(canonicalClaimTerm("dishwasher safe")).toBe("dishwashersafe");
    const prohibited = ["dishwasher safe"];
    expect(hitsProhibited("Dishwasher-Safe removable parts", prohibited).hit).toBe(true);
  });

  it("红：cannotSay 优先于 verified（即使有确认事实）", () => {
    const verdict = classifyClaimPolicy({
      field: "functional_feature",
      value: "Leak Proof, Water Bottle",
      explicitHighRiskConfirmed: true,
      prohibited: ["leakproof", "12 hours"],
    });
    expect(verdict.tier).toBe("prohibited");
    expect(verdict.reason.length).toBeGreaterThan(0);
  });

  it("红：历史高风险确认（无 explicit_high_risk 元数据）→ review", () => {
    const verdict = classifyClaimPolicy({
      field: "functional_feature",
      value: "Leak Proof, Water Bottle",
    });
    expect(verdict.tier).toBe("review");
    expect(verdict.reason).toContain("逐项确认");
  });

  it("红：明确逐项确认的高风险事实 + 无违规 → verified", () => {
    const verdict = classifyClaimPolicy({
      field: "functional_feature",
      value: "straw lid with push-open mechanism",
      explicitHighRiskConfirmed: true,
    });
    expect(verdict.tier).toBe("verified");
  });

  it("红：非风险字段（材质）无需元数据 → verified", () => {
    const verdict = classifyClaimPolicy({ field: "material", value: "Stainless Steel" });
    expect(verdict.tier).toBe("verified");
  });

  it("红：空值 → prohibited", () => {
    expect(classifyClaimPolicy({ field: "material", value: "  " }).tier).toBe("prohibited");
  });

  it("红：三条生成路径的输入都消费同一出口（批量保序）", () => {
    const inputs: ClaimPolicyInput[] = [
      { field: "functional_feature", value: "Leak Proof, Water Bottle", explicitHighRiskConfirmed: true, prohibited: ["leakproof"] },
      { field: "functional_feature", value: "straw lid with push-open mechanism", explicitHighRiskConfirmed: true },
      { field: "material", value: "Stainless Steel" },
    ];
    const verdicts = inputs.map((x) => classifyClaimPolicy(x).tier);
    expect(verdicts).toEqual(["prohibited", "verified", "verified"]);
  });
});
