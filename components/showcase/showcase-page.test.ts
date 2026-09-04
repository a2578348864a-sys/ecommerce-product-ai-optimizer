import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ShowcasePage } from "./ShowcasePage";
import { showcaseContent } from "@/content/showcase";

describe("公网 HR 展示页骨架（静态单页契约）", () => {
  const html = renderToStaticMarkup(createElement(ShowcasePage));

  it("Hero 首屏 5 秒看懂：中英文双标语与两大核心 CTA 滚动锚点", () => {
    expect(html).toContain("轻选工作台");
    expect(html).toContain("Evidence-driven AI Commerce Workbench");
    expect(html).toContain("面向跨境电商商品研究与 Amazon 上架准备");
    expect(html).toContain("▶ 观看真实演示");
    expect(html).toContain("查看项目亮点");
    expect(html).toContain("GitHub ↗");
    expect(html).toContain("https://github.com/a2578348864a-sys/ecommerce-product-ai-optimizer");
  });

  it("视频区域具备 16:9 占位状态，预留 90 秒标签与未来路径，零假视频", () => {
    expect(html).toContain('id="demo-video"');
    expect(html).toContain("真实项目演示");
    expect(html).toContain("演示视频准备中");
    expect(html).toContain("90 秒");
    expect(html).toContain("aspect-video");
    // 当 src 为 null 时，不应渲染任何视频源地址
    expect(showcaseContent.video.src).toBeNull();
    expect(showcaseContent.video.futureSrcPath).toBe("/showcase/video/project-demo.mp4");
  });

  it("Slider 固定预留 5 张 Slide，顺序与正式文案完整精确对齐", () => {
    expect(showcaseContent.slides).toHaveLength(5);
    const expectedTitles = [
      "这个项目解决什么问题",
      "从商品研究到内容产出的完整主链",
      "商品研究不是只看一个数据源",
      "研究资料 ≠ 商品事实",
      "最终输出仍然需要人工审核",
    ];
    showcaseContent.slides.forEach((slide, idx) => {
      expect(slide.title).toBe(expectedTitles[idx]);
      expect(html).toContain(slide.title);
      expect(html).toContain(slide.eyebrow);
      expect(html).toContain(slide.description);
      expect(slide.image).toBeNull();
    });
  });

  it("Slide 在 image=null 时优雅渲染 Visual coming soon 占位，无破图或红字", () => {
    expect(html).toContain("Visual coming soon");
    expect(html).not.toContain("图片待上传");
    expect(html).not.toContain("broken");
  });

  it("核心主链四卡大白话呈现，无晦涩技术词堆砌", () => {
    expect(html).toContain("Research Input");
    expect(html).toContain("Evidence");
    expect(html).toContain("Human Confirmed Facts");
    expect(html).toContain("Controlled Output");
    expect(html).toContain("关键词 / 竞品 / VOC / 1688 / 成本风险");
    expect(html).toContain("整理来源、冲突与未知信息");
    expect(html).toContain("由人决定哪些内容是真实商品事实");
    expect(html).toContain("Listing / Image 草稿进入人工复核");
  });

  it("我的工作 4 项职责客观陈述，无夸大与贬低，状态徽章诚实克制", () => {
    expect(html).toContain("这个项目我具体做了什么");
    expect(html).toContain("以 AI Coding 为主要开发方式，完成产品设计、任务拆解、实现推进、验证与迭代收口。");
    expect(html).toContain("从需求到产品主链设计");
    expect(html).toContain("AI 辅助开发与前后端实现");
    expect(html).toContain("数据 / Evidence / Fact 权限边界设计");
    expect(html).toContain("Listing / Image 生成链与真实浏览器验收");

    // 状态徽章
    expect(html).toContain("V4.1 · Final Frozen Baseline");
    expect(html).toContain("Business Flow Complete");
    expect(html).toContain("CI Verified");
    expect(html).toContain("Human-in-the-Loop");
    expect(html).toContain("Local Production Workflow");

    // 严禁出现的过度夸大商业词
    for (const forbidden of [
      "Commercial Ready",
      "Enterprise Grade",
      "Production SaaS",
      "100% Autonomous",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("Footer 极简合规，无敏感信息泄露", () => {
    expect(html).toContain("本页面为项目展示入口。完整工程、测试与冻结基线见 GitHub。");
    // 绝无服务器 IP、密码、本地绝对路径
    expect(html).not.toContain("112.124.54.81");
    expect(html).not.toContain("D:\\Workspace");
    expect(html).not.toContain("password");
  });
});
