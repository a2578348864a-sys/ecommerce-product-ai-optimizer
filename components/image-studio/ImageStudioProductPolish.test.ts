import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImageStudioClient } from "@/components/image-studio/ImageStudioClient";
import {
  ImageResultWorkspace,
  type ImageStudioData,
} from "@/components/image-studio/ImageResultWorkspace";

const result: ImageStudioData = {
  images: [{
    base64: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwv c3ZnPg==".replace(" ", ""),
    width: 800,
    height: 800,
  }],
  meta: {
    mode: "mock",
    creationMode: "guided",
    duplicate: false,
    input: {
      creationMode: "guided",
      productName: "Desk stand",
      description: "Compact aluminum stand",
      imageType: "product_main",
      visualStyle: "minimal",
      stylePresetId: "amazon_clean_hero",
      aspectRatio: "square_1_1",
      count: 1,
      compositionRequirements: "Centered",
      prohibitedElements: "Logo",
    },
    qualityCheck: {
      source: "local_mock_helper",
      logo: "mock_not_added",
      text: "mock_label_present",
      watermark: "mock_not_added",
      descriptionConsistency: "request_context_embedded",
      humanReviewRequired: true,
    },
  },
};

const promptResult: ImageStudioData = {
  images: result.images,
  meta: {
    mode: "mock",
    creationMode: "prompt",
    duplicate: false,
    input: {
      creationMode: "prompt",
      productName: "",
      description: "Matte green glaze",
      aspectRatio: "portrait_4_5",
      count: 1,
      stylePresetId: "premium_editorial",
      promptSummary: "自由提示词方案 · 自定义创意 · 商品主视觉 · 4:5",
      avoidElementsSummary: "logos, watermarks",
    },
    promptSummary: "自由提示词方案 · 自定义创意 · 商品主视觉 · 4:5",
    avoidElementsSummary: "logos, watermarks",
    qualityCheck: {
      source: "local_mock_helper",
      logo: "mock_not_added",
      text: "mock_label_present",
      watermark: "mock_not_added",
      descriptionConsistency: "request_context_embedded",
      humanReviewRequired: true,
    },
  },
};

const realPromptResult: ImageStudioData = {
  images: result.images,
  meta: {
    mode: "real",
    creationMode: "prompt",
    duplicate: false,
    input: {
      creationMode: "prompt",
      productName: "",
      description: "Matte green glaze",
      aspectRatio: "portrait_4_5",
      count: 1,
      stylePresetId: "premium_editorial",
      promptSummary: "自由提示词方案 · 自定义创意 · 商品主视觉 · 4:5",
      avoidElementsSummary: "logos, watermarks",
    },
    promptSummary: "自由提示词方案 · 自定义创意 · 商品主视觉 · 4:5",
    avoidElementsSummary: "logos, watermarks",
    qualityCheck: {
      source: "local_mock_helper",
      logo: "mock_not_added",
      text: "mock_label_present",
      watermark: "mock_not_added",
      descriptionConsistency: "request_context_embedded",
      humanReviewRequired: true,
    },
  },
};

const clientSource = readFileSync(new URL("./ImageStudioClient.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(
  new URL("./ImageStudioPolish.module.css", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../../app/image-studio/page.tsx", import.meta.url),
  "utf8",
);
const requestSource = readFileSync(
  new URL("../../lib/client/studioImageRequest.ts", import.meta.url),
  "utf8",
);

describe("Image Studio product workbench", () => {
  it("guides standalone visitors into a research-linked Image Studio task", () => {
    const html = renderToStaticMarkup(createElement(ImageStudioClient));
    expect(html).toContain("请从商品研究进入图片工作台");
    expect(html).toContain("商品事实、参考图和创作资料确认");
    expect(html).toContain("进入商品研究");
    expect(html).not.toContain("图片主用途");
    expect(html).not.toContain("自由提示词");
  });

  it("renders selectable image cards and a truthful local quality-check workspace", () => {
    const html = renderToStaticMarkup(createElement(ImageResultWorkspace, {
      result,
      selectedIndices: [],
      onToggleSelected: vi.fn(),
    }));

    expect(html).toContain("商品主图");
    expect(html).toContain("极简");
    expect(html).toContain("待人工选择");
    expect(html).toContain("选择图片");
    expect(html).toContain("下载");
    expect(html).toContain("图片质量检查");
    for (const label of ["Logo 检查", "文字检查", "水印检查", "描述一致性检查", "人工复核提示"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("本地辅助检查");
    expect(html).toContain("不等于平台审核");
    expect(html).toContain('data-tone="success"');
  });

  it("keeps the task-linked Image Studio as the only generation entry", () => {
    expect(requestSource).toContain("buildStudioImageRequestCore");
    expect(clientSource).toContain("ImageHandoffSection");
    expect(clientSource).toContain("TaskStudioPreparation");
    expect(clientSource).toContain("请从商品研究进入图片工作台");
    expect(clientSource).not.toContain("ManualImageStudioClient");
    expect(clientSource).not.toContain("自由提示词");
  });

  it("renders Prompt result summary and avoid-elements context without an internal prompt", () => {
    const html = renderToStaticMarkup(createElement(ImageResultWorkspace, {
      result: promptResult,
      selectedIndices: [],
      onToggleSelected: vi.fn(),
    }));

    expect(html).toContain("自由提示词");
    expect(html).toContain("服务端整理");
    expect(html).toContain("提示词摘要");
    expect(html).toContain("自由提示词方案 · 自定义创意 · 商品主视觉 · 4:5");
    expect(html).toContain("避免元素");
    expect(html).toContain("logos, watermarks");
    expect(html).toContain('alt="自由提示词方案的本地预览稿 1"');
    expect(html).not.toContain("Untrusted task context");
  });

  it("uses neutral pending checks for Real results instead of green success semantics", () => {
    const html = renderToStaticMarkup(createElement(ImageResultWorkspace, {
      result: realPromptResult,
      selectedIndices: [],
      onToggleSelected: vi.fn(),
    }));

    expect(html).toContain('data-tone="pending"');
    expect(html).not.toContain('data-tone="success"');
    expect(html).toContain("未自动检查，请人工查看");
    expect(html).toContain("未执行 OCR，请人工查看");
  });

  it("keeps form focus, primary contrast, and readable metadata contracts explicit", () => {
    expect(cssSource).toContain(".strategyOption:has(input:focus-visible)");
    expect(cssSource).toContain(".modeOption:has(input:focus-visible)");
    expect(cssSource).toContain("background: var(--action-primary);");
    expect(cssSource).toContain("color: var(--action-primary-foreground);");

    const cssWithoutDecorativeWaterline = cssSource.replace(
      /\.mockWaterline\s*\{[\s\S]*?\}/,
      "",
    );
    expect(cssWithoutDecorativeWaterline).not.toMatch(
      /font-size:\s*0\.(?:5[5-9]|6[0-7])rem/,
    );
    expect(cssSource.match(/font-size:\s*0\.55rem/g)).toHaveLength(1);
  });

  it("keeps the Image Studio page and delegates research-linked progress to the client", () => {
    expect(pageSource).not.toContain("redirect(");
    expect(pageSource).toContain("ImageStudioClient");
    expect(pageSource).toContain("请先选择研究任务");
    expect(pageSource).toContain("请先从商品研究选择一个任务");
    expect(pageSource).not.toContain("独立创作");
    expect(pageSource).not.toContain('aria-current={index === 0 ? "step" : undefined}');
  });
});
