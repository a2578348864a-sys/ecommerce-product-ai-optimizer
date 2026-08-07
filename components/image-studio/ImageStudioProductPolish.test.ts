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
  it("renders product information, image strategy, generation settings, constraints, and mode inputs", () => {
    const html = renderToStaticMarkup(createElement(ImageStudioClient));

    for (const heading of ["商品信息", "图片策略", "生成设置", "补充要求"]) {
      expect(html).toContain(heading);
    }
    for (const label of [
      "商品名称",
      "商品描述",
      "图片类型",
      "视觉风格",
      "图片数量",
      "宽高比例",
      "构图要求",
      "禁止元素",
    ]) {
      expect(html).toContain(label);
    }
    for (const option of [
      "商品主图",
      "场景图",
      "卖点展示图",
      "广告素材",
      "极简",
      "高端",
      "科技",
      "家居",
      "户外",
      "品牌广告",
    ]) {
      expect(html).toContain(option);
    }
    expect(html).toContain("引导生成");
    expect(html).toContain("自由提示词");
    expect(html).toContain("Mock 预览");
    expect(html).toContain("本地确定性预览，不调用 Provider");
    expect(html).toContain("图片工作区");
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

  it("keeps four prompt templates as fill-only controls and wires bounded prompt fields", () => {
    for (const template of ["白底主图", "生活场景", "细节特写", "广告素材"]) {
      expect(requestSource).toContain(template);
    }
    expect(clientSource).toContain('type="button"');
    expect(clientSource).toContain('role="group"');
    expect(clientSource).toContain('name="creativePrompt"');
    expect(clientSource).toContain('maxLength={1200}');
    expect(clientSource).toContain('name="avoidElements"');
    expect(clientSource).toContain('maxLength={400}');
    expect(clientSource).toContain("模板只填充起始内容，不会自动提交");
    expect(clientSource).toContain("服务端会构造最终权威 Prompt");
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
    expect(html).toContain('alt="自由提示词方案的本地 Mock 预览 1"');
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

  it("redirects Studio pages to task detail and does not claim a live production step", () => {
    // R1: Image Studio 已收敛到任务详情；页面只保留安全重定向，不渲染客户端工作台
    expect(pageSource).toContain("redirect");
    expect(pageSource).toMatch(/redirect\(`\/tasks\//);
    expect(pageSource).not.toContain("ImageStudioClient");
  });
});
