import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ImageHandoffSection.tsx", import.meta.url), "utf8");

describe("Task Image creation experience", () => {
  it("shows the research-driven MVP flow and a single generate CTA", () => {
    expect(source).toContain("创作描述");
    expect(source).toContain("商品信息");
    expect(source).toContain("参考图");
    expect(source).toContain("图片候选");
    expect(source).toContain("商品身份锁定");
    expect(source).toContain("userCreativeDescription");
    expect(source).toContain("生成图片");
    expect(source).toContain("服务端重新核验后的研究资料");
  });

  it("does not render internal handoff contracts as authoring inputs", () => {
    expect(source).not.toContain('name="creativeHandoff"');
    expect(source).not.toContain('name="binding"');
    expect(source).not.toContain('name="revision"');
    expect(source).not.toContain('name="prompt"');
  });

  it("不显示复杂视觉规划与技术折叠，只保留一个生成入口", () => {
    const generateMatches = source.match(/data-testid="image-handoff-generate"/g);
    expect(generateMatches?.length).toBe(1);
    expect(source).toContain('id="task-image-creative-description"');
    expect(source).not.toContain("VisualAssetPlanCard");
    expect(source).not.toContain("VisualGenerationBriefCard");
    expect(source).not.toContain("ImageScenePresetPicker");
    expect(source).not.toContain("ImageStylePresetPicker");
    expect(source).not.toContain("candidate-trace");
    expect(source).not.toContain("image-creative-details");
  });
});
