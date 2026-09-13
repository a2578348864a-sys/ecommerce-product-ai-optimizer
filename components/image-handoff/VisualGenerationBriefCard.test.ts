import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VisualGenerationBriefCard } from "./VisualGenerationBriefCard";

describe("VisualGenerationBriefCard", () => {
  it("renders the 5 core elements of Visual Generation Brief in Task mode", () => {
    const html = renderToStaticMarkup(
      createElement(VisualGenerationBriefCard, {
        mode: "task",
        assetTitle: "槽位 1 · 主图白底合规",
        categoryLabel: "主图合规",
        goal: "突出商品真实物理形态，建立可信第一印象，符合 Amazon 白底主图规范",
        facts: [
          { label: "材质", value: "Stainless Steel" },
          { label: "尺寸", value: "3.5\"L x 3.5\"W x 5.3\"H" },
          { label: "容量", value: "10 oz" },
        ],
        strategy: {
          purposeLabel: "白底主图/棚拍",
          sceneLabel: "纯白背景无杂质",
          styleLabel: "摄影棚纯白底",
          rationale: "聚焦商品主体质感与真实比例，消除背景干扰",
        },
        constraints: [
          "保持商品真实物理外观，禁止篡改外形轮廓与核心部件",
          "严格依据已确认事实，禁止虚构未证实的功能或性能参数",
          "Amazon 白底主图规范：纯白背景，无阴影杂物，无嵌入文字",
        ],
        referenceNotice: {
          title: "参考图创作模式",
          description: "将参考已批准商品图片进行视觉创作，结果仍需人工检查商品外观和文字。",
          isComposition: false,
        },
      }),
    );

    // 1. 标题与模式
    expect(html).toContain("AI 视觉方案 · Visual Generation Brief");
    expect(html).toContain("研究事实驱动");
    expect(html).toContain("主图合规");

    // 2. 资产定位与目标
    expect(html).toContain("01 视觉资产定位与目标");
    expect(html).toContain("槽位 1 · 主图白底合规");
    expect(html).toContain("突出商品真实物理形态，建立可信第一印象，符合 Amazon 白底主图规范");

    // 3. 事实依据驱动
    expect(html).toContain("02 商品事实依据 (Facts Basis)");
    expect(html).toContain("已绑定 3 项事实");
    expect(html).toContain("Stainless Steel");
    expect(html).toContain("3.5&quot;L x 3.5&quot;W x 5.3&quot;H");
    expect(html).toContain("10 oz");

    // 4. 视觉策略
    expect(html).toContain("03 视觉策略组合 (Visual Strategy)");
    expect(html).toContain("白底主图/棚拍");
    expect(html).toContain("纯白背景无杂质");
    expect(html).toContain("摄影棚纯白底");
    expect(html).toContain("聚焦商品主体质感与真实比例，消除背景干扰");

    // 5. 约束与安全底线
    expect(html).toContain("04 生成约束与安全底线");
    expect(html).toContain("保持商品真实物理外观，禁止篡改外形轮廓与核心部件");
    expect(html).toContain("参考图创作模式");
    expect(html).toContain("将参考已批准商品图片进行视觉创作，结果仍需人工检查商品外观和文字。");
  });

  it("renders truthful non-fact disclaimer in Standalone mode without fabricating confirmed facts", () => {
    const html = renderToStaticMarkup(
      createElement(VisualGenerationBriefCard, {
        mode: "standalone",
        assetTitle: "独立创意草稿",
        categoryLabel: "自由创意",
        goal: "根据填写的商品描述与选择的用途/风格，生成电商视觉概念参考。",
        strategy: {
          purposeLabel: "生活使用场景",
          sceneLabel: "家居生活",
          styleLabel: "自然生活纪实",
          rationale: "用途优先匹配电商图片展示层级，风格辅助增强视觉质感",
        },
        constraints: [
          "保持基础物理常识与真实比例，禁止生成违规/侵权内容",
          "独立创作模式没有商品研究事实约束，生成内容切勿用于未经核实的参数宣传",
        ],
        referenceNotice: {
          title: "概念创作模式",
          description: "当前没有已确认商品参考图。生成结果用于构图、场景和视觉方向参考，不代表真实商品外观。",
          isComposition: true,
        },
      }),
    );

    expect(html).toContain("AI 视觉方案 · Visual Generation Brief");
    expect(html).toContain("自由创意模式");
    expect(html).toContain("无研究事实");
    expect(html).toContain("⚠ 独立创作未绑定商品研究任务");
    expect(html).toContain("用户提供内容由你自行输入，未经商品研究验证，不属于商品事实。生成结果仅供概念与构图参考。");
    expect(html).not.toContain("已绑定");
    expect(html).toContain("概念创作模式");
  });
});
