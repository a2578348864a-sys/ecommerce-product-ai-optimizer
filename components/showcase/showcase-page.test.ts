import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ShowcasePage } from "./ShowcasePage";
import { showcaseContent } from "@/content/showcase";

describe("公网展示页增强契约（静态单页渲染契约）", () => {
  const html = renderToStaticMarkup(createElement(ShowcasePage));

  it("Hero 首屏具备量子光尘挂载点与纯净大气单栏居中排版", () => {
    expect(html).toContain("轻选工作台");
    expect(html).toContain("让 AI 帮你做电商：查得准、写得真、绝不瞎编");
    expect(html).toContain("杜绝 AI 凭空编造卖点");
    expect(html).toContain("4 路真实数据同屏核对");
    expect(html).toContain("运营确认后再一键出稿");
    expect(html).toContain("GitHub 源码");
    expect(html).toContain("https://github.com/a2578348864a-sys/ecommerce-product-ai-optimizer");
  });

  it("视频区域具备 16:9 占位状态，预留 90 秒标签，零假视频", () => {
    expect(html).toContain('id="demo-video"');
    expect(html).toContain("核心业务闭环实操演示");
    expect(html).toContain("演示视频准备中");
    expect(html).toContain("90 秒");
    expect(html).toContain("aspect-video");
    expect(showcaseContent.video.src).toBeNull();
    expect(showcaseContent.video.futureSrcPath).toBe("/showcase/video/project-demo.mp4");
  });

  it("Slider 5 张 Slide 全部具备白瓷极简浏览器视窗标题栏与左右居中切换大按钮", () => {
    expect(showcaseContent.slides).toHaveLength(5);
    const expectedTitles = [
      "普通 AI 写文案，太容易瞎编乱造",
      "从选品调研到一键出图的完整全流程",
      "找资料不只看一家，多维度对比才靠谱",
      "网上资料 ≠ 最终卖点（核心红线）",
      "文案图片做好了，运营确认好直接上架",
    ];
    showcaseContent.slides.forEach((slide, idx) => {
      expect(slide.title).toBe(expectedTitles[idx]);
      expect(html).toContain(slide.title);
      expect(html).toContain(slide.eyebrow);
      expect(html).toContain(slide.description);
      expect(slide.image).toBeTruthy();
      expect(slide.image).toContain(".png");
    });

    // 验证白瓷极简浏览器视窗与图片两边切换按钮特征
    expect(html).toContain("app.qingxuan.io");
    expect(html).toContain("事实受控模式");
    expect(html).toContain("点击放大");
    expect(html).toContain('aria-label="查看上一张大图"');
    expect(html).toContain('aria-label="查看下一张大图"');
  });

  it("核心工作流导轨具备光子数据流动与工程步进检视器", () => {
    expect(html).toContain("怎么帮你把商品做起来？");
    expect(html).toContain("自动挖全网资料");
    expect(html).toContain("过滤吹牛假大空");
    expect(html).toContain("运营一眼核对");
    expect(html).toContain("自动出文案与图片");
    expect(html).toContain("全网真实资料汇总");
    expect(html).toContain("放心拿去用 · 随时可上架");
  });

  it("工程交付职责客观陈述，无夸大与贬低，状态徽章诚实克制", () => {
    expect(html).toContain("这个项目我具体做了什么");
    expect(html).toContain("针对跨境卖家害怕 AI 瞎编导致退货封店的痛点");
    expect(html).toContain("实操验证 · 交付基线");
    expect(html).toContain("全流程业务闭环");
    expect(html).toContain("自动化测试保障");
    expect(html).toContain("彻底杜绝 AI 瞎编");

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
    expect(html).toContain("轻选工作台");
    expect(html).toContain("专为跨境卖家打造的智能商品研究与内容创作工具。源码与工程沉淀已开源在 GitHub。");
    expect(html).toContain("返回顶部");
    // 绝无服务器 IP、密码、本地绝对路径
    expect(html).not.toContain("112.124.54.81");
    expect(html).not.toContain("D:\\Workspace");
    expect(html).not.toContain("password");
  });

  it("方案 A+ 动效组件（SpotlightCard, CountUp, ShinyText）静态渲染结构完整", () => {
    // 验证 ShinyText 在 CTA 按钮上渲染
    expect(html).toContain("观看 90 秒完整演示");
    expect(html).toContain("animate-shimmer");

    // 验证 CountUp 初始数值与业务标签（SSR 从 0 起步，避免客户端水合不一致）
    expect(html).toContain("0 违规");
    expect(html).toContain("0 项");
    expect(html).toContain("0 路");
    expect(html).toContain("不合规词汇");
    expect(html).toContain("真实资料出处");
    expect(html).toContain("核心数据对比");
    expect(html).toContain("自动化防错测试");

    // 验证 SpotlightCard 聚光灯层存在
    expect(html).toContain("radial-gradient");
  });

  it("方案 C：GitHub 仓库入口双重强化（顶部曜石黑高反差胶囊 + 第四屏沉淀区直达大横幅）", () => {
    // 顶部导航栏高反差曜石黑胶囊与 Octocat 矢量
    expect(html).toContain("bg-slate-950");
    expect(html).toContain("GitHub 源码");

    // 第四屏开发沉淀区直达大横幅卡片
    expect(html).toContain("查验完整开源代码与工程实现");
    expect(html).toContain("查阅 GitHub 仓库");
    expect(html).toContain("代码开源 · 真实可证");
    expect(html).toContain("134 项防错自动化测试");
  });
});

