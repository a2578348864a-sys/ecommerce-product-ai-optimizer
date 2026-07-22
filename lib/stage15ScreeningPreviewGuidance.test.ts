import { TEST_PROJECT_MATERIALS_ROOT } from "../tests/helpers/project-materials";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStage15NoviceGuidance } from "@/lib/stage15ScreeningPreviewGuidance";
import { loadStage15ScreeningPreview } from "@/lib/stage15ScreeningPreviewLoader";
import type { Stage15ScreeningPreviewItem } from "@/lib/stage15ScreeningPreview";

function realItems() {
  const result = loadStage15ScreeningPreview({
    environment: "development",
    projectMaterialsRoot: TEST_PROJECT_MATERIALS_ROOT,
  });
  if (result.status !== "ready") throw new Error(result.errorCode);
  return result.preview.items;
}

function itemWith(
  status: Stage15ScreeningPreviewItem["status"],
  overrides: Partial<Stage15ScreeningPreviewItem> = {},
): Stage15ScreeningPreviewItem {
  const source = realItems().find((item) => item.status === status);
  if (!source) throw new Error(`missing_${status}_fixture`);
  return { ...source, ...overrides };
}

describe("buildStage15NoviceGuidance", () => {
  it("explains a real advance item without turning the Top-K quota into a quality claim", () => {
    const item = realItems().find((candidate) => candidate.status === "advance");
    if (!item) throw new Error("missing_advance_fixture");

    const guidance = buildStage15NoviceGuidance(item);

    expect(guidance.sourceType).toBe("derived_presentation");
    expect(guidance.doesNotChangeDecision).toBe(true);
    expect(guidance.whyThisStatus).toContain("本批最多 5 个");
    expect(guidance.whyThisStatus).toContain("不代表质量");
    expect(guidance.confirmedFacts).toEqual(expect.arrayContaining([
      expect.stringContaining("页面记录价格"),
      expect.stringContaining("页面记录评分"),
      expect.stringContaining("页面记录评论数"),
    ]));
    expect(guidance.unknownFacts).toContain("当前证据包没有记录反向证据；这不等于没有风险。");
    expect(guidance.nextAction).toMatch(/尺寸|衣柜适配/);
    expect(guidance.nextAction).toMatch(/承重|变形|耐用/);
    expect(guidance.stopCondition.length).toBeGreaterThan(0);
  });

  it("separates rating and review references from the Top-K reason and makes the stop rule novice-readable", () => {
    const item = realItems().find((candidate) => candidate.status === "advance");
    if (!item) throw new Error("missing_advance_fixture");

    const guidance = buildStage15NoviceGuidance(item);

    expect(guidance.whyThisStatus).toMatch(/评分.*评论数.*只是参考/);
    expect(guidance.whyThisStatus).toContain("市场资料达到最低要求");
    expect(guidance.whyThisStatus).toContain("理解商品并愿意继续调查");
    expect(guidance.whyThisStatus).toContain("调查名额");
    expect(guidance.whyThisStatus).toMatch(/评论数量.*不是销量/);
    expect(guidance.stopCondition).toMatch(/尺寸.*衣柜.*承重|尺寸.*衣柜.*耐用/);
    expect(guidance.stopCondition).toMatch(/价格.*评分.*评论.*不能替代/);
    expect(guidance.stopCondition).toContain("Stage 1.5");
    expect(guidance.stopCondition).toContain("Stage 2");
    expect(guidance.stopCondition).toMatch(/运费.*利润/);
  });

  it.each([
    ["watch", "保留观察"],
    ["reject", "本批不继续"],
    ["insufficient", "市场证据不足"],
  ] as const)("explains %s without changing its state", (status, expectedCopy) => {
    const item = itemWith(status);
    const before = JSON.stringify(item);

    const guidance = buildStage15NoviceGuidance(item);

    expect(guidance.whyThisStatus).toContain(expectedCopy);
    expect(guidance.doesNotChangeDecision).toBe(true);
    expect(JSON.stringify(item)).toBe(before);
  });

  it("keeps missing metrics unknown instead of inventing zero or a positive conclusion", () => {
    const guidance = buildStage15NoviceGuidance(itemWith("watch", {
      evidence: { price: null, rating: null, reviewCount: null },
      reasons: {
        marketEvidence: [],
        humanGate: [],
        supportingEvidence: [],
        counterEvidence: [],
        missingEvidence: [],
      },
    }));

    expect(guidance.confirmedFacts.join(" ")).not.toMatch(/价格.*0|评分.*0|评论数.*0/);
    expect(guidance.unknownFacts).toEqual(expect.arrayContaining([
      "页面价格尚未获得。",
      "页面评分尚未获得。",
      "页面评论数尚未获得。",
      "当前证据包没有记录反向证据；这不等于没有风险。",
    ]));
  });
});
