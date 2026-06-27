import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AI_LISTING_DRAFT_PREVIEW_ENDPOINT,
  AiListingDraftPreviewCard,
  buildAiListingDraftMarkdown,
  getAiListingDraftErrorMessage,
} from "@/components/AiListingDraftPreviewCard";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";

function draft(overrides: Partial<AiListingPackDraft> = {}): AiListingPackDraft {
  return {
    source: "mock_ai_draft",
    version: 1,
    generatedAt: "2026-06-27T10:00:00.000Z",
    model: "mock",
    humanReviewRequired: true,
    titles: ["Test Product for Small Batch Validation", "Test Product Listing Draft"],
    bullets: ["Confirm material and size before publishing.", "Use factual wording for listing copy."],
    description: "A mock AI listing draft for manual review only.",
    keywords: ["test product", "small batch validation", "manual review"],
    sellingPoints: ["Clear use scenario", "Supplier verification pending"],
    riskNotes: ["Check platform rules before publishing."],
    complianceWarnings: ["Blocked unverified listing claims. Human review is required before publishing."],
    blockedClaims: ["FDA Approved", "Medical Grade"],
    reviewChecklist: ["Confirm supplier documents.", "Check platform category rules."],
    ...overrides,
  };
}

const forbiddenTexts = [
  "自动上架成功",
  "AI 已生成",
  "稳赚",
  "爆款必出",
  "保证盈利",
  "100% Safe",
  "FDA Approved",
  "Medical Grade",
];

describe("AiListingDraftPreviewCard", () => {
  it("renders initial state without draft content", () => {
    const html = renderToString(React.createElement(AiListingDraftPreviewCard, { taskId: "task-1" }));

    expect(html).toContain("AI Listing 草稿预览");
    expect(html).toContain("生成草稿预览");
    expect(html).toContain("这是 AI 辅助草稿，不是最终上架文案");
    expect(html).toContain("未生成");
    expect(html).not.toContain("Test Product for Small Batch Validation");
  });

  it("renders generated draft sections from preview state", () => {
    const html = renderToString(React.createElement(AiListingDraftPreviewCard, { taskId: "task-1", initialDraft: draft() }));

    expect(html).toContain("草稿预览已生成");
    expect(html).toContain("标题候选");
    expect(html).toContain("五点描述草稿");
    expect(html).toContain("商品描述草稿");
    expect(html).toContain("关键词 / 长尾词");
    expect(html).toContain("卖点摘要");
    expect(html).toContain("风险提示");
    expect(html).toContain("人工复核清单");
    expect(html).toContain("被拦截的高风险声明");
    expect(html).toContain("复制 Markdown");
  });

  it("maps API errors to readable retry messages", () => {
    expect(getAiListingDraftErrorMessage(401, "unauthorized")).toBe("登录状态已失效，请回首页重新解锁。");
    expect(getAiListingDraftErrorMessage(404, "task_not_found")).toBe("当前任务不存在或已被删除。");
    expect(getAiListingDraftErrorMessage(400, "missing_task_context")).toBe("当前任务信息不足，无法生成 Listing 草稿。");
    expect(getAiListingDraftErrorMessage(500, "invalid_ai_listing_pack")).toBe("生成结果结构异常，请稍后重试。");
    expect(getAiListingDraftErrorMessage(500, "ai_listing_generation_failed")).toBe("Listing 草稿生成失败，请稍后重试。");
    expect(getAiListingDraftErrorMessage(0)).toBe("网络请求失败，请稍后重试。");
  });

  it("builds copy markdown without mixing blocked claims into listing body", () => {
    const markdown = buildAiListingDraftMarkdown(draft());

    expect(markdown).toContain("# AI Listing 草稿预览");
    expect(markdown).toContain("## 标题候选");
    expect(markdown).toContain("## 五点描述草稿");
    expect(markdown).toContain("## 商品描述草稿");
    expect(markdown).toContain("## 关键词 / 长尾词");
    expect(markdown).toContain("## 卖点摘要");
    expect(markdown).toContain("## 风险提示");
    expect(markdown).toContain("## 合规提醒");
    expect(markdown).toContain("## 人工复核清单");
    expect(markdown).toContain("已拦截 2 条未验证声明");
    expect(markdown).not.toContain("FDA Approved");
    expect(markdown).not.toContain("Medical Grade");
  });

  it("keeps forbidden launch and profit claims out of rendered UI and copied markdown", () => {
    const html = renderToString(React.createElement(AiListingDraftPreviewCard, { taskId: "task-1", initialDraft: draft() }));
    const markdown = buildAiListingDraftMarkdown(draft());
    const combined = `${html}\n${markdown}`;

    for (const text of forbiddenTexts) {
      expect(combined).not.toContain(text);
    }
  });

  it("uses only the mock ai-generate endpoint and does not expose save or real AI calls", () => {
    expect(AI_LISTING_DRAFT_PREVIEW_ENDPOINT).toBe("/listing-pack/ai-generate");

    const componentSource = AiListingDraftPreviewCard.toString();
    expect(componentSource).not.toContain("callAiJson");
    expect(componentSource).not.toContain("callAiText");
    expect(componentSource).not.toContain("PATCH");
  });
});
