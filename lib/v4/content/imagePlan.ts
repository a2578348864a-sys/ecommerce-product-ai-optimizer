/**
 * V4 P5 — ImagePlan（先计划后生成，D5）。
 *
 * 图像计划在生成/拍摄前形成 brief：优先产品忠实度；缺真实参考图 → 仅拍摄清单或
 * Concept/Mockup（不得 Final）；Visual Fact Check 逐项比对生成资产。
 *
 * 本模块为确定性函数，不调用视觉模型、不生成真实图片、不输出单一合规分数。
 * 只做分级与诉求，不证明真实材质/尺寸。
 */
import "server-only";

import type { ContentHandoff } from "./handoff";
import type { PolicyPack } from "./policyPack";

/** 计划等级：concept（仅概念构图）| mockup（mockup 标记概念图）| final（可生成最终成品）。 */
export type PlanLevel = "concept" | "mockup" | "final";
/** 产出方式：photo（实拍/生成）| ai_mockup（mockup）| shooting_list（仅拍摄清单）。 */
export type PlanKind = "photo" | "ai_mockup" | "shooting_list";

export type ProductFactValue = string | number | boolean | string[];

/** 已确认产品事实（人工确认的自有 SKU 事实；镜像 V3 ConfirmedProductFact 最小字段）。 */
export type ConfirmedProductFact = {
  factId: string;
  field: string;
  label: string;
  value: ProductFactValue;
  unit?: string;
  evidenceRefs?: string[];
};

export type PlanIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
};

export type MainImagePlan = {
  planLevel: PlanLevel;
  planKind: PlanKind;
  identityChecklist: string[];
  composition: {
    background: string;
    angle: string;
    productCoverage: string;
    shadow: string;
  };
  requiredAssets: string[];
  negativeConstraints: string[];
  policyRefs: string[];
  factRefs: string[];
};

export type SecondaryImageSlide = {
  purpose: string;
  audienceInsightRefs: string[];
  visualBrief: string;
  copy: string | null;
  factRefs: string[];
  policyRefs: string[];
};

export type APlusPlan = {
  eligibilityStatus: "eligible" | "unknown" | "not_eligible";
  modules: Array<{
    module: string;
    order: number;
    copy: string;
    imageBrief: string;
    factRefs: string[];
    altText: string;
  }>;
  assetSpecs: string[];
  factRefs: string[];
  policyRefs: string[];
  experimentHypothesis: string | null;
};

export type ShootingItem = {
  itemId: string;
  need: string;
  rationale: string;
  priority: "must" | "should";
};

export type ImagePlan = {
  schemaVersion: "image-plan.v1";
  variant: string;
  /** 用于 rights/policy 判定的禁止项（来自 handoff.forbidden 与主图规则）。 */
  forbidden: string[];
  main: MainImagePlan;
  secondary: SecondaryImageSlide[];
  aPlus?: APlusPlan;
  shootingList: ShootingItem[];
  issues: PlanIssue[];
};

/** 可选规划输入：brandEligible / 是否启用 A+；policy 提供站点类目规则（缺失时用标注默认值）。 */
export type PlanOptions = {
  brandEligible?: boolean;
  enableAPlus?: boolean;
  policy?: PolicyPack | null;
};

/** 归一化：NFC + 折叠空白 + 小写。 */
export function norm(value: unknown): string {
  if (value == null) return "";
  const raw = Array.isArray(value) ? value.join(" ") : String(value);
  return raw.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** 拆分列表型字段值（颜色/配件/套装内容等），按常用分隔符切分。 */
export function splitList(value: ProductFactValue): string[] {
  if (Array.isArray(value)) return value.map(norm).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(/[,，、;；/]+|\s*\+\s*/).map(norm).filter(Boolean);
}

/** 按 field 取已确认事实。 */
export function factByField(facts: ConfirmedProductFact[], field: string): ConfirmedProductFact | undefined {
  return facts.find((f) => norm(f.field) === norm(field));
}

/** 已确认字段集合（小写归一）。 */
export function confirmedFieldSet(facts: ConfirmedProductFact[]): Set<string> {
  return new Set(facts.map((f) => norm(f.field)));
}

const VISUAL_COVERAGE_FIELDS = ["color", "material", "structure", "quantity", "accessories", "dimensions", "variant"];

/** 主图最终（final）所需的最小视觉事实：颜色 + 任一结构类事实。 */
function hasFinalCoverage(facts: ConfirmedProductFact[]): boolean {
  const fields = confirmedFieldSet(facts);
  if (!fields.has("color")) return false;
  return ["structure", "quantity", "accessories", "dimensions"].some((f) => fields.has(f));
}

function makePolicyRef(handoff: ContentHandoff, scope: string): string {
  return "policy:" + handoff.policyPackVersion + ":" + scope;
}

function mainComposition(policy: PolicyPack | null | undefined): MainImagePlan["composition"] {
  // 来自当前 marketplace/category policy pack；未提供时用标注默认值，非永久常量（D7：不在代码写死站点规则）。
  const allowlistRule = policy?.rules.find((r) => r.kind === "field_allowlist");
  return {
    background: allowlistRule ? (allowlistRule.pattern ?? "纯白 #FFFFFF") : "纯白 #FFFFFF（按 policy pack 核定）",
    angle: allowlistRule ? "官方/实拍角度（按 policy pack 核定）" : "正面等距（按 policy pack 核定）",
    productCoverage: "产品占画面 ≥85%（按 policy pack 核定）",
    shadow: "纯白底无投影或规则允许的柔影（按 policy pack 核定）",
  };
}

function buildNegativeConstraints(handoff: ContentHandoff): string[] {
  const constraints = new Set<string>([
    "不得包含未授权 logo",
    "不得包含水印/第三方版权标记",
    "不得包含商标词或近似品牌文案",
    "不得包含未授权人物肖像",
    "不得复用/复制竞品图或竞品品牌资产",
  ]);
  for (const f of handoff.forbidden ?? []) {
    if (norm(f)) constraints.add("禁止项：" + f);
  }
  return [...constraints];
}

function buildIdentityChecklist(facts: ConfirmedProductFact[]): string[] {
  const items: string[] = [];
  const add = (fact: ConfirmedProductFact | undefined, prefix: string) => {
    if (fact) items.push(prefix + "：" + norm(fact.value));
  };
  add(factByField(facts, "variant"), "目标 variant");
  add(factByField(facts, "color"), "颜色");
  add(factByField(facts, "material"), "材质外观");
  add(factByField(facts, "structure"), "结构");
  add(factByField(facts, "quantity"), "数量");
  add(factByField(facts, "accessories"), "配件/套装");
  return items;
}

function buildShootingList(
  handoff: ContentHandoff,
  facts: ConfirmedProductFact[],
  refs: string[],
  level: PlanLevel,
): ShootingItem[] {
  const items: ShootingItem[] = [];
  const fields = confirmedFieldSet(facts);
  if (refs.length === 0) {
    items.push({ itemId: "shoot-01", need: "目标 variant 实物顶视/等距图", rationale: "缺少真实参考图，无法确认主图视觉身份", priority: "must" });
  }
  if (!fields.has("color")) items.push({ itemId: "shoot-02", need: "实物颜色/色卡实拍", rationale: "颜色未确认，主图不得标为可发布成品", priority: "must" });
  if (!fields.has("structure")) items.push({ itemId: "shoot-03", need: "结构/部件/开口/按键/把手实拍", rationale: "结构未确认，视觉几何无法比对", priority: "must" });
  if (!fields.has("quantity")) items.push({ itemId: "shoot-04", need: "套装内件数量清单实拍", rationale: "数量未确认，需真实件数", priority: "must" });
  if (!fields.has("accessories")) items.push({ itemId: "shoot-05", need: "配件/包装内含物清单实拍", rationale: "配件未确认，防止虚构配件", priority: "must" });
  if (!fields.has("dimensions")) items.push({ itemId: "shoot-06", need: "带刻度/标签的尺寸实拍", rationale: "尺寸文字未确认，需确认单位与数值", priority: "must" });
  if (refs.length > 0 && level === "mockup") {
    items.push({ itemId: "shoot-07", need: "真实产品图补拍（覆盖颜色/结构/占比）", rationale: "参考图不足以构成 final，需实拍再定稿", priority: "should" });
  }
  return items;
}

/**
 * 生成图像计划（D5）。referenceImages 为空 → 一律 concept/mockup + 拍摄清单，禁止 final。
 */
export function imagePlan(
  handoff: ContentHandoff,
  facts: ConfirmedProductFact[],
  referenceImages: string[],
  opts: PlanOptions = {},
): ImagePlan {
  const refs = referenceImages ?? [];
  const policy = opts.policy ?? null;

  const variant = handoff.variant || norm(factByField(facts, "variant")?.value) || handoff.candidateId;

  // 主图分级：缺参考图→concept；参考不足或视觉事实不足→mockup；否则 final。
  let level: PlanLevel;
  let kind: PlanKind;
  const issues: PlanIssue[] = [];
  if (refs.length === 0) {
    level = "concept";
    kind = "shooting_list";
    issues.push({ code: "MISSING_REFERENCE_IMAGES", severity: "error", message: "缺少真实参考图：仅生成拍摄清单/概念图，不得标为 final" });
  } else if (!hasFinalCoverage(facts)) {
    level = "mockup";
    kind = "ai_mockup";
    issues.push({ code: "INSUFFICIENT_VISUAL_FACTS", severity: "warning", message: "参考图存在但视觉事实不足（需颜色+结构/数量/配件/尺寸），主要图片仅为 mockup" });
  } else {
    level = "final";
    kind = "photo";
  }

  const policyRefs = [makePolicyRef(handoff, "main-image"), makePolicyRef(handoff, "category:" + handoff.category)];
  const factRefs = facts.map((f) => f.factId);
  const checklist = buildIdentityChecklist(facts);

  const main: MainImagePlan = {
    planLevel: level,
    planKind: kind,
    identityChecklist: checklist,
    composition: mainComposition(policy),
    requiredAssets:
      level === "final"
        ? ["主图（白底、产品占画面 ≥85%、无文字/logo/人物）"]
        : level === "mockup"
          ? ["mockup 标记概念图（基于现有参考图）"]
          : ["（无）仅拍摄清单"],
    negativeConstraints: buildNegativeConstraints(handoff),
    policyRefs,
    factRefs,
  };

  // 副图：把 VOC 痛点映射为需理解的信息，不反推为产品能力（07）。
  const secondary = buildSecondaryPlan(handoff, facts);

  // A+：仅在品牌资格 + 明确启用时产出。
  let aPlus: APlusPlan | undefined;
  if (opts.enableAPlus) {
    aPlus = buildAPlusPlan(handoff, facts, opts.brandEligible ?? null);
  } else if (opts.brandEligible === true) {
    issues.push({ code: "APLUS_NOT_REQUESTED", severity: "warning", message: "品牌资格已确认但未启用 A+；如需 A+ 请显式 enableAPlus" });
  }

  const shootingList = buildShootingList(handoff, facts, refs, level);
  if (aPlus && aPlus.eligibilityStatus === "unknown") {
    issues.push({ code: "APLUS_ELIGIBILITY_UNKNOWN", severity: "error", message: "A+ 品牌资格/模块未确认，仅输出前置清单，不得作为已启用素材" });
  }
  return {
    schemaVersion: "image-plan.v1",
    variant,
    forbidden: handoff.forbidden ?? [],
    main,
    secondary,
    ...(aPlus ? { aPlus } : {}),
    shootingList,
    issues,
  };
}

function buildSecondaryPlan(handoff: ContentHandoff, facts: ConfirmedProductFact[]): SecondaryImageSlide[] {
  const slides: SecondaryImageSlide[] = [];
  const policyRefs = [makePolicyRef(handoff, "secondary-image")];
  const add = (
    purpose: string,
    visualBrief: string,
    copy: string | null,
    factRefs: string[],
    refs: string[],
  ) => {
    slides.push({ purpose, audienceInsightRefs: refs, visualBrief, copy, factRefs, policyRefs });
  };
  add("尺寸/规格说明", "带清晰尺寸标注的产品图（单位以已确认事实为准）", "展示已确认尺寸，不臆造", factRefsOf(facts, ["dimensions"]), vocRefs(handoff));
  add("功能/结构解释", "部件、开口、按键、把手等结构拆解图", "仅呈现已确认结构", factRefsOf(facts, ["structure"]), vocRefs(handoff));
  add("套装/包装清单", "全部内件平铺图", "列出已确认配件/数量", factRefsOf(facts, ["quantity", "accessories"]), vocRefs(handoff));
  add("场景与使用", "符合品牌/VOC 的使用场景（不承诺效果）", null, factRefsOf(facts, ["color", "material"]), vocRefs(handoff));
  // 去重：无事实支撑的 slide 不产出（VOC 不反推能力）。
  return slides.filter((s) => s.factRefs.length > 0);
}

function buildAPlusPlan(
  handoff: ContentHandoff,
  facts: ConfirmedProductFact[],
  brandEligible: boolean | null,
): APlusPlan {
  const policyRefs = [makePolicyRef(handoff, "a-plus")];
  if (brandEligible !== true) {
    return {
      eligibilityStatus: brandEligible === false ? "not_eligible" : "unknown",
      modules: [],
      assetSpecs: ["仅前置准备：确认品牌注册、A+ 模块权限与当前规则"],
      factRefs: [],
      policyRefs,
      experimentHypothesis: null,
    };
  }
  const modules = [
    {
      module: "产品亮点",
      order: 1,
      copy: "以已确认事实呈现核心差异，不作无法证实的承诺。",
      imageBrief: "主图风格的亮点图",
      factRefs: factRefsOf(facts, ["color", "material", "structure"]),
      altText: "产品亮点（基于已确认事实）",
    },
    {
      module: "尺寸与规格",
      order: 2,
      copy: "展示已确认尺寸/数量，单位以事实为准。",
      imageBrief: "尺寸标注图",
      factRefs: factRefsOf(facts, ["dimensions", "quantity"]),
      altText: "尺寸与规格",
    },
    {
      module: "包装清单",
      order: 3,
      copy: "列出已确认配件与数量。",
      imageBrief: "内件平铺图",
      factRefs: factRefsOf(facts, ["accessories", "quantity"]),
      altText: "包装清单",
    },
  ].filter((m) => m.factRefs.length > 0);

  return {
    eligibilityStatus: "eligible",
    modules,
    assetSpecs: ["A+ 模块模板（符合当前规则）", "品牌资产确认（图片/字体/logo 授权）"],
    factRefs: facts.map((f) => f.factId),
    policyRefs,
    experimentHypothesis: "A+ 是否提升转化待测试，不作承诺。",
  };
}

function factRefsOf(facts: ConfirmedProductFact[], fields: string[]): string[] {
  const set = new Set(fields);
  return facts.filter((f) => set.has(norm(f.field))).map((f) => f.factId);
}

function vocRefs(handoff: ContentHandoff): string[] {
  // 仅作为表达背景引用，不创造事实；无相应 Voc ref 时为空数组。
  return handoff.vocRefs ?? [];
}

// VISUAL_COVERAGE_FIELDS 保留供调用方检查覆盖度用，避免未使用告警。
export const IMAGE_COVERAGE_FIELDS = VISUAL_COVERAGE_FIELDS;
