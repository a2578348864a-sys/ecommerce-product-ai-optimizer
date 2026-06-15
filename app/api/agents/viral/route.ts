import { NextRequest, NextResponse } from "next/server";
import { callAiJson, getSafeAiClientErrorMessage } from "@/lib/server/aiClient";
import { platformLabels, platformOptions } from "@/lib/types";
import type { EvidenceCard, MaterialAgentResult, MaterialInput, Platform, ViralAgentResult, ViralLevel } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 45;

const OPENAI_TIMEOUT_MS = 45 * 1000;
const MAX_OUTPUT_TOKENS = 2200;
const REQUEST_BODY_LIMIT_BYTES = 96 * 1024;
const MAX_MATERIAL_TEXT_LENGTH = 8000;

type ViralAiData = {
  score: number;
  level: ViralLevel;
  sellingPoints: string[];
  painPoints: string[];
  hooks: string[];
  titleSuggestions: string[];
  videoOpenings: string[];
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
  return jsonResponse({
    ok: false,
    error: { code, message },
  }, status);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function asLevel(value: unknown): ViralLevel {
  return value === "高" || value === "中" || value === "低" ? value : "低";
}

function asPlatform(value: unknown): Platform | null {
  return platformOptions.includes(value as Platform) ? value as Platform : null;
}

function clampScore(value: unknown) {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score)) return 50;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function limitItems(items: string[], max = 5) {
  return items.slice(0, max);
}

function normalizeAiData(value: unknown): ViralAiData {
  const source = isPlainObject(value) ? value : {};
  const score = clampScore(source.score);
  return {
    score,
    level: asLevel(source.level) || (score >= 72 ? "高" : score >= 45 ? "中" : "低"),
    sellingPoints: limitItems(asStringArray(source.sellingPoints)),
    painPoints: limitItems(asStringArray(source.painPoints)),
    hooks: limitItems(asStringArray(source.hooks)),
    titleSuggestions: limitItems(asStringArray(source.titleSuggestions)),
    videoOpenings: limitItems(asStringArray(source.videoOpenings)),
    risks: limitItems(asStringArray(source.risks)),
    beginnerConclusion: asString(source.beginnerConclusion, "当前素材证据不足，建议补充标题、卖点、价格、场景和评论反馈后再判断。"),
  };
}

function asLevelReason(level: ViralLevel, reason: string) {
  return { level, reason: reason || "证据不足" };
}

function toLegacyViralResult(data: ViralAiData): ViralAgentResult {
  return {
    titleAttraction: asLevelReason(data.level, data.hooks[0] || data.titleSuggestions[0] || "AI 已输出标题与钩子方向。"),
    sellingPointClarity: asLevelReason(data.level, data.sellingPoints[0] || "AI 已整理核心卖点。"),
    sceneSense: asLevelReason(data.level, data.videoOpenings[0] || "AI 已整理短视频开头方向。"),
    commentDemand: asLevelReason(data.level, data.painPoints[0] || "AI 已整理用户痛点和需求线索。"),
    painPointStrength: asLevelReason(data.level, data.painPoints[0] || "AI 已整理痛点强度。"),
    contentShootability: asLevelReason(data.level, data.videoOpenings[0] || "AI 已整理可拍内容方向。"),
    viralPotential: data.level,
    bonusPoints: limitItems(data.sellingPoints, 3),
    weakPoints: limitItems(data.risks, 3),
    optimizationSuggestions: limitItems(data.titleSuggestions, 3),
    suggestedAngles: limitItems(data.hooks, 3),
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

function buildPrompt(params: {
  title: string;
  productUrl: string;
  platform: Platform;
  materialText: string;
  materialResult?: MaterialAgentResult | null;
  evidenceCards?: EvidenceCard[];
}) {
  return [
    "你是电商运营团队里的“爆款拆解 Agent”。",
    "你的任务是分析用户提供的商品素材、笔记文案或评论反馈，判断它是否适合做内容种草与短视频选题。",
    "不要承诺销量，不要编造不存在的数据，不要输出医疗、金融或侵权保证。",
    "如果证据不足，请明确说证据不足，并给出小白能补充什么信息。",
    "",
    "必须只返回合法 JSON object，不要 Markdown，不要代码块，不要额外解释。",
    "JSON 字段固定为：",
    JSON.stringify({
      score: 0,
      level: "高 / 中 / 低",
      sellingPoints: [],
      painPoints: [],
      hooks: [],
      titleSuggestions: [],
      videoOpenings: [],
      risks: [],
      beginnerConclusion: "",
    }, null, 2),
    "",
    "字段要求：",
    "- score：0 到 100 的整数。",
    "- level：只能是 高、中、低。",
    "- sellingPoints：核心卖点，最多 5 条。",
    "- painPoints：用户痛点，最多 5 条。",
    "- hooks：内容钩子，最多 5 条。",
    "- titleSuggestions：标题优化建议，最多 5 条。",
    "- videoOpenings：短视频开头建议，最多 5 条。",
    "- risks：风险提醒，最多 5 条。",
    "- beginnerConclusion：一句小白能看懂的结论，说明优势、短板和下一步。",
    "",
    `平台：${platformLabels[params.platform]}`,
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
  platform: Platform;
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
        content: "你只输出严格 JSON。不要输出 Markdown、解释、代码块或额外文本。",
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
  const platform = asPlatform(body.platform);

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
