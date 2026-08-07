import { describe, expect, it } from "vitest";
import { deriveUserProgressSummary } from "./userProgressSummary";

function build(input: {
  artifactKeys?: string[];
  decisionStatus?: string;
  result?: Record<string, unknown>;
} = {}) {
  return deriveUserProgressSummary({
    stageLabel: "待人工确认",
    artifactKeys: input.artifactKeys ?? [],
    decisionStatus: input.decisionStatus ?? "pending",
    result: input.result ?? {},
  });
}

describe("用户进度摘要：严格推进顺序", () => {
  it("研究未完成 → 下一步：完成商品研究", () => {
    const s = build({ artifactKeys: [] });
    expect(s.missing).toBe("完成商品研究");
    expect(s.next).toBe("完成商品研究");
    expect(s.completed).toBe("尚未保存研究结论");
  });

  it("研究完成、人工决定未完成 → 下一步：完成人工决定（不提前提示 Listing）", () => {
    const s = build({
      artifactKeys: ["market_analysis", "listing_draft", "image_plan"],
      decisionStatus: "need_info",
    });
    expect(s.missing).toBe("完成人工决定");
    expect(s.next).toBe("完成人工决定");
    // 不得提前提示生成 Listing
    expect(s.next).not.toContain("Listing");
    // 文案区分：已有准备信息 ≠ 已生成
    expect(s.completed).toContain("已有 Listing 准备信息");
    expect(s.completed).toContain("已有图片创作参考");
    expect(s.completed).not.toContain("已生成");
  });

  it("人工决定 continue、Handoff 未完成 → 下一步：进入创作交接", () => {
    const s = build({
      artifactKeys: ["market_analysis", "human_conclusion", "listing_draft", "image_plan"],
      decisionStatus: "continue",
    });
    expect(s.missing).toBe("进入创作交接确认事实与视觉参考");
    expect(s.next).toBe("进入创作交接");
  });

  it("Handoff 完成、Listing 未生成 → 下一步：生成 Listing 草稿", () => {
    const s = build({
      artifactKeys: ["market_analysis", "human_conclusion", "listing_draft", "image_plan"],
      decisionStatus: "continue",
      result: { creativeHandoff: { handoffId: "h1" } },
    });
    expect(s.missing).toBe("生成 Listing 草稿");
    expect(s.next).toBe("生成 Listing 草稿");
    expect(s.completed).toContain("创作交接");
    expect(s.completed).toContain("已有 Listing 准备信息");
  });

  it("Listing 已生成（aiListingPackSnapshot 落库）、图片未生成 → 下一步：生成产品图片", () => {
    const s = build({
      artifactKeys: ["market_analysis", "human_conclusion", "listing_draft", "image_plan"],
      decisionStatus: "continue",
      result: {
        aiListingPackSnapshot: {
          titles: ["Portable LED Desk Lamp"],
          bullets: ["b1", "b2"],
          keywords: ["led desk lamp"],
        },
      },
    });
    expect(s.missing).toBe("生成产品图片");
    expect(s.next).toBe("生成产品图片");
    expect(s.completed).toContain("Listing 草稿已生成");
    expect(s.completed).not.toContain("已有 Listing 准备信息");
  });

  it("Listing + 图片完成 → 下一步：人工复核最终内容", () => {
    const s = build({
      artifactKeys: ["market_analysis", "human_conclusion", "listing_draft", "image_plan"],
      decisionStatus: "continue",
      result: {
        aiListingPackSnapshot: { titles: ["t1"], bullets: ["b1"] },
        aiImageDraftSnapshot: { items: [{ id: "img-1" }] },
      },
    });
    expect(s.missing).toBe("人工复核最终内容");
    expect(s.next).toBe("人工复核最终内容");
    expect(s.completed).toContain("Listing 草稿已生成");
    expect(s.completed).toContain("产品图片已生成");
  });
});
