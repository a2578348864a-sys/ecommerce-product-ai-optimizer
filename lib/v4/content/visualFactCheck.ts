/**
 * V4 P5 — Visual Fact Check（生成后逐项比对，D5/D7）。
 *
 * 9 项检查：identity / structure(几何) / color / quantity / accessories / dimensions / claims / policy / rights。
 * 自动视觉检查只发现疑点，**不证明真实材质、尺寸或认证**；最终必须由人审核（D7）。
 * 本模块为确定性比对函数，不调用视觉模型，不输出单一合规分数。
 */
import "server-only";

import type { ImagePlan } from "./imagePlan";
import { type ConfirmedProductFact, factByField, norm, splitList } from "./imagePlan";

export type AssetRole = "main" | "secondary" | "aplus";

/** 生成资产的可观测元数据（由上游视觉/OCR/QA 流程填充；仅作比对输入，非证明）。 */
export type AssetObservedMeta = {
  assetId: string;
  role: AssetRole;
  /** 检测到的目标 variant/实体身份。 */
  variant?: string;
  /** 检测到的结构特征（部件/开口/按键/把手等）。 */
  structure?: string[];
  /** 检测到的颜色。 */
  color?: string;
  /** 检测到的可见材质。 */
  material?: string;
  /** 检测到的件数。 */
  quantity?: number | null;
  /** 检测到的配件/内件。 */
  accessories?: string[];
  /** OCR 出的尺寸文字。 */
  dimensionsText?: string;
  /** 图中出现的文字/视觉暗示 claim。 */
  claims?: string[];
  /** 检测到的背景（如 white / transparent / scene / gradient）。 */
  background?: string;
  logoPresent?: boolean;
  watermarkPresent?: boolean;
  /** 检测到的商标词。 */
  trademarkTerms?: string[];
  personPresent?: boolean;
  /** 第三方品牌资产/竞品素材。 */
  thirdPartyBrandAssets?: string[];
  /** 主图上的文字叠加。 */
  textOverlays?: string[];
  /** 分辨率/像素是否满足规则。 */
  resolutionOk?: boolean;
  /** 是否包含包装/第三方标识。 */
  packageIncluded?: boolean;
};

export type VisualCheck = {
  check: string;
  pass: boolean;
  evidence: string;
  issues: string[];
};

export type VisualFactCheckResult = {
  checks: VisualCheck[];
  overallStatus: "ok" | "needs_human" | "blocked";
  summary: string;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const m = value.match(/\d+(\.\d+)?/);
    if (m) return Number.parseFloat(m[0]);
  }
  return null;
}

function extractDimTokens(text: string): string[] {
  const cleaned = text.replace(/[x×*]/g, " ");
  const tokens: string[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(cm|mm|m|in|inch|inches|ft|厘米|毫米|米|英寸|英尺)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const num = m[1];
    const rawUnit = (m[2] ?? "").toLowerCase();
    const unit = canonicalUnit(rawUnit);
    tokens.push(norm(num) + unit);
  }
  return [...new Set(tokens)];
}

function canonicalUnit(raw: string): string {
  if (raw === "") return "";
  if (["in", "inch", "inches", "英寸"].includes(raw)) return "in";
  if (["cm", "厘米"].includes(raw)) return "cm";
  if (["mm", "毫米"].includes(raw)) return "mm";
  if (["m", "米"].includes(raw)) return "m";
  if (["ft", "英尺"].includes(raw)) return "ft";
  return raw;
}

function allPresent(needles: string[], haystack: string[]): string[] {
  const hs = new Set(haystack.map(norm));
  return needles.filter((n) => !hs.has(norm(n)));
}

function makeCheck(
  check: string,
  pass: boolean,
  evidence: string,
  issues: string[],
): VisualCheck {
  return { check, pass, evidence, issues };
}

const HARD_BLOCK_CODES = [
  "identity_mismatch", "identity_not_detected",
  "quantity_mismatch", "quantity_not_detected",
  "fictional_accessory", "missing_accessory",
  "dimension_text_mismatch", "unsupported_dimension_claim",
  "unsupported_claim", "banned_absolute_claim",
  "policy_violation", "rights_violation",
];

const NEEDS_HUMAN_CODES = [
  "variant_information_missing", "color_not_verifiable", "quantity_not_verifiable",
  "structure_not_verifiable", "accessory_not_verifiable", "identity_not_verifiable",
  "color_not_detected", "structure_not_detected", "dimension_text_not_detected", "accessory_not_detected",
];

/** 默认监管式绝对/夸大词警示（非永久 policy；真正的禁词以 policy pack/手禁项为准）。 */
const ABSOLUTE_TERMS = ["best", "no.1", "number one", "100%", "100％", "medical", "eco-friendly", "最", "第一", "百分百", "医疗", "环保"];

function hasBannedTerm(claim: string, forbidden: string[]): string | null {
  const c = norm(claim);
  for (const t of forbidden) {
    if (t && c.includes(norm(t))) return t;
  }
  for (const t of ABSOLUTE_TERMS) {
    if (c.includes(norm(t))) return t;
  }
  return null;
}

/**
 * 9 项视觉事实比对。硬失败（identity/quantity/accessory/unsupported-claim/policy/rights）
 * 会阻止 approve_export；缺事实依据时返回 needs_human，不伪造通过。
 */
export function visualFactCheck(
  plan: ImagePlan,
  facts: ConfirmedProductFact[],
  meta: AssetObservedMeta,
): VisualFactCheckResult {
  const checks: VisualCheck[] = [];

  // 1. identity
  const target = plan.variant || norm(factByField(facts, "variant")?.value) || "";
  const observedVariant = meta.variant ? norm(meta.variant) : "";
  if (!target) {
    checks.push(makeCheck("identity", false, "目标 variant 信息缺失，无法比对身份", ["variant_information_missing"]));
  } else if (!observedVariant) {
    checks.push(makeCheck("identity", false, "未检测到资产身份", ["identity_not_detected"]));
  } else if (observedVariant !== norm(target)) {
    checks.push(makeCheck("identity", false, "检测身份与目标 variant 不一致（expected \"" + norm(target) + "\", observed \"" + observedVariant + "\"）", ["identity_mismatch"]));
  } else {
    checks.push(makeCheck("identity", true, "身份一致：" + target, []));
  }

  // 2. structure / geometry
  const structFact = factByField(facts, "structure") ?? factByField(facts, "shape") ?? factByField(facts, "geometry");
  const observedStruct = (meta.structure ?? []).map(norm).filter(Boolean);
  if (!structFact) {
    checks.push(makeCheck("structure", false, "无已确认结构事实，无法验证几何", ["structure_not_verifiable"]));
  } else {
    const expectedStruct = splitList(structFact.value);
    if (observedStruct.length === 0 && expectedStruct.length > 0) {
      checks.push(makeCheck("structure", false, "结构未检测到（expected \"" + expectedStruct.join(",") + "\"）", ["structure_not_detected"]));
    } else {
      const missing = allPresent(expectedStruct, observedStruct);
      if (missing.length > 0) {
        checks.push(makeCheck("structure", false, "结构中缺失已确认部件（missing \"" + missing.join(",") + "\"）", ["structure_mismatch"]));
      } else {
        checks.push(makeCheck("structure", true, "结构与已确认事实一致（" + observedStruct.join(",") + "）", []));
      }
    }
  }

  // 3. color
  const colorFact = factByField(facts, "color");
  const observedColor = meta.color ? norm(meta.color) : "";
  if (!colorFact) {
    checks.push(makeCheck("color", false, "无已确认颜色事实，无法验证", ["color_not_verifiable"]));
  } else if (!observedColor) {
    checks.push(makeCheck("color", false, "颜色未检测到", ["color_not_detected"]));
  } else if (colorTokensMatch(splitList(colorFact.value), observedColor)) {
    checks.push(makeCheck("color", true, "颜色一致：" + observedColor, []));
  } else {
    checks.push(makeCheck("color", false, "颜色不一致（expected \"" + norm(colorFact.value) + "\", observed \"" + observedColor + "\"）", ["color_mismatch"]));
  }

  // 4. quantity
  const qtyFact = factByField(facts, "quantity") ?? factByField(facts, "count");
  const expectedQty = qtyFact ? toNumber(qtyFact.value) : null;
  if (!qtyFact) {
    checks.push(makeCheck("quantity", false, "无已确认数量事实，无法验证", ["quantity_not_verifiable"]));
  } else if (expectedQty == null) {
    checks.push(makeCheck("quantity", false, "数量事实格式无法解析", ["quantity_not_verifiable"]));
  } else if (meta.quantity == null) {
    checks.push(makeCheck("quantity", false, "数量未检测到", ["quantity_not_detected"]));
  } else if (meta.quantity !== expectedQty) {
    checks.push(makeCheck("quantity", false, "数量不一致（expected \"" + expectedQty + "\", observed \"" + meta.quantity + "\"）", ["quantity_mismatch"]));
  } else {
    checks.push(makeCheck("quantity", true, "数量一致：" + expectedQty, []));
  }

  // 5. accessories
  const accFact = factByField(facts, "accessories") ?? factByField(facts, "package_contents");
  const expectedAcc = accFact ? splitList(accFact.value) : [];
  const observedAcc = (meta.accessories ?? []).map(norm).filter(Boolean);
  if (expectedAcc.length === 0) {
    if (observedAcc.length > 0) {
      checks.push(makeCheck("accessories", false, "资产出现未确认配件（observed \"" + observedAcc.join(",") + "\"）", ["fictional_accessory"]));
    } else {
      checks.push(makeCheck("accessories", true, "无已确认配件且资产未显示配件", []));
    }
  } else {
    const missingAcc = allPresent(expectedAcc, observedAcc);
    const extraAcc = observedAcc.filter((o) => !expectedAcc.some((e) => norm(e) === o));
    if (missingAcc.length > 0 || extraAcc.length > 0) {
      const issues: string[] = [];
      if (missingAcc.length > 0) issues.push("missing_accessory");
      if (extraAcc.length > 0) issues.push("fictional_accessory");
      checks.push(makeCheck("accessories", false, "配件不一致（missing \"" + missingAcc.join(",") + "\"; extra \"" + extraAcc.join(",") + "\"）", issues));
    } else {
      checks.push(makeCheck("accessories", true, "配件与已确认一致（" + observedAcc.join(",") + "）", []));
    }
  }

  // 6. dimensions
  const dimFact = factByField(facts, "dimensions") ?? factByField(facts, "size");
  const observedDimText = meta.dimensionsText ? norm(meta.dimensionsText) : "";
  if (!dimFact) {
    if (observedDimText) {
      checks.push(makeCheck("dimensions", false, "出现尺寸文字但无已确认尺寸事实", ["unsupported_dimension_claim"]));
    } else {
      checks.push(makeCheck("dimensions", true, "无已确认尺寸且资产无尺寸文字", []));
    }
  } else {
    const expectedDims = extractDimTokens(norm(dimFact.value));
    if (!observedDimText) {
      checks.push(makeCheck("dimensions", false, "已确认尺寸但未检测到尺寸文字", ["dimension_text_not_detected"]));
    } else {
      const observedDims = extractDimTokens(observedDimText);
      const missingDims = allPresent(expectedDims, observedDims);
      if (missingDims.length > 0) {
        checks.push(makeCheck("dimensions", false, "尺寸文字不一致（expected \"" + expectedDims.join(",") + "\", observed \"" + observedDims.join(",") + "\"）", ["dimension_text_mismatch"]));
      } else {
        checks.push(makeCheck("dimensions", true, "尺寸文字与已确认一致（" + observedDims.join(",") + "）", []));
      }
    }
  }

  // 7. claims（图中文字/视觉暗示需有事实依据；缺依据 → fail）
  const claimIssues: string[] = [];
  for (const raw of meta.claims ?? []) {
    const claim = norm(raw);
    if (!claim) continue;
    const banned = hasBannedTerm(claim, plan.forbidden);
    if (banned) {
      claimIssues.push("banned_absolute_claim");
      continue;
    }
    if (!isClaimSupported(claim, facts)) {
      claimIssues.push("unsupported_claim");
    }
  }
  if (claimIssues.length > 0) {
    checks.push(makeCheck("claims", false, "存在无依据/违规 claim：" + claimIssues.join(","), claimIssues));
  } else {
    checks.push(makeCheck("claims", true, "图中声明均有事实依据或无可验证产品主张", []));
  }

  // 8. policy
  const policyIssues: string[] = [];
  const isMain = meta.role === "main";
  if (isMain) {
    const bg = norm(meta.background);
    if (bg && !["white", "transparent", "纯白", "透明", "#ffffff"].includes(bg) && !bg.includes("纯白")) {
      policyIssues.push("主图背景非纯白/透明");
    }
    if (!meta.background) policyIssues.push("主图背景未检测");
    if (meta.logoPresent) policyIssues.push("主图包含 logo");
    if (meta.watermarkPresent) policyIssues.push("主图含水印");
    if (meta.textOverlays && meta.textOverlays.length > 0) policyIssues.push("主图含文字叠加");
    if (meta.personPresent) policyIssues.push("主图含人物");
    if (meta.packageIncluded) policyIssues.push("主图包含包装/第三方标识");
  }
  if (meta.resolutionOk === false) policyIssues.push("分辨率/像素不满足规则");
  if (policyIssues.length > 0) {
    checks.push(makeCheck("policy", false, "主图规则违规：" + policyIssues.join(","), ["policy_violation"]));
  } else {
    checks.push(makeCheck("policy", true, "符合主图/站点规则", []));
  }

  // 9. rights
  const rightsIssues: string[] = [];
  if (meta.logoPresent) rightsIssues.push("logo 未经授权");
  if (meta.watermarkPresent) rightsIssues.push("水印/第三方版权标记");
  if (meta.personPresent) rightsIssues.push("人物肖像未授权");
  if (meta.trademarkTerms && meta.trademarkTerms.length > 0) rightsIssues.push("商标词：" + meta.trademarkTerms.join(","));
  if (meta.thirdPartyBrandAssets && meta.thirdPartyBrandAssets.length > 0) rightsIssues.push("第三方品牌资产：" + meta.thirdPartyBrandAssets.join(","));
  if (meta.packageIncluded) rightsIssues.push("包装含第三方品牌标识");
  if (rightsIssues.length > 0) {
    checks.push(makeCheck("rights", false, "权利/合规风险：" + rightsIssues.join(","), ["rights_violation"]));
  } else {
    checks.push(makeCheck("rights", true, "未检测到未授权 logo/水印/商标/人物/第三方资产", []));
  }

  const failed = checks.filter((c) => !c.pass);
  let overallStatus: VisualFactCheckResult["overallStatus"] = "ok";
  if (failed.length > 0) {
    const hard = failed.some((c) => c.issues.some((i) => HARD_BLOCK_CODES.includes(i)));
    const human = failed.some((c) => c.issues.some((i) => NEEDS_HUMAN_CODES.includes(i)));
    if (hard) overallStatus = "blocked";
    else if (human) overallStatus = "needs_human";
  }
  const summary = overallStatus === "ok"
    ? "全部 9 项通过（供人工复核，不视为真实材质/尺寸证明）"
    : overallStatus === "blocked"
      ? "存在阻止发布/导出的失败项（identity/quantity/accessory/claim/policy/rights）"
      : "存在需要人工核验的项（缺事实依据，未伪造通过）";

  return { checks, overallStatus, summary };
}

function colorTokensMatch(expectedTokens: string[], observed: string): boolean {
  if (expectedTokens.length === 0) return observed.length > 0;
  return expectedTokens.every((t) => observed.includes(t));
}

function isClaimSupported(claim: string, facts: ConfirmedProductFact[]): boolean {
  for (const f of facts) {
    const v = norm(f.value);
    const l = norm(f.label);
    if (v && (claim.includes(v) || v.includes(claim))) return true;
    if (l && claim.includes(l)) return true;
  }
  return false;
}
