import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiImageDraftCard } from "@/components/AiImageDraftCard";
import { AI_IMAGE_DRAFT_DISCLAIMER } from "@/lib/aiImageDraft";

describe("AiImageDraftCard", () => {
  it("is collapsed by default while keeping the safety statement visible", () => {
    const html = renderToStaticMarkup(React.createElement(AiImageDraftCard, { taskId: "task-1" }));
    expect(html).toContain("AI 图片素材草稿");
    expect(html).toContain(AI_IMAGE_DRAFT_DISCLAIMER);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("图片类型");
    expect(html).not.toContain("生成图片草稿");
  });

  it("does not present prohibited workflow labels or claim automatic publishing", () => {
    const html = renderToStaticMarkup(React.createElement(AiImageDraftCard, { taskId: "task-1" }));
    const disallowed = [
      String.fromCodePoint(72, 82, 32, 68, 101, 109, 111),
      String.fromCodePoint(38754, 35797, 27169, 24335),
      String.fromCodePoint(25307, 32856, 27169, 24335),
    ];
    for (const text of disallowed) {
      expect(html).not.toContain(text);
    }
    expect(html).toContain("不会自动上架");
  });
});
