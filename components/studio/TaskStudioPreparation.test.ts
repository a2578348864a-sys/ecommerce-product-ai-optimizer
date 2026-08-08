import { describe, expect, it } from "vitest";
import {
  buildPreparationFactOptions,
  buildPreparationPreferences,
} from "@/components/studio/TaskStudioPreparation";
import type { CreativeHandoffPreview } from "@/components/creative-handoff/types";

describe("buildPreparationFactOptions", () => {
  it("将服务端 confirmableFactCandidates 映射为用户可确认的中文事实选项", () => {
    const preview = {
      eligibility: "eligible",
      candidateFactOptions: [],
      confirmableFactCandidates: [{
        selectionId: "confirm:brand",
        canonicalField: "brand",
        displayValue: "Phase2Brand",
        sourceKindSummary: "candidate_snapshot",
        capturedAt: "2026-08-08T00:00:00.000Z",
        allowedUsageScopes: ["internal", "listing"],
        humanConfirmationRequired: true,
        provenanceSummary: "来源快照，需人工确认。",
      }],
    } satisfies CreativeHandoffPreview;

    expect(buildPreparationFactOptions(preview)).toEqual([{
      selectionId: "confirm:brand",
      field: "brand",
      label: "品牌",
      valueSummary: "Phase2Brand",
    }]);
  });

  it("已有服务端事实选项时保持原始安全投影", () => {
    const projected = [{ selectionId: "confirm:material", field: "material", label: "材质", valueSummary: "steel" }];
    const preview = {
      eligibility: "eligible",
      candidateFactOptions: projected,
      confirmableFactCandidates: [],
    } satisfies CreativeHandoffPreview;

    expect(buildPreparationFactOptions(preview)).toEqual(projected);
  });

  it("空创作偏好不回传，非空偏好仅保留有效字符串", () => {
    expect(buildPreparationPreferences({})).toBeUndefined();
    expect(buildPreparationPreferences({ targetMarket: " US ", tone: "" })).toEqual({ targetMarket: "US" });
  });
});
