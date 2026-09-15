import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FreeCreationForm } from "./FreeCreationForm";
import { ImageStudioClient } from "./ImageStudioClient";

describe("FreeCreationForm and ImageStudioClient Dual-Track Semantics", () => {
  it("renders FreeCreationForm with all required minimalist creation controls", () => {
    const html = renderToStaticMarkup(
      createElement(FreeCreationForm, {
        values: {
          creativePrompt: "极简白底陶瓷马克杯",
          aspectRatio: "square_1_1",
          count: 1,
        },
        onChange: vi.fn(),
        onSubmit: vi.fn(),
      }),
    );

    expect(html).toContain("data-testid=\"free-creation-form\"");
    expect(html).toContain("自定义图片描述");
    expect(html).toContain("极简白底陶瓷马克杯");
    expect(html).toContain("快速模板（一键填入描述）");
    expect(html).toContain("白底主图");
    expect(html).toContain("生活场景");
    expect(html).toContain("细节特写");
    expect(html).toContain("广告素材");
    expect(html).toContain("图片比例");
    expect(html).toContain("1:1 方图");
    expect(html).toContain("4:5 竖图");
    expect(html).toContain("16:9 横图");
    expect(html).toContain("生成数量");
    expect(html).toContain("1 张");
    expect(html).toContain("2 张");
    expect(html).toContain("上传参考图");
    expect(html).toContain("data-testid=\"free-creation-submit-btn\"");
    expect(html).toContain("生成图片");
  });

  it("renders standalone minimalist creation interface when taskId is empty", () => {
    const html = renderToStaticMarkup(createElement(ImageStudioClient, { taskId: "" }));

    expect(html).toContain("data-testid=\"image-studio-standalone-flow\"");
    expect(html).toContain("data-testid=\"image-mode-standalone\"");
    expect(html).toContain("独立生图工具");
    expect(html).toContain("data-testid=\"free-creation-form\"");
    expect(html).toContain("data-testid=\"free-creation-submit-btn\"");
    expect(html).not.toContain("data-testid=\"image-studio-task-flow\"");
  });

  it("renders task-linked handoff flow when taskId is provided", () => {
    const html = renderToStaticMarkup(createElement(ImageStudioClient, { taskId: "task-abc-123" }));

    expect(html).toContain("data-testid=\"image-studio-task-flow\"");
    expect(html).toContain("data-testid=\"image-mode-task-linked\"");
    expect(html).toContain("来自研究记录");
    expect(html).not.toContain("data-testid=\"free-creation-form\"");
  });
});
