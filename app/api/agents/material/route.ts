import { NextRequest, NextResponse } from "next/server";
import { callAiText, getAiConfig } from "@/lib/server/aiClient";
import type { MaterialAgentCompleteness, MaterialAgentResult, MaterialInput } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 45;

const OPENAI_TIMEOUT_MS = 45 * 1000;
const MAX_OUTPUT_TOKENS = 1800;
const REQUEST_BODY_LIMIT_BYTES = 64 * 1024;

const materialAgentJsonSchema = {
  name: "material_agent_result",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      productType: { type: "string" },
      sellingPoints: { type: "array", items: { type: "string" } },
      targetUsers: { type: "array", items: { type: "string" } },
      usageScenarios: { type: "array", items: { type: "string" } },
      priceRange: { type: "string" },
      painPoints: { type: "array", items: { type: "string" } },
      commentDemands: { type: "array", items: { type: "string" } },
      riskWords: { type: "array", items: { type: "string" } },
      materialCompleteness: { type: "string", enum: ["完整", "一般", "不完整"] },
      missingInfo: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
    required: [
      "productType",
      "sellingPoints",
      "targetUsers",
      "usageScenarios",
      "priceRange",
      "painPoints",
      "commentDemands",
      "riskWords",
      "materialCompleteness",
      "missingInfo",
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

function asCompleteness(value: unknown): MaterialAgentCompleteness {
  return value === "完整" || value === "一般" || value === "不完整" ? value : "不完整";
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

function normalizeMaterialAgentResult(value: unknown): MaterialAgentResult {
  const source = isPlainObject(value) ? value : {};
  const result: MaterialAgentResult = {
    productType: asString(source.productType, "未提到"),
    sellingPoints: asStringArray(source.sellingPoints),
    targetUsers: asStringArray(source.targetUsers),
    usageScenarios: asStringArray(source.usageScenarios),
    priceRange: asString(source.priceRange, "未提到") || "未提到",
    painPoints: asStringArray(source.painPoints),
    commentDemands: asStringArray(source.commentDemands),
    riskWords: asStringArray(source.riskWords),
    materialCompleteness: asCompleteness(source.materialCompleteness),
    missingInfo: asStringArray(source.missingInfo),
    summary: asString(source.summary, "这段素材信息还不够完整，建议补充商品、价格、人群、场景或评论反馈。"),
  };

  if (!result.productType) result.productType = "未提到";
  if (!result.priceRange) result.priceRange = "未提到";
  if (!result.summary) {
    result.summary = "这段素材信息还不够完整，建议补充商品、价格、人群、场景或评论反馈。";
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

function getMaterialAgentResponseFormat() {
  const config = getAiConfig();
  if (config.ok && config.data.provider !== "deepseek") {
    return { type: "json_schema" as const, json_schema: materialAgentJsonSchema };
  }

  return { type: "json_object" as const };
}

function normalizeMaterials(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is MaterialInput => isPlainObject(item)).slice(0, 10)
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
    manualText ? `用户粘贴内容：\n${manualText}` : "",
    linksText ? `用户粘贴链接：\n${linksText}` : "",
    imageNames.length ? `用户上传图片文件名：${imageNames.join("、")}` : "",
  ].filter(Boolean).join("\n\n").trim();
}

function buildMaterialAgentPrompt(inputText: string) {
  return [
    "你是“素材接收 Agent”。",
    "你的任务只做信息提取：把用户输入的小红书笔记、商品信息、选品想法整理成结构化证据。",
    "不要判断能不能做，不要输出最终选品结论，不要给投资或经营保证。",
    "如果素材里没有提到某项，就用空数组或“未提到”。不要编造。",
    "初步风险词只提取素材中出现或强相关的敏感表达，例如：三天见效、正品、大牌平替、治疗、祛痘、减肥、永久、根治。",
    "素材完整度规则：商品类型、卖点、人群、场景、价格、评论反馈大多齐全=完整；有一半左右=一般；缺很多=不完整。",
    "summary 用一句小白能看懂的话总结素材，不要长篇大论。",
    "",
    "必须只输出合法 JSON object，字段为：",
    JSON.stringify({
      productType: "",
      sellingPoints: [],
      targetUsers: [],
      usageScenarios: [],
      priceRange: "",
      painPoints: [],
      commentDemands: [],
      riskWords: [],
      materialCompleteness: "完整 / 一般 / 不完整",
      missingInfo: [],
      summary: "",
    }, null, 2),
    "",
    "用户素材：",
    inputText,
  ].join("\n");
}

async function runMaterialAgent(inputText: string): Promise<MaterialAgentResult> {
  const aiResult = await callAiText({
    maxTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: OPENAI_TIMEOUT_MS,
    responseFormat: getMaterialAgentResponseFormat(),
    messages: [
      {
        role: "system",
        content: "你只输出严格 JSON。不要输出 Markdown、解释、代码块或额外文本。",
      },
      {
        role: "user",
        content: buildMaterialAgentPrompt(inputText),
      },
    ],
  });

  if (!aiResult.ok) {
    throw new Error(aiResult.error.code);
  }

  return normalizeMaterialAgentResult(parseAiJson(aiResult.data));
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

  const configuredPassword = getAccessPassword();
  if (!configuredPassword) {
    return jsonError("服务端未配置访问密码。", 500);
  }

  if (asString(body.accessPassword) !== configuredPassword) {
    return jsonError("请先输入正确的访问密码。", 401);
  }

  try {
    const result = await runMaterialAgent(inputText);
    return NextResponse.json({ result });
  } catch (error) {
    console.error("Material Agent failed", getSafeLogPayload(error));
    return jsonError("素材识别失败，请补充商品信息后重试。", 500);
  }
}
