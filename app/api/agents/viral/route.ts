import { NextRequest, NextResponse } from "next/server";
import { callAiJson, getSafeAiClientErrorMessage } from "@/lib/server/aiClient";
import { allPlatformLabels, platformLabels, platformOptions } from "@/lib/types";
import type { EvidenceCard, MaterialAgentResult, MaterialInput, Platform, ViralAgentResult, ViralLevel } from "@/lib/types";
import { requireAuthenticated, ensureDemoAiQuota, consumeDemoAiCalls, type DemoAccessSnapshot } from "@/lib/server/demoGuard";
import type { AccessContext } from "@/lib/server/accessPassword";

export const runtime = "nodejs";
export const maxDuration = 45;

const OPENAI_TIMEOUT_MS = 45 * 1000;
const MAX_OUTPUT_TOKENS = 2400;
const REQUEST_BODY_LIMIT_BYTES = 96 * 1024;
const MAX_MATERIAL_TEXT_LENGTH = 8000;

const allstrings = new Set(Object.keys(allPlatformLabels));
type ViralPotentialLevel = "高潜力" | "可优化" | "一般" | "不建议主推";

type ViralAiData = {
  score: number;
  level: ViralPotentialLevel;
  oneLineSummary: string;
  sellingPoints: string[];
  painPoints: string[];
  hooks: string[];
  titleSuggestions: string[];
  videoOpenings: string[];
  commentTriggers: string[];
  conversionSuggestions: string[];
  risks: string[];
  beginnerConclusion: string;
};

type ApiError = {
  code: string;
  message: string;
};

type ApiResponse =
  | { ok: true; data: ViralAiData; result?: ViralAgentResult }
  | { ok: false; error: ApiError };

const defaultAiData: ViralAiData = {
  score: 60,
  level: "一般",
  oneLineSummary: "素材有一定可拆解空间，但需要补充更具体的卖点、使用场景和用户反馈，以便评估海外市场适配性。",
  sellingPoints: ["补充商品的核心功能、价格带和差异化亮点，让观众理解为什么值得关注。"],
  painPoints: ["明确目标用户当前面临的具体问题，避免只说'好用'而不说'解决了什么痛点'。"],
  hooks: ["使用'人群 + 痛点 + 结果'公式写内容钩子，例如：露营党终于找到不占地方的折叠杯。"],
  titleSuggestions: ["标题包含具体人群、使用场景和结果感，避免只写商品名。"],
  videoOpenings: ["前 3 秒展示使用前的混乱状态，然后切到解决后的对比画面。"],
  commentTriggers: ["引导观众评论自己的使用场景、尺寸疑问，或想看什么对比。"],
  conversionSuggestions: ["补充价格、目标人群、使用步骤和购买前需确认的关键规格。"],
  risks: ["当前证据不足，需人工复核平台政策、价格竞争和夸大宣传风险。跨境合规性尚未评估。"],
  beginnerConclusion: "先确保素材覆盖'谁用、解决什么、怎么拍、为什么买'四个要素，再决定是否投入更多预算测试。",
};

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function legacyJsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function getAccessPassword() {
  return process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD;
}

function authError(code: "missing_access_password" | "unauthorized", status: 401 | 500, standalone: boolean) {
  const message = code === "missing_access_password" ? "服务端访问密码未配置。" : "访问密码错误或缺失。";
  if (!standalone) {
    return legacyJsonError(message, status);
  }
  return jsonResponse({ ok: false, error: { code, message } }, status);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function withDefaultItems(items: string[], fallback: string[], max = 5) {
  const cleaned = items.filter(Boolean).slice(0, max);
  return cleaned.length ? cleaned : fallback.slice(0, max);
}

function clampScore(value: unknown) {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score)) return 60;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function levelFromScore(score: number): ViralPotentialLevel {
  if (score >= 80) return "高潜力";
  if (score >= 65) return "可优化";
  if (score >= 50) return "一般";
  return "不建议主推";
}

function legacyLevelFromScore(score: number): ViralLevel {
  if (score >= 80) return "高";
  if (score >= 50) return "中";
  return "低";
}

function asstring(value: unknown): string | null {
  const text = asString(value);
  if (allstrings.has(text)) return text;
  return null;
}

function normalizeAiData(value: unknown): ViralAiData {
  const source = isPlainObject(value) ? value : {};
  const score = clampScore(source.score);
  const fallback = defaultAiData;
  return {
    score,
    level: levelFromScore(score),
    oneLineSummary: asString(source.oneLineSummary, fallback.oneLineSummary) || fallback.oneLineSummary,
    sellingPoints: withDefaultItems(asStringArray(source.sellingPoints), fallback.sellingPoints),
    painPoints: withDefaultItems(asStringArray(source.painPoints), fallback.painPoints),
    hooks: withDefaultItems(asStringArray(source.hooks), fallback.hooks),
    titleSuggestions: withDefaultItems(asStringArray(source.titleSuggestions), fallback.titleSuggestions),
    videoOpenings: withDefaultItems(asStringArray(source.videoOpenings), fallback.videoOpenings),
    commentTriggers: withDefaultItems(asStringArray(source.commentTriggers), fallback.commentTriggers),
    conversionSuggestions: withDefaultItems(asStringArray(source.conversionSuggestions), fallback.conversionSuggestions),
    risks: withDefaultItems(asStringArray(source.risks), fallback.risks),
    beginnerConclusion: asString(source.beginnerConclusion, fallback.beginnerConclusion) || fallback.beginnerConclusion,
  };
}

function asLevelReason(level: ViralLevel, reason: string) {
  return { level, reason: reason || "证据不足" };
}

function toLegacyViralResult(data: ViralAiData): ViralAgentResult {
  const level = legacyLevelFromScore(data.score);
  return {
    titleAttraction: asLevelReason(level, data.hooks[0] || data.titleSuggestions[0] || data.oneLineSummary),
    sellingPointClarity: asLevelReason(level, data.sellingPoints[0] || data.oneLineSummary),
    sceneSense: asLevelReason(level, data.videoOpenings[0] || data.oneLineSummary),
    commentDemand: asLevelReason(level, data.commentTriggers[0] || data.painPoints[0] || data.oneLineSummary),
    painPointStrength: asLevelReason(level, data.painPoints[0] || data.oneLineSummary),
    contentShootability: asLevelReason(level, data.videoOpenings[0] || data.hooks[0] || data.oneLineSummary),
    viralPotential: level,
    bonusPoints: data.sellingPoints.slice(0, 3),
    weakPoints: data.risks.slice(0, 3),
    optimizationSuggestions: data.conversionSuggestions.slice(0, 3),
    suggestedAngles: data.hooks.slice(0, 3),
    summary: data.beginnerConclusion,
  };
}

function normalizeMaterials(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is MaterialInput => isPlainObject(item)).slice(0, 10)
    : [];
}

function normalizeMaterialResult(value: unknown): MaterialAgentResult | null {
  if (!isPlainObject(value)) return null;
  return {
    productType: asString(value.productType, "未提到"),
    sellingPoints: asStringArray(value.sellingPoints),
    targetUsers: asStringArray(value.targetUsers),
    usageScenarios: asStringArray(value.usageScenarios),
    priceRange: asString(value.priceRange, "未提到"),
    painPoints: asStringArray(value.painPoints),
    commentDemands: asStringArray(value.commentDemands),
    riskWords: asStringArray(value.riskWords),
    materialCompleteness:
      value.materialCompleteness === "完整" || value.materialCompleteness === "一般" || value.materialCompleteness === "不完整"
        ? value.materialCompleteness
        : "不完整",
    missingInfo: asStringArray(value.missingInfo),
    summary: asString(value.summary),
  };
}

function normalizeEvidenceCards(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is EvidenceCard => isPlainObject(item)).slice(0, 5)
    : [];
}

function buildLegacyInputText(body: Record<string, unknown>) {
  const input = asString(body.input);
  const keyword = asString(body.keyword);
  const manualText = asString(body.manualText);
  const linksText = asString(body.linksText);
  const materials = normalizeMaterials(body.materials);
  const imageNames = materials
    .filter((item) => item.type === "image")
    .map((item) => item.fileName || item.sourceName || "未命名图片")
    .filter(Boolean);

  return [
    input ? `用户输入：\n${input}` : "",
    keyword ? `关键词/品类：${keyword}` : "",
    manualText ? `用户原始素材：\n${manualText}` : "",
    linksText ? `用户粘贴链接：\n${linksText}` : "",
    imageNames.length ? `用户上传图片文件名：${imageNames.join("、")}` : "",
  ].filter(Boolean).join("\n\n").trim();
}

function summarizeEvidenceCards(cards: EvidenceCard[]) {
  return cards.map((card, index) => ({
    index: index + 1,
    productName: card.productName || "",
    pageTitle: card.pageTitle || "",
    description: card.visibleDescription || "",
    priceText: card.priceText || "",
    heatText: card.salesText || card.ratingText || card.rankText || "",
    userNotes: card.userNotes || "",
    riskNotes: card.riskNotes || "",
    missingFields: card.missingFields || [],
  }));
}

function getPlatformInstruction(platform: string) {
  switch (platform) {
    case "tiktok":
      return "TikTok: Focus on visual impact, whether global audiences can instantly understand the hook, short punchy text overlays, scenario-driven action, and cross-cultural appeal.";
    case "amazon":
      return "Amazon: Focus on search ranking, review count and rating, Q&A section pain points, main image and A+ content quality, price competitiveness, and whether selling points are substantiated.";
    case "etsy":
      return "Etsy: Focus on handmade/design feel, story-driven descriptions, material and craftsmanship details, personalization level, and niche appeal.";
    case "shopify":
      return "Shopify / independent store: Focus on landing page persuasiveness, product description completeness, trust signals, and add-to-cart conversion elements.";
    case "instagram":
      return "Instagram: Focus on visual aesthetics, lifestyle integration, Reels hook strength, carousel storytelling, and whether the product fits organic discovery.";
    case "pinterest":
      return "Pinterest: Focus on visual search intent, idea-pin storytelling, DIY/inspiration angles, and seasonal/timeless content strategy.";
    case "youtube_shorts":
      return "YouTube Shorts: Focus on quick demonstration, problem-solution framing, before/after payoff, and whether the viewer gets value in under 30 seconds.";
    case "1688":
      return "1688: Focus on wholesale/supply chain appeal, cost structure, and whether the product is suitable for sourcing or distribution (supplementary reference).";
    case "alibaba":
      return "Alibaba International: Focus on B2B buying rationale, specs, application scenarios, MOQ/supply capacity, and global buyer messaging (supplementary reference).";
    case "ebay":
      return "eBay: Focus on auction/BIN pricing strategy, seller reputation, return policy, and title keyword coverage.";
    case "tiktok_shop":
      return "TikTok Shop: Focus on short-video selling power, livestream conversion, comment engagement rate, and product link click-through.";
    case "shopee":
    case "lazada":
      return "Southeast Asia platforms: Focus on localized messaging, price sensitivity, religious/cultural taboos, and logistics expectations.";
    case "temu":
      return "Temu: Focus on extreme value proposition, main image visual impact, and whether the product fits the ultra-low-price viral model.";
    case "other":
      return "Other overseas platform: Evaluate based on input material — prioritize whether the evidence is complete and actionable.";
    default:
      return "Manual input: Focus on whether the material evidence is complete, selling points are specific, and scenarios + user pain points are clear.";
  }
}

function buildPrompt(params: {
  title: string;
  productUrl: string;
  platform: string;
  materialText: string;
  materialResult?: MaterialAgentResult | null;
  evidenceCards?: EvidenceCard[];
}) {
  return [
    "You are a senior cross-border e-commerce operations and content strategist creating an \"overseas viral trend & product opportunity breakdown report\".",
    "Your task is NOT to hype a product, but to break down the title, link, product material, comment feedback, or content idea the user provides into actionable, copy-paste-ready recommendations for overseas platforms.",
    "Base all judgments on the user's provided material. Do NOT fabricate sales data, reviews, platform metrics, or efficacy claims. Where evidence is insufficient, state \"insufficient evidence\" and tell the beginner operator what to supplement next.",
    "",
    "Key analysis dimensions:",
    "- Why would a viewer stop scrolling — is the stopping reason specific and compelling?",
    "- How strong is the hook — does it have contrast, pain point, result payoff, or curiosity gap?",
    "- Are selling points specific — can you clearly explain why this beats alternatives?",
    "- Are pain points real — do they come from a defined audience, scenario, or comment demand?",
    "- Is the use scenario clear — can the audience instantly picture themselves using it?",
    "- Is it suitable for short video or visual content — how to execute the first 3 seconds or lead image?",
    "- Does the title/caption drive clicks — does it avoid being just a product name?",
    "- Which parts read like hard-sell ads — how to rewrite them as authentic experience content?",
    "- What should a beginner cross-border operator do to improve the title, hook, comment engagement, and conversion info?",
    "- Cross-border viability: Is this product suitable for overseas markets? Consider cultural fit, shipping complexity, compliance, and whether a beginner can execute.",
    "",
    `Platform: ${allPlatformLabels[params.platform] ?? params.platform}`,
    `Platform-specific focus: ${getPlatformInstruction(params.platform)}`,
    "",
    "CRITICAL: Return ONLY a valid JSON object. No markdown, no code blocks, no explanatory text.",
    "JSON fields (fixed):",
    JSON.stringify({
      score: 60,
      level: "一般",
      oneLineSummary: "",
      sellingPoints: [],
      painPoints: [],
      hooks: [],
      titleSuggestions: [],
      videoOpenings: [],
      commentTriggers: [],
      conversionSuggestions: [],
      risks: [],
      beginnerConclusion: "",
    }, null, 2),
    "",
    "Field requirements:",
    "- score: integer 0-100, no percent sign.",
    "- level: based on score — 80+ \"高潜力\", 65-79 \"可优化\", 50-64 \"一般\", below 50 \"不建议主推\".",
    "- oneLineSummary: one sentence explaining WHY this does or doesn't have viral/opportunity potential for overseas markets.",
    "- Each array: 3-5 items; each item must be specific and executable. NO vague filler like \"improve appeal\" or \"optimize content\".",
    "- sellingPoints: core selling points, tied closely to the material.",
    "- painPoints: real user pain points or evidence gaps.",
    "- hooks: opening hooks / lead image angles for short video or social content.",
    "- titleSuggestions: specific title/caption directions the operator can directly adapt.",
    "- videoOpenings: first-3-second script or visual action for short video.",
    "- commentTriggers: topics and questions to drive comment engagement.",
    "- conversionSuggestions: recommendations to strengthen conversion, e.g. price clarity, specs, competitor comparison, trust signals, purchase rationale.",
    "- risks: hard-sell language, exaggerated claims, IP/trademark infringement risk, platform policy issues, evidence gaps, cross-border compliance concerns, shipping/after-sales risks.",
    "- beginnerConclusion: a paragraph for a beginner cross-border operator, covering what to do next. Do NOT promise guaranteed success, \"must-buy\", or zero-risk outcomes.",
    "",
    "Additional cross-border context to assess:",
    "- Cross-border sales feasibility for this product.",
    "- Supply chain complexity (sourcing, MOQ, lead time).",
    "- Compliance risk (FDA, CE, trademark, patent, safety certifications).",
    "- Logistics/after-sales risk (shipping cost, damage rate, returns).",
    "- Whether a beginner can realistically execute on this opportunity.",
    "",
    params.title ? `Title: ${params.title}` : "Title: not provided",
    params.productUrl ? `Product/Content Link: ${params.productUrl}` : "Product/Content Link: not provided",
    "",
    "Material Text:",
    params.materialText,
    "",
    params.materialResult ? "Material Agent Result:" : "",
    params.materialResult ? JSON.stringify(params.materialResult, null, 2) : "",
    params.evidenceCards?.length ? "Evidence Cards:" : "",
    params.evidenceCards?.length ? JSON.stringify(summarizeEvidenceCards(params.evidenceCards), null, 2) : "",
  ].filter(Boolean).join("\n");
}

async function runViralAgent(params: {
  title: string;
  productUrl: string;
  platform: string;
  materialText: string;
  materialResult?: MaterialAgentResult | null;
  evidenceCards?: EvidenceCard[];
}): Promise<{ data: ViralAiData; aiOk: boolean }> {
  const aiResult = await callAiJson<unknown>({
    maxTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: OPENAI_TIMEOUT_MS,
    messages: [
      {
        role: "system",
        content: "你只输出严格 JSON object。不要输出 Markdown、解释、代码块或额外文本。",
      },
      {
        role: "user",
        content: buildPrompt(params),
      },
    ],
  });

  if (!aiResult.ok) {
    return { data: defaultAiData, aiOk: false };
  }

  return { data: normalizeAiData(aiResult.data), aiOk: true };
}

function getErrorMessage(code: string) {
  if (code === "missing_api_key" || code === "missing_model" || code === "missing_base_url") {
    return "AI 服务未配置，请先检查服务端环境变量。";
  }
  if (code === "timeout") return "AI 请求超时，请稍后重试。";
  if (code === "json_parse_error") return "AI 返回格式异常，请稍后重试。";
  return getSafeAiClientErrorMessage(code as Parameters<typeof getSafeAiClientErrorMessage>[0]);
}

function toStructuredError(code: string, status = 500) {
  return jsonResponse({
    ok: false,
    error: {
      code,
      message: getErrorMessage(code),
    },
  }, status);
}

function isStandaloneViralRequest(body: Record<string, unknown>) {
  return "materialText" in body || "content" in body || "platform" in body || "productUrl" in body || "title" in body;
}

async function handleStandaloneRequest(
  body: Record<string, unknown>,
  accessCtx: AccessContext,
  _demoScreen: DemoAccessSnapshot | null,
) {
  const title = asString(body.title).slice(0, 160);
  const productUrl = asString(body.productUrl || body.url).slice(0, 400);
  const materialText = asString(body.materialText || body.content);
  const platform = asstring(body.platform);

  if (!materialText) {
    return jsonResponse({
      ok: false,
      error: { code: "missing_content", message: "请先填写素材文案。" },
    }, 400);
  }

  if (materialText.length > MAX_MATERIAL_TEXT_LENGTH) {
    return jsonResponse({
      ok: false,
      error: { code: "content_too_large", message: "素材文案太长，请控制在 8000 字以内。" },
    }, 413);
  }

  if (!platform) {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_platform", message: "平台选择不正确，请重新选择。" },
    }, 400);
  }

  if (accessCtx.mode === "demo") {
    const quota = ensureDemoAiQuota(accessCtx, 1);
    if (!quota.ok) {
      return jsonResponse({ ok: false, error: { code: quota.code, message: quota.message } }, quota.status);
    }
  }

  try {
    const { data, aiOk } = await runViralAgent({ title, productUrl, platform, materialText });
    if (!aiOk) {
      return toStructuredError("ai_error");
    }
    const updatedScreen = accessCtx.mode === "demo" ? consumeDemoAiCalls(accessCtx, 1) : null;
    return jsonResponse({ ok: true, data, ...(updatedScreen ? { demoAccess: updatedScreen } : {}) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_error";
    return toStructuredError(code);
  }
}

async function handleLegacyRequest(
  body: Record<string, unknown>,
  accessCtx: AccessContext,
  _demoScreen: DemoAccessSnapshot | null,
) {
  const materialText = buildLegacyInputText(body);
  if (!materialText) {
    return legacyJsonError("请先放入素材。", 400);
  }

  if (materialText.length > MAX_MATERIAL_TEXT_LENGTH) {
    return legacyJsonError("这次素材太多了，建议先减少输入后重试。", 413);
  }

  const materialResult = normalizeMaterialResult(body.materialAgentResult);
  if (!materialResult) {
    return legacyJsonError("请先识别素材，再进行爆款拆解。", 400);
  }

  if (accessCtx.mode === "demo") {
    const quota = ensureDemoAiQuota(accessCtx, 1);
    if (!quota.ok) {
      return jsonResponse({ ok: false, error: { code: quota.code, message: quota.message } }, quota.status);
    }
  }

  try {
    const { data, aiOk } = await runViralAgent({
      title: asString(body.keyword),
      productUrl: "",
      platform: "tiktok",
      materialText,
      materialResult,
      evidenceCards: normalizeEvidenceCards(body.evidenceCards),
    });
    if (!aiOk) {
      return legacyJsonError(getErrorMessage("ai_error"), 500);
    }
    const updatedScreen = accessCtx.mode === "demo" ? consumeDemoAiCalls(accessCtx, 1) : null;
    return jsonResponse({ ok: true, data, result: toLegacyViralResult(data), ...(updatedScreen ? { demoAccess: updatedScreen } : {}) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_error";
    return legacyJsonError(getErrorMessage(code), 500);
  }
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonResponse({
      ok: false,
      error: { code: "body_too_large", message: "请求体过大，请减少素材后重试。" },
    }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_json", message: "请求格式不正确，请刷新页面后重试。" },
    }, 400);
  }

  if (!isPlainObject(body)) {
    return jsonResponse({
      ok: false,
      error: { code: "invalid_body", message: "请求体必须是 JSON object。" },
    }, 400);
  }

  const standalone = isStandaloneViralRequest(body);
  const authResult = requireAuthenticated(request, body as Record<string, unknown>);
  if (!authResult.ok) {
    return NextResponse.json({ ok: false, error: { code: authResult.code, message: authResult.message } }, { status: authResult.status });
  }
  const accessCtx = authResult.context;
  let demoScreen: DemoAccessSnapshot | null = null;

  if (standalone) {
    return handleStandaloneRequest(body, accessCtx, demoScreen);
  }

  return handleLegacyRequest(body, accessCtx, demoScreen);
}
