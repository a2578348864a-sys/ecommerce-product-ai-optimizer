import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  VisualGenerationBriefCard,
  factKindLabel,
  factSatisfiesRequiredKind,
  selectPreviewFacts,
  truncateAtWordBoundary,
  type VisualGenerationPreview,
} from "./VisualGenerationBriefCard";
import { VisualAssetPlanCard } from "./VisualAssetPlanCard";
import { evaluatePurposeRequirements } from "@/lib/imageHandoff/purposeRequirements";
import { buildVisualAssetPlan } from "@/lib/imageHandoff/visualAssetPlan";

/** 生成前方案预览的最小完整样例（字段与 ImageHandoffSection 计算的形状一致）。 */
function basePreview(overrides: Partial<VisualGenerationPreview> = {}): VisualGenerationPreview {
  return {
    generationType: "product_visual_draft",
    productName: "Onlyeasy Sturdy Under Bed Shoe Storage Organizer, Set of 2, Fit 12 to 24 Pairs",
    approvedReferenceCount: 1,
    identity: [
      { key: "brand", label: "品牌", value: "Onlyeasy" },
      { key: "series_or_model", label: "系列或型号", value: "MXAUBSB2P" },
      { key: "color_or_variant", label: "颜色或款式", value: "Black" },
      { key: "quantity_or_pack_size", label: "数量或包装", value: "2 件装" },
    ],
    buyerQuestion: "能不能塞进 30cm 高的床底？",
    factsUsed: [{ field: "dimensions", label: "尺寸", value: "29.3L x 23.6W x 5.9H" }],
    requiredFactKinds: ["dimensions"],
    composition: "Centred hero product shot filling approximately 85% of the frame.",
    compositionLabel: "突出商品主体，符合平台主图规范。",
    backgroundPolicy: "pure_white",
    styleLabel: "摄影棚纯白底",
    textAllowed: false,
    textPolicy: "Zero text, zero labels, zero logos.",
    negativeConstraints: ["保持商品真实物理外观，禁止篡改外形轮廓与核心部件"],
    gaps: [],
    ...overrides,
  };
}

/** 任务模式渲染：预览区只在 mode="task" 且传入 preview 时出现。 */
function renderTaskCard(preview: VisualGenerationPreview) {
  return renderToStaticMarkup(
    createElement(VisualGenerationBriefCard, {
      mode: "task",
      assetTitle: "白底合规主图",
      categoryLabel: "核心主图",
      goal: "突出商品主体，符合平台主图规范。",
      facts: preview.factsUsed,
      strategy: {
        purposeLabel: "白底主图/棚拍",
        sceneLabel: "纯白背景无杂质",
        styleLabel: preview.styleLabel,
        rationale: "搜索结果主图是买家点击的第一入口。",
      },
      constraints: preview.negativeConstraints,
      referenceNotice: {
        title: "参考图创作模式",
        description: "将参考已批准商品图片进行视觉创作，结果仍需人工检查商品外观和文字。",
        isComposition: false,
      },
      preview,
    }),
  );
}

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
    expect(html).toContain("AI 视觉方案");
    expect(html).toContain("研究事实驱动");
    expect(html).toContain("主图合规");

    // 2. 资产定位与目标
    expect(html).toContain("01 视觉资产定位与目标");
    expect(html).toContain("槽位 1 · 主图白底合规");
    expect(html).toContain("突出商品真实物理形态，建立可信第一印象，符合 Amazon 白底主图规范");

    // 3. 事实依据驱动
    expect(html).toContain("02 商品事实依据");
    expect(html).toContain("已绑定 3 项事实");
    expect(html).toContain("Stainless Steel");
    expect(html).toContain("3.5&quot;L x 3.5&quot;W x 5.3&quot;H");
    expect(html).toContain("10 oz");

    // 4. 视觉策略
    expect(html).toContain("03 视觉策略组合");
    expect(html).toContain("白底主图/棚拍");
    expect(html).toContain("纯白背景无杂质");
    expect(html).toContain("摄影棚纯白底");
    expect(html).toContain("聚焦商品主体质感与真实比例，消除背景干扰");

    // 5. 约束与安全底线
    expect(html).toContain("04 生成约束与安全底线");
    expect(html).toContain("保持商品真实物理外观，禁止篡改外形轮廓与核心部件");
    expect(html).toContain("参考图创作模式");
    expect(html).toContain("将参考已批准商品图片进行视觉创作，结果仍需人工检查商品外观和文字。");

    // 未传 preview 时不出现生成前预览区
    expect(html).not.toContain('data-testid="visual-generation-brief-preview"');
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

    expect(html).toContain("AI 视觉方案");
    expect(html).toContain("自由创意模式");
    expect(html).toContain("无研究事实");
    expect(html).toContain("⚠ 独立创作未绑定商品研究任务");
    expect(html).toContain("用户提供内容由你自行输入，未经商品研究验证，不属于商品事实。生成结果仅供概念与构图参考。");
    expect(html).not.toContain("已绑定");
    expect(html).toContain("概念创作模式");
  });
});

describe("生成前方案预览（任务 2）", () => {
  it("生成类型显示为二选一，且两种模式文案正确", () => {
    const draft = renderTaskCard(basePreview({ generationType: "product_visual_draft" }));
    expect(draft).toContain('data-testid="brief-preview-generation-type" data-active="product_visual_draft"');
    expect(draft).toContain('data-option="product_visual_draft" data-active="true"');
    expect(draft).toContain('data-option="composition_concept" data-active="false"');
    expect(draft).toContain("基于已批准的商品参考图生成");
    expect(draft).toContain("构图概念稿，不用于证明商品外观");
    expect(draft).toContain("本次实际使用：");
    expect(draft).toContain("生成类型（二选一）");

    const concept = renderTaskCard(basePreview({ generationType: "composition_concept" }));
    expect(concept).toContain('data-testid="brief-preview-generation-type" data-active="composition_concept"');
    expect(concept).toContain('data-option="composition_concept" data-active="true"');
    expect(concept).toContain('data-option="product_visual_draft" data-active="false"');
    expect(concept).toContain("基于已批准的商品参考图生成");
    expect(concept).toContain("构图概念稿，不用于证明商品外观");

    // mode 缺失（尚未确定）时两项都不高亮，也不显示 undefined
    const pending = renderTaskCard(basePreview({ generationType: null }));
    expect(pending).toContain('data-active="none"');
    expect(pending).toContain("尚未确定（当前不可生成）");
    expect(pending).not.toContain("undefined");
  });

  it("渲染 8 项预览内容（含购买疑问、事实、构图背景风格、文字策略）", () => {
    const html = renderTaskCard(basePreview());
    for (let index = 1; index <= 8; index += 1) {
      expect(html).toContain(`data-testid="brief-preview-item-${index}"`);
    }
    expect(html).toContain("当前商品与批准参考图");
    expect(html).toContain("已批准商品参考图：1 张");
    expect(html).toContain("图片用途");
    expect(html).toContain("要回答的购买疑问");
    expect(html).toContain("能不能塞进 30cm 高的床底？");
    expect(html).toContain("本次使用的已确认事实");
    expect(html).toContain("本次槽位所需事实字段：尺寸");
    expect(html).toContain("构图、背景与风格方向");
    expect(html).toContain("纯白背景（平台主图合规）");
    expect(html).toContain("摄影棚纯白底");
    expect(html).toContain("允许文字与禁止内容");
    expect(html).toContain("不允许画面内出现文字、标签、角标或说明排版");
    expect(html).toContain("尚缺资料与下一步");
    // 安全红线：不出现内部契约 / 指纹 / provider / selectionId
    expect(html).not.toContain("referenceFingerprint");
    expect(html).not.toContain("selectionId");
    expect(html).not.toContain("schema");
    expect(html).not.toContain("factId");
  });

  it("身份区显示「未确认」时不会编造取值，且只做特征保持说明", () => {
    const html = renderTaskCard(basePreview({
      identity: [
        { key: "brand", label: "品牌", value: null },
        { key: "series_or_model", label: "系列或型号", value: null },
        { key: "color_or_variant", label: "颜色或款式", value: "Black" },
        { key: "quantity_or_pack_size", label: "数量或包装", value: null },
      ],
    }));

    expect(html).toContain("本次生成要求保持这些商品特征。");
    expect(html).toContain('data-identity="brand" data-confirmed="false"');
    expect(html).toContain('data-identity="series_or_model" data-confirmed="false"');
    expect(html).toContain('data-identity="quantity_or_pack_size" data-confirmed="false"');
    expect(html).toContain('data-identity="color_or_variant" data-confirmed="true"');
    // 三个未确认槽位各出现一次「未确认」，且没有编造取值
    expect(html.match(/未确认/g)?.length).toBe(3);
    expect(html).not.toContain("未知");
    expect(html).not.toContain("待补充");
    // 文案红线：不得承诺商品绝对不变形 / 系统已自动验证一致
    expect(html).not.toContain("绝对不变形");
    expect(html).not.toContain("完全一致");
    expect(html).not.toContain("已自动验证");
    expect(html).toContain("允许变化：");
    expect(html).toContain("禁止变化：");
    expect(html).toContain("未授权颜色、结构、数量与配件");
  });

  it("缺事实时显示缺口与可执行下一步", () => {
    const html = renderTaskCard(basePreview({
      requiredFactKinds: ["dimensions", "material"],
      factsUsed: [{ field: "material", label: "材质", value: "无纺布" }],
      gaps: [{ label: "缺少已确认尺寸事实", nextStep: "请先在研究页确认尺寸后再生成" }],
    }));

    expect(html).toContain("缺少已确认尺寸事实");
    expect(html).toContain("请先在研究页确认尺寸后再生成");
    expect(html).toContain("data-testid=\"brief-preview-item-8\"");
    expect(html).toContain("→");
    expect(html).toContain("本次槽位所需事实字段：尺寸、材质");
    expect(html).not.toContain("可以直接生成");
  });

  it("Recipe 新字段未落地时用兜底文案，不显示 undefined", () => {
    const html = renderTaskCard(basePreview({
      buyerQuestion: "",
      backgroundPolicy: "",
      textAllowed: null,
      textPolicy: "",
      requiredFactKinds: [],
      factsUsed: [],
      composition: "",
      // 中文主展示位也必须一起清空，否则「配方未标注构图方向」不会出现
      compositionLabel: "",
    }));

    expect(html).not.toContain("undefined");
    expect(html).toContain("配方未提供购买疑问");
    expect(html).toContain("配方未标注背景策略");
    expect(html).toContain("配方未标注构图方向");
    expect(html).toContain("配方未标注文字策略，按默认不允许画面内文字处理");
    expect(html).toContain("当前槽位未绑定已确认事实，生成只使用商品基础信息。");
  });

  it("中文界面收口：构图与文字策略主展示为中文，英文配方原文收进折叠区（不作为主展示）", () => {
    const html = renderTaskCard(basePreview());
    // 中文主展示
    expect(html).toContain("突出商品主体，符合平台主图规范。");
    // 英文原文仍可核对，但必须位于折叠容器内（details/summary）
    expect(html).toContain("查看配方原文（英文，仅供核对）");
    expect(html).toContain("查看配方文字策略原文（英文，仅供核对）");
    expect(html).toContain("<details");
    // 英文原文必须排在折叠标记之后（不是裸露的主展示）
    expect(html.indexOf("Centred hero product shot")).toBeGreaterThan(html.indexOf("查看配方原文"));
  });

  it("超长商品名按词边界截断，不出现无意义断词", () => {
    expect(truncateAtWordBoundary("Onlyeasy Sturdy Under Bed Shoe Storage Organizer", 20))
      .toBe("Onlyeasy Sturdy…");
    expect(truncateAtWordBoundary("收纳箱", 20)).toBe("收纳箱");
    expect(truncateAtWordBoundary("SKU-ABC123456789", 8)).toBe("SKU-…");
    // 渲染时也不会把英文单词截成半个词
    const html = renderTaskCard(basePreview());
    expect(html).toContain("Onlyeasy Sturdy Under Bed Shoe Storage…");
  });
});

describe("canonical field 同源（任务 1 回归）", () => {
  // 与 ImageHandoffSection 传给门禁的形状完全一致：{ field, label, value }
  // label="Size" / value="Standard" 都不命中尺寸语义关键词，因此判定只可能由 canonical field 驱动。
  const withCanonicalField = [{ field: "dimensions", label: "Size", value: "Standard" }];
  const withoutCanonicalField = [{ field: "", label: "Size", value: "Standard" }];

  it("Purpose 门禁：canonical field 存在时放行，缺失时按资料不足阻断（对照）", () => {
    expect(evaluatePurposeRequirements("dimension_specification", withCanonicalField).ok).toBe(true);
    expect(evaluatePurposeRequirements("dimension_specification", withoutCanonicalField).ok).toBe(false);
  });

  it("视觉资产规划：就绪度同样由 canonical field 决定（对照）", () => {
    const readyPlan = buildVisualAssetPlan({ facts: withCanonicalField, hasApprovedVisualReference: true });
    const blockedPlan = buildVisualAssetPlan({ facts: withoutCanonicalField, hasApprovedVisualReference: true });
    const findSlot = (plan: ReturnType<typeof buildVisualAssetPlan>) =>
      plan.slots.find((slot) => slot.slotType === "dimension_specs");

    expect(findSlot(readyPlan)?.readiness).toBe("ready");
    expect(findSlot(blockedPlan)?.readiness).toBe("blocked_needs_facts");
  });

  it("事实筛选：canonical field 优先，字段缺失时沿用服务端同源的证据判定", () => {
    const facts = [
      { field: "dimensions", label: "尺寸", value: "30cm" },
      { field: "capacity", label: "容量", value: "24 Pairs" },
      { field: "", label: "尺寸（历史数据无 canonical field）", value: "30cm" },
      { field: "material", label: "材质", value: "不锈钢" },
    ];

    // ① canonical 字段名语义：严格按 fact.field 匹配，空 field 不会被 label 相似度算进来
    expect(selectPreviewFacts(facts, ["dimensions"]).map((fact) => fact.field)).toEqual(["dimensions"]);
    expect(factSatisfiesRequiredKind(facts[2], "dimensions")).toBe(false);
    expect(selectPreviewFacts(facts, ["dimensions", "capacity"])).toHaveLength(2);
    // ② 证据类别语义（RequiredFactKind）：复用 purposeRequirements 既有 evidence 判定，与服务端门禁同源。
    //    服务端对「label 命中尺寸语义」的历史事实同样认定为尺寸证据，所以这里也一致收录，不额外收紧。
    expect(selectPreviewFacts(facts, ["dimension_fact"]).map((fact) => fact.label))
      .toEqual(["尺寸", "尺寸（历史数据无 canonical field）"]);
    expect(selectPreviewFacts(facts, ["dimension_fact", "selling_point_fact"]).map((fact) => fact.field))
      .toEqual(["dimensions", "", "material"]);
    expect(factKindLabel("dimension_fact")).toBe("尺寸/规格");
    // 未知种类原样显示，不显示 undefined
    expect(factKindLabel("unknown_kind")).toBe("unknown_kind");
    // 无要求时不做筛选（也不额外收紧）
    expect(selectPreviewFacts(facts, [])).toHaveLength(4);
  });
});

describe("槽位就绪度与服务端门禁收口（追加任务）", () => {
  // 只有尺寸事实、没有卖点事实；带已批准参考图 → 规划层声明的 ready 槽位最多
  const factsWithoutSellingPoints = [{ field: "dimensions", label: "尺寸", value: "30cm" }];

  function planWithGate(facts: Array<{ field: string; label: string; value: string }>, withGate: boolean) {
    const plan = buildVisualAssetPlan({ facts, hasApprovedVisualReference: true });
    const slotGates: Record<string, { ok: boolean; message?: string }> = {};
    for (const slot of plan.slots) {
      const gate = evaluatePurposeRequirements(slot.suggestedPurpose, facts);
      slotGates[slot.slotId] = gate.ok ? { ok: true } : { ok: false, message: gate.message };
    }
    const html = renderToStaticMarkup(
      createElement(VisualAssetPlanCard, { plan, slotGates: withGate ? slotGates : undefined }),
    );
    return { plan, html };
  }

  it("使用场景槽位作为独立主用途时不依赖卖点事实门禁", () => {
    const { plan, html } = planWithGate(factsWithoutSellingPoints, true);
    const lifestyleSlot = plan.slots.find((slot) => slot.slotId === "slot-lifestyle-scene");

    // 规划层确实把它标成 ready（既有行为，未修改 lib）
    expect(lifestyleSlot?.suggestedPurpose).toBe("lifestyle_in_use");
    expect(lifestyleSlot?.readiness).toBe("ready");

    expect(html).toContain('data-testid="visual-asset-slot-slot-lifestyle-scene" data-readiness="ready" data-gate-blocked="false"');
    expect(plan.readyCount).toBe(4);
    expect(html).toContain("就绪进度 4 / 6 项");
  });

  it("对照组：不传门禁结果时仍按规划层显示（证明差异来自门禁收口）", () => {
    const { html } = planWithGate(factsWithoutSellingPoints, false);
    expect(html).toContain("就绪进度 4 / 6 项");
    expect(html).toContain('data-testid="visual-asset-slot-slot-lifestyle-scene" data-readiness="ready"');
  });

  it("有卖点事实时该槽位仍显示就绪（门禁不误伤）", () => {
    const withSellingPoints = [
      { field: "dimensions", label: "尺寸", value: "30cm" },
      { field: "material", label: "材质", value: "不锈钢" },
    ];
    const { html } = planWithGate(withSellingPoints, true);
    expect(html).toContain('data-testid="visual-asset-slot-slot-lifestyle-scene" data-readiness="ready" data-gate-blocked="false"');
  });

});
