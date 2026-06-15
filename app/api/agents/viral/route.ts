import { NextRequest, NextResponse } from "next/server";
import { callAiJson, getSafeAiClientErrorMessage } from "@/lib/server/aiClient";
import { platformLabels, platformOptions } from "@/lib/types";
import type { EvidenceCard, MaterialAgentResult, MaterialInput, Platform, ViralAgentResult, ViralLevel } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 45;

const OPENAI_TIMEOUT_MS = 45 * 1000;
const MAX_OUTPUT_TOKENS = 2400;
const REQUEST_BODY_LIMIT_BYTES = 96 * 1024;
const MAX_MATERIAL_TEXT_LENGTH = 8000;

const agentPlatformLabels = {
  ...platformLabels,
  tiktok: "TikTok",
  "1688": "1688",
  alibaba: "阿里国际站",
} as const;

type AgentPlatform = keyof typeof agentPlatformLabels;
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
  oneLineSummary: "素材有一定可拆解空间，但需要补充更具体的卖点、场景和用户反馈。",
  sellingPoints: ["补充商品的核心功能、价格带和差异点，让用户知道为什么值得点开。"],
  painPoints: ["补充目标用户正在遇到的具体麻烦，不要只写泛泛的好用。"],
  hooks: ["用“人群 + 痛点 + 结果”写开头，例如：桌面乱的人先看这个收纳思路。"],
  titleSuggestions: ["标题里加入具体人群、使用场景和结果感，避免只写商品名。"],
  videoOpenings: ["前三秒先展示使用前的混乱状态，再切到解决后的对比画面。"],
  commentTriggers: ["引导用户评论自己的使用场景、尺寸疑问或想看的对比角度。"],
  conversionSuggestions: ["补充价格、适用人群、使用步骤和购买前需要确认的尺寸/规格。"],
  risks: ["当前证据不足，需人工复核平台规则、价格竞争和夸大宣传风险。"],
  beginnerConclusion: "先把素材补到“谁用、解决什么、怎么拍、为什么买”四点，再决定是否消耗更多预算测试。",
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

function asAgentPlatform(value: unknown): AgentPlatform | null {
  const text = asString(value);
  if ((platformOptions as readonly string[]).includes(text)) return text as Platform;
  if (text === "tiktok" || text === "1688" || text === "alibaba") return text;
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

function getPlatformInstruction(platform: AgentPlatform) {
  switch (platform) {
    case "xhs":
      return "小红书重点看：种草感、真实体验、标题钩子、评论区话题、是否像真实用户分享。";
    case "douyin":
      return "抖音重点看：前三秒停留、冲突感、画面动作、转化口播、是否能用短视频讲清楚。";
    case "tiktok":
      return "TikTok 重点看：视觉冲击、海外用户能否秒懂、短句钩子、场景动作和跨文化表达。";
    case "taobao":
    case "tmall":
      return "淘宝/天猫重点看：搜索转化、卖点可信度、购买理由、规格价格是否能支撑下单。";
    case "jd":
      return "京东重点看：品质信任、参数清楚、售后顾虑、购买理由是否理性充分。";
    case "pdd":
      return "拼多多重点看：低价理由、强对比、刚需痛点、是否能减少廉价感和信任顾虑。";
    case "1688":
      return "1688 重点看：批发/货盘/成本/供货吸引力、是否适合拿来做选品或分销。";
    case "alibaba":
      return "阿里国际站重点看：B端采购理由、规格参数、应用场景、MOQ/供货能力和海外买家表达。";
    default:
      return "手动输入重点看：素材证据是否完整、卖点是否具体、场景和用户痛点是否清楚。";
  }
}

function buildPrompt(params: {
  title: string;
  productUrl: string;
  platform: AgentPlatform;
  materialText: string;
  materialResult?: MaterialAgentResult | null;
  evidenceCards?: EvidenceCard[];
}) {
  return [
    "你是资深电商运营和内容投放负责人，正在做“爆款素材拆解报告”。",
    "你的任务不是泛泛夸产品，而是把用户给的标题、链接、商品素材、评论反馈或选题想法，拆成运营可以直接照着改的建议。",
    "必须基于用户素材判断，不要编造销量、评价、平台数据或功效承诺。证据不足时要直接写“证据不足”，并告诉小白运营下一步补什么。",
    "",
    "重点分析维度：",
    "- 用户第一眼为什么会停留，停留理由是否具体。",
    "- 素材钩子强不强，是否有反差、痛点、结果感或悬念。",
    "- 卖点是否具体，是否能说清楚比同类强在哪里。",
    "- 痛点是否真实，是否来自明确人群、场景或评论需求。",
    "- 场景是否清楚，用户能不能想象自己会怎么用。",
    "- 是否适合短视频/图文种草，前三秒或首图怎么做。",
    "- 标题是否有点击欲，是否避免只写商品名。",
    "- 哪些地方像广告硬推，应该如何改成真实体验表达。",
    "- 小白运营应该怎么改标题、开头、评论区话题和转化信息。",
    "",
    `平台：${agentPlatformLabels[params.platform]}`,
    `平台差异要求：${getPlatformInstruction(params.platform)}`,
    "",
    "必须只返回合法 JSON object，不要 Markdown，不要代码块，不要解释文字。",
    "JSON 字段固定为：",
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
    "字段要求：",
    "- score 必须是 0-100 的数字；不要写百分号。",
    "- level 必须根据 score 输出：80+ 高潜力，65-79 可优化，50-64 一般，50以下 不建议主推。",
    "- oneLineSummary 用一句话说清“为什么有/没有爆款潜力”。",
    "- 每个数组输出 3-5 条；每条必须具体、可执行，禁止只写“提升吸引力”“优化内容”这种空话。",
    "- sellingPoints 写核心卖点，必须贴近素材。",
    "- painPoints 写用户真实痛点或证据不足点。",
    "- hooks 写开头钩子/首图角度。",
    "- titleSuggestions 写可以直接改标题的方向。",
    "- videoOpenings 写短视频前三秒脚本或画面动作。",
    "- commentTriggers 写评论区可引导的话题和问题。",
    "- conversionSuggestions 写转化补强建议，例如价格、规格、对比、信任、购买理由。",
    "- risks 写广告硬推、夸大、侵权、平台规则、证据不足等风险。",
    "- beginnerConclusion 写给小白运营的一段结论，包含下一步怎么改。",
    "",
    params.title ? `素材标题：${params.title}` : "素材标题：未提供",
    params.productUrl ? `商品/素材链接：${params.productUrl}` : "商品/素材链接：未提供",
    "",
    "素材文案：",
    params.materialText,
    "",
    params.materialResult ? "素材接收 Agent 结果：" : "",
    params.materialResult ? JSON.stringify(params.materialResult, null, 2) : "",
    params.evidenceCards?.length ? "证据卡片：" : "",
    params.evidenceCards?.length ? JSON.stringify(summarizeEvidenceCards(params.evidenceCards), null, 2) : "",
  ].filter(Boolean).join("\n");
}

async function runViralAgent(params: {
  title: string;
  productUrl: string;
  platform: AgentPlatform;
  materialText: string;
  materialResult?: MaterialAgentResult | null;
  evidenceCards?: EvidenceCard[];
}): Promise<ViralAiData> {
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
    throw new Error(aiResult.error.code);
  }

  return normalizeAiData(aiResult.data);
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

async function handleStandaloneRequest(body: Record<string, unknown>) {
  const title = asString(body.title).slice(0, 160);
  const productUrl = asString(body.productUrl || body.url).slice(0, 400);
  const materialText = asString(body.materialText || body.content);
  const platform = asAgentPlatform(body.platform);

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

  try {
    const data = await runViralAgent({ title, productUrl, platform, materialText });
    return jsonResponse({ ok: true, data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown_error";
    return toStructuredError(code);
  }
}

async function handleLegacyRequest(body: Record<string, unknown>) {
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

  try {
    const data = await runViralAgent({
      title: asString(body.keyword),
      productUrl: "",
      platform: "xhs",
      materialText,
      materialResult,
      evidenceCards: normalizeEvidenceCards(body.evidenceCards),
    });
    return jsonResponse({ ok: true, data, result: toLegacyViralResult(data) });
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
  const configuredPassword = getAccessPassword();
  if (!configuredPassword) {
    return authError("missing_access_password", 500, standalone);
  }

  if (asString(body.accessPassword) !== configuredPassword) {
    return authError("unauthorized", 401, standalone);
  }

  if (standalone) {
    return handleStandaloneRequest(body);
  }

  return handleLegacyRequest(body);
}
