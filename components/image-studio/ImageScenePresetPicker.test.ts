import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImageScenePresetPicker } from "@/components/image-studio/ImageScenePresetPicker";
import { normalizeStudioImageCreativeIntent } from "@/lib/studioImageCreativeIntent";

describe("ImageScenePresetPicker lifestyle state contract", () => {
  it("白底禁用生活场景并显示清楚原因", () => {
    const html = renderToStaticMarkup(createElement(ImageScenePresetPicker, {
      value: { primaryImagePurpose: "white_studio", lifestyleScene: "none", customImagePurpose: "" },
      onChange: () => undefined,
    }));

    expect(html).toContain("fieldset disabled=\"\"");
    expect(html).toContain("白底主图要求干净背景，因此不使用生活方式场景。");
    expect(html).toContain("切换到其他图片用途后即可选择。");
  });

  it("白底到细节图可选择户外场景，再切回白底会重置且禁用", () => {
    const detail = normalizeStudioImageCreativeIntent({
      primaryImagePurpose: "detail_closeup",
      lifestyleScene: "none",
      customImagePurpose: "",
    });
    const outdoor = normalizeStudioImageCreativeIntent({ ...detail, lifestyleScene: "outdoor_travel" });
    const white = normalizeStudioImageCreativeIntent({ ...outdoor, primaryImagePurpose: "white_studio" });

    expect(detail.primaryImagePurpose).toBe("detail_closeup");
    expect(outdoor.lifestyleScene).toBe("outdoor_travel");
    expect(white).toEqual({
      primaryImagePurpose: "white_studio",
      lifestyleScene: "none",
      customImagePurpose: "",
    });

    const detailHtml = renderToStaticMarkup(createElement(ImageScenePresetPicker, {
      value: detail,
      onChange: () => undefined,
    }));
    expect(detailHtml).not.toContain("fieldset disabled=\"\"");
  });
});

const NON_WHITE_PURPOSES: Array<{ id: string; label: string; custom?: string }> = [
  { id: "selling_point_infographic", label: "卖点信息图" },
  { id: "dimension_specification", label: "尺寸规格图" },
  { id: "detail_closeup", label: "产品细节特写" },
  { id: "packaging_bundle", label: "包装/套装展示" },
  { id: "usage_steps", label: "使用步骤图" },
  { id: "comparison", label: "对比展示" },
  { id: "custom", label: "自定义", custom: "节日礼赠套装展示" },
];

describe.each(NON_WHITE_PURPOSES)("ImageScenePresetPicker non-white purpose %s", (purpose) => {
  it("keeps lifestyle scenes enabled (disabled=false)", () => {
    const value = normalizeStudioImageCreativeIntent({
      primaryImagePurpose: purpose.id as never,
      lifestyleScene: "none",
      customImagePurpose: purpose.custom ?? "",
    });
    const html = renderToStaticMarkup(createElement(ImageScenePresetPicker, {
      value,
      onChange: () => undefined,
    }));

    expect(html).not.toContain("fieldset disabled=\"\"");
    expect(html).not.toContain("白底主图要求干净背景，因此不使用生活方式场景。");
  });
});
