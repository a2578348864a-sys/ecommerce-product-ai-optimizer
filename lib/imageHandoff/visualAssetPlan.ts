import type { StudioImageLifestyleScene, StudioImagePrimaryPurpose } from "@/lib/studioImageCreativeIntent";
import {
  hasDimensionEvidence,
  hasPackagingEvidence,
  hasSellingPointEvidence,
  hasUsageEvidence,
  type ConfirmedFactLike,
} from "@/lib/imageHandoff/purposeRequirements";
import type { ImageStylePresetId } from "@/lib/imageStyleLibrary";

export type VisualAssetSlotType =
  | "main_white_studio"        // 01 白底合规主图（产品占画面≥85%，纯白底）
  | "selling_points"           // 02 核心卖点与信息图（需卖点事实）
  | "dimension_specs"          // 03 尺寸规格与空间图（需尺寸事实）
  | "detail_closeup"           // 04 材质工艺与细节特写图（需参考图保证一致性）
  | "lifestyle_in_use"         // 05 真实生活使用场景图（生活情境带入）
  | "packaging_bundle"         // 06 包装清单与内含物展示（需包装/套装事实）
  | "usage_steps";             // 07 使用步骤与操作指引（需使用方式事实）

export type VisualAssetSlotReadiness =
  | "ready"
  | "blocked_needs_visual_reference"
  | "blocked_needs_facts";

export type VisualAssetSlot = {
  slotId: string;
  slotType: VisualAssetSlotType;
  order: number;
  title: string;
  categoryLabel: string;
  purposeSummary: string;
  suggestedPurpose: StudioImagePrimaryPurpose;
  suggestedScene: StudioImageLifestyleScene;
  suggestedStylePresetId: ImageStylePresetId;
  readiness: VisualAssetSlotReadiness;
  blockedMessage?: string;
  rationale: string;
  factRefs: string[];
};

export type VisualAssetPlan = {
  version: "visual-asset-plan.v1";
  overallLevel: "concept" | "mockup" | "final";
  hasApprovedReference: boolean;
  slots: VisualAssetSlot[];
  readyCount: number;
  totalCount: number;
};

export type BuildVisualAssetPlanInput = {
  facts?: ConfirmedFactLike[] | readonly ConfirmedFactLike[];
  confirmedFacts?: ConfirmedFactLike[] | readonly ConfirmedFactLike[];
  hasApprovedVisualReference?: boolean;
  productName?: string;
};

/**
 * 纯函数：根据已确认事实和视觉参考状态，为商品生成一套标准的 Amazon 视觉资产规划建议。
 * 遵循第一性原理：
 * 1. 白底主图与细节特写必须有已批准参考图才能标为 ready（避免虚构外观）；
 * 2. 卖点图、尺寸图、包装图必须有已确认事实支撑才能标为 ready（与 purposeRequirements 门禁 100% 契合）；
 * 3. 场景图可作为构图概念先行探索；
 * 4. 不修改任何数据库、不调用外部服务、零副作用。
 */
export function buildVisualAssetPlan(input: BuildVisualAssetPlanInput): VisualAssetPlan {
  const facts = (input.facts ?? input.confirmedFacts ?? []) as ConfirmedFactLike[];
  const hasApprovedRef = Boolean(input.hasApprovedVisualReference);

  const hasDim = hasDimensionEvidence(facts);
  const hasPack = hasPackagingEvidence(facts);
  const hasSell = hasSellingPointEvidence(facts);
  const hasUsage = hasUsageEvidence(facts);

  const slots: VisualAssetSlot[] = [
    {
      slotId: "slot-main",
      slotType: "main_white_studio",
      order: 1,
      title: "白底合规主图",
      categoryLabel: "核心主图",
      purposeSummary: "纯白底棚拍，产品占比 ≥85%，无杂物与虚构配件，符合 Amazon 主图上架规范",
      suggestedPurpose: "white_studio",
      suggestedScene: "none",
      suggestedStylePresetId: "amazon_clean_hero",
      readiness: hasApprovedRef ? "ready" : "blocked_needs_visual_reference",
      blockedMessage: "主图需要已确认商品参考图，以保证产品真实外观与比例合规。",
      rationale: "搜索结果主图是买家点击的第一入口，高质白底棚拍是合规上架基石。",
      factRefs: ["product_main"],
    },
    {
      slotId: "slot-selling-points",
      slotType: "selling_points",
      order: 2,
      title: "核心卖点信息图",
      categoryLabel: "卖点解析",
      purposeSummary: "围绕已确认功能或材质特征组织信息图构图，预留排版空间，清晰传达核心价值",
      suggestedPurpose: "selling_point_infographic",
      suggestedScene: "none",
      suggestedStylePresetId: "feature_board",
      readiness: hasSell ? "ready" : "blocked_needs_facts",
      blockedMessage: "需要已确认的功能特征、材质或优势卖点事实。",
      rationale: "买家通常在 3 秒内扫读副图，信息图能够快速建立产品核心差异化认知。",
      factRefs: ["functional_feature", "material"],
    },
    {
      slotId: "slot-dimension-specs",
      slotType: "dimension_specs",
      order: 3,
      title: "尺寸规格与空间图",
      categoryLabel: "规格参数",
      purposeSummary: "清晰展示产品长宽高或容量规格，预留标注区域，避免因尺寸预期不符导致退货",
      suggestedPurpose: "dimension_specification",
      suggestedScene: "none",
      suggestedStylePresetId: "feature_board",
      readiness: hasDim ? "ready" : "blocked_needs_facts",
      blockedMessage: "缺少已确认的长宽高尺寸或容量规格事实。",
      rationale: "尺寸不合是跨境电商高频退货原因之一，直观的空间比例图能显著降低售后退货率。",
      factRefs: ["dimensions", "capacity"],
    },
    {
      slotId: "slot-detail-closeup",
      slotType: "detail_closeup",
      order: 4,
      title: "材质工艺与细节特写",
      categoryLabel: "品质特写",
      purposeSummary: "微距聚焦于真实材质质感、接口、卡扣或密封结构，呈现精良做工",
      suggestedPurpose: "detail_closeup",
      suggestedScene: "none",
      suggestedStylePresetId: "macro_detail",
      readiness: hasApprovedRef ? "ready" : "blocked_needs_visual_reference",
      blockedMessage: "细节特写需要已确认商品参考图，避免 AI 臆造零件与材质。",
      rationale: "微距细节传递工匠品质与材料厚实度，大幅强化中高客单价商品的溢价说服力。",
      factRefs: ["material", "operation"],
    },
    {
      slotId: "slot-lifestyle-scene",
      slotType: "lifestyle_in_use",
      order: 5,
      title: "真实生活使用场景图",
      categoryLabel: "使用场景",
      purposeSummary: "将商品置于可信的日常环境（家居生活/办公通勤），激发使用代入感与情感共鸣",
      suggestedPurpose: "selling_point_infographic",
      suggestedScene: "home_lifestyle",
      suggestedStylePresetId: "lifestyle_home",
      readiness: "ready",
      rationale: "让买家直观看到商品摆放在自己生活中的真实样貌，触发购买欲。",
      factRefs: ["living_scene"],
    },
    {
      slotId: "slot-packaging-bundle",
      slotType: "packaging_bundle",
      order: 6,
      title: "包装清单与配件展示",
      categoryLabel: "内含清单",
      purposeSummary: "完整平铺包装盒、随附配件与说明书，明确交付物，提升开箱期望与满意度",
      suggestedPurpose: "packaging_bundle",
      suggestedScene: "none",
      suggestedStylePresetId: "packaging_set",
      readiness: hasPack
        ? (hasApprovedRef ? "ready" : "blocked_needs_visual_reference")
        : "blocked_needs_facts",
      blockedMessage: hasPack
        ? "需要已确认的商品参考图以对齐包装外观。"
        : "缺少已确认的包装、套装或随附配件清单事实。",
      rationale: "所见即所得，清晰交代套装内含物，杜绝买家因'缺少配件'而产生负评。",
      factRefs: ["included_components", "quantity_or_pack_size"],
    },
  ];

  if (hasUsage) {
    slots.push({
      slotId: "slot-usage-steps",
      slotType: "usage_steps",
      order: 7,
      title: "使用步骤与操作指引",
      categoryLabel: "操作指引",
      purposeSummary: "清晰拆解分步使用流程，强调简单易用，降低买家使用顾虑",
      suggestedPurpose: "usage_steps",
      suggestedScene: "none",
      suggestedStylePresetId: "feature_board",
      readiness: "ready",
      rationale: "复杂或新型商品必须具备操作步骤图，帮助买家快速上手。",
      factRefs: ["operation"],
    });
  }

  const readyCount = slots.filter((s) => s.readiness === "ready").length;

  let overallLevel: "concept" | "mockup" | "final" = "concept";
  if (hasApprovedRef) {
    overallLevel = readyCount >= 4 ? "final" : "mockup";
  }

  return {
    version: "visual-asset-plan.v1",
    overallLevel,
    hasApprovedReference: hasApprovedRef,
    slots,
    readyCount,
    totalCount: slots.length,
  };
}
