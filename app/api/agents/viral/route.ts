import { NextRequest, NextResponse } from "next/server";
import { callAiText, getAiConfig } from "@/lib/server/aiClient";
import type { EvidenceCard, MaterialAgentResult, MaterialInput, ViralAgentResult, ViralLevel } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 45;

const OPENAI_TIMEOUT_MS = 45 * 1000;
const MAX_OUTPUT_TOKENS = 2200;
const REQUEST_BODY_LIMIT_BYTES = 96 * 1024;

const levelReasonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    level: { type: "string", enum: ["高", "中", "低"] },
    reason: { type: "string" },
  },
  required: ["level", "reason"],
} as const;

const viralAgentJsonSchema = {
  name: "viral_agent_result",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      titleAttraction: levelReasonSchema,
      sellingPointClarity: levelReasonSchema,
      sceneSense: levelReasonSchema,
      commentDemand: levelReasonSchema,
      painPointStrength: levelReasonSchema,
      contentShootability: levelReasonSchema,
      viralPotential: { type: "string", enum: ["高", "中", "低"] },
      bonusPoints: { type: "array", items: { type: "string" } },
      weakPoints: { type: "array", items: { type: "string" } },
      optimizationSuggestions: { type: "array", items: { type: "string" } },
      suggestedAngles: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
    required: [
      "titleAttraction",
      "sellingPointClarity",
      "sceneSense",
      "commentDemand",
      "painPointStrength",
      "contentShootability",
      "viralPotential",
      "bonusPoints",
      "weakPoints",
      "optimizationSuggestions",
      "suggestedAngles",
      "summary",
    ],
  },
} as const;

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function getAccessPassword() {
  return process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD;
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

function asLevelReason(value: unknown) {
  const source = isPlainObject(value) ? value : {};
  const reason = asString(source.reason, "证据不足");
  return {
    level: asLevel(source.level),
    reason: reason || "证据不足",
  };
}

function stripCodeFence(outputText: string) {
  const trimmed = outputText.trim();
  const fencedJson = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fencedJson?.[1] ?? trimmed).trim();
}

function repairJsonText(outputText: string) {
  const withoutFence = stripCodeFence(outputText);
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  const sliced = start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence;
  return sliced
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/\u0000/g, "")
    .trim();
}

function parseAiJson(outputText: string): unknown {
  const first = stripCodeFence(outputText);
  if (!first) {
    throw new Error("Empty AI response");
  }

  try {
    return JSON.parse(first);
  } catch {
    return JSON.parse(repairJsonText(first));
  }
}

function normalizeViralAgentResult(value: unknown): ViralAgentResult {
  const source = isPlainObject(value) ? value : {};
  const result: ViralAgentResult = {
    titleAttraction: asLevelReason(source.titleAttraction),
    sellingPointClarity: asLevelReason(source.sellingPointClarity),
    sceneSense: asLevelReason(source.sceneSense),
    commentDemand: asLevelReason(source.commentDemand),
    painPointStrength: asLevelReason(source.painPointStrength),
    contentShootability: asLevelReason(source.contentShootability),
    viralPotential: asLevel(source.viralPotential),
    bonusPoints: asStringArray(source.bonusPoints).slice(0, 3),
    weakPoints: asStringArray(source.weakPoints).slice(0, 3),
    optimizationSuggestions: asStringArray(source.optimizationSuggestions).slice(0, 3),
    suggestedAngles: asStringArray(source.suggestedAngles).slice(0, 3),
    summary: asString(source.summary, "这个品的小红书爆款潜力还需要更多标题、卖点、场景或评论需求证据来判断。"),
  };

  if (!result.summary) {
    result.summary = "这个品的小红书爆款潜力还需要更多标题、卖点、场景或评论需求证据来判断。";
  }
  return result;
}

function getSafeLogPayload(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message.slice(0, 240),
    };
  }
  return { message: "Unknown error" };
}

function getViralAgentResponseFormat() {
  const config = getAiConfig();
  if (config.ok && config.data.provider !== "deepseek") {
    return { type: "json_schema" as const, json_schema: viralAgentJsonSchema };
  }

  return { type: "json_object" as const };
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

function buildInputText(body: Record<string, unknown>) {
  const keyword = asString(body.keyword);
  const manualText = asString(body.manualText);
  const linksText = asString(body.linksText);
  const materials = normalizeMaterials(body.materials);
  const imageNames = materials
    .filter((item) => item.type === "image")
    .map((item) => item.fileName || item.sourceName || "未命名图片")
    .filter(Boolean);

  return [
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

function buildViralAgentPrompt(inputText: string, materialResult: MaterialAgentResult, evidenceCards: EvidenceCard[]) {
  return [
    "你是小红书选品内容分析助手。",
    "你只判断“小红书内容爆款潜力”，不判断最终能不能做，不判断能不能做无货源，不负责找货源，不输出做或不做的最终建议。",
    "不要夸大，不要编造没有出现的数据。所有判断必须来自用户原始素材、素材接收 Agent 结果或证据卡片。",
    "如果素材里没有评论区信息，就在 commentDemand.reason 明确说明“评论需求证据不足”。",
    "如果没有价格、人群、场景，也要如实提示证据不足。",
    "标题吸引力只看标题/开头是否有钩子，不要把商品热度当成标题钩子。",
    "卖点清晰度看卖点是否具体、好理解、容易打动用户。",
    "场景代入感看是否有宿舍、通勤、办公、厨房、租房、旅行等明确使用场景。",
    "痛点强度看痛点是否真实、具体、容易引发共鸣。",
    "内容可拍性看是否容易做成小红书图文或短视频，不要判断供应链。",
    "bonusPoints、weakPoints、optimizationSuggestions、suggestedAngles 都最多 3 条，写小白能看懂的话。",
    "summary 用一句小白能看懂的话总结，必须点出优势和证据不足处。",
    "",
    "必须只输出合法 JSON object，字段如下：",
    JSON.stringify({
      titleAttraction: { level: "高 / 中 / 低", reason: "" },
      sellingPointClarity: { level: "高 / 中 / 低", reason: "" },
      sceneSense: { level: "高 / 中 / 低", reason: "" },
      commentDemand: { level: "高 / 中 / 低", reason: "" },
      painPointStrength: { level: "高 / 中 / 低", reason: "" },
      contentShootability: { level: "高 / 中 / 低", reason: "" },
      viralPotential: "高 / 中 / 低",
      bonusPoints: [],
      weakPoints: [],
      optimizationSuggestions: [],
      suggestedAngles: [],
      summary: "",
    }, null, 2),
    "",
    "素材接收 Agent 结果：",
    JSON.stringify(materialResult, null, 2),
    "",
    "证据卡片（可作为补充证据）：",
    JSON.stringify(summarizeEvidenceCards(evidenceCards), null, 2),
    "",
    "用户原始输入：",
    inputText,
  ].join("\n");
}

async function runViralAgent(inputText: string, materialResult: MaterialAgentResult, evidenceCards: EvidenceCard[]): Promise<ViralAgentResult> {
  const prompt = buildViralAgentPrompt(inputText, materialResult, evidenceCards);

  const aiResult = await callAiText({
    maxTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: OPENAI_TIMEOUT_MS,
    responseFormat: getViralAgentResponseFormat(),
    messages: [
      {
        role: "system",
        content: "你只输出严格 JSON。不要输出 Markdown、解释、代码块或额外文本。",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  if (!aiResult.ok) {
    throw new Error(aiResult.error.code);
  }

  return normalizeViralAgentResult(parseAiJson(aiResult.data));
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonError("这次素材太多了，建议先减少输入后重试。", 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("请求格式不正确，请刷新页面后重试。", 400);
  }

  if (!isPlainObject(body)) {
    return jsonError("请先放入素材。", 400);
  }

  const inputText = buildInputText(body);
  if (!inputText) {
    return jsonError("请先放入素材。", 400);
  }

  const materialResult = normalizeMaterialResult(body.materialAgentResult);
  if (!materialResult) {
    return jsonError("请先识别素材，再进行爆款拆解。", 400);
  }

  const configuredPassword = getAccessPassword();
  if (!configuredPassword) {
    return jsonError("服务端未配置访问密码。", 500);
  }

  if (asString(body.accessPassword) !== configuredPassword) {
    return jsonError("请先输入正确的访问密码。", 401);
  }

  try {
    const result = await runViralAgent(inputText, materialResult, normalizeEvidenceCards(body.evidenceCards));
    return NextResponse.json({ result });
  } catch (error) {
    console.error("Viral Agent failed", getSafeLogPayload(error));
    return jsonError("爆款拆解失败，请补充标题、卖点、场景或评论需求后重试。", 500);
  }
}
