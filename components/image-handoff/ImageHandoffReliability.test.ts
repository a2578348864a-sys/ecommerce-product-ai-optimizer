import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ImageHandoffSection.tsx", import.meta.url), "utf8");

describe("Task Image creation experience", () => {
  it("shows the editable description, split purpose/scene intent, clear visual authority, and a single generate CTA", () => {
    expect(source).toContain("创作描述");
    expect(source).toContain("系统已根据本次研究资料整理了一版图片创作描述，你可以修改后再生成。");
    expect(source).toContain("概念创作模式");
    expect(source).toContain("参考图创作模式");
    expect(source).toContain("当前没有已确认商品参考图。生成结果用于构图、场景和视觉方向参考，不代表真实商品外观。");
    expect(source).toContain("将参考已批准商品图片进行视觉创作，结果仍需人工检查商品外观和文字。");
    expect(source).toContain("userCreativeDescription");
    expect(source).toContain("primaryImagePurpose");
    expect(source).toContain("lifestyleScene");
    expect(source).toContain("customImagePurpose");
    expect(source).toContain("useSessionDraft");
    expect(source).not.toContain("confirmedFacts:");
    expect(source).not.toContain("prohibitedClaims:");
    expect(source).toContain("生成图片");
    expect(source).not.toContain('submitting ? "正在生成..." : isComposition ? "生成构图概念"');
  });

  it("does not render internal handoff contracts as authoring inputs", () => {
    expect(source).not.toContain('name="creativeHandoff"');
    expect(source).not.toContain('name="binding"');
    expect(source).not.toContain('name="revision"');
    expect(source).not.toContain('name="prompt"');
  });

  it("遵循 IMAGE_STUDIO_UI_CLOSURE_V1 契约", () => {
    // 1. 紧凑设置卡与摘要
    expect(source).toContain("图片创作设置");
    expect(source).toContain('data-testid="image-creation-compact-summary"');
    expect(source).toContain("当前模式：");
    expect(source).toContain("当前主题：");
    expect(source).toContain("人工审核：");

    // 2. 创作描述与生成约束默认折叠
    expect(source).toContain('data-testid="image-creative-details"');
    expect(source).not.toMatch(/<details[^>]*data-testid="image-creative-details"[^>]*open/);

    // 3. 历史草稿默认折叠
    expect(source).toContain('data-testid="task-image-history-drafts"');
    expect(source).not.toMatch(/<details[^>]*data-testid="task-image-history-drafts"[^>]*open/);

    // 4. 单一生成按钮
    const generateMatches = source.match(/data-testid="image-handoff-generate"/g);
    expect(generateMatches?.length).toBe(1);

    // 5. 展开后创作描述与约束说明仍存在
    expect(source).toContain("查看 / 调整创作描述与生成约束");
    expect(source).toContain('id="task-image-creative-description"');
  });
});
