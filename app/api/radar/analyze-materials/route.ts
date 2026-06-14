import { NextRequest, NextResponse } from "next/server";
import type { EvidenceCard, MaterialInput, Platform } from "@/lib/types";

export const runtime = "nodejs";

function isRadarEnabled() {
  return process.env.NODE_ENV !== "production";
}

function radarNotFoundResponse() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

function isLocalRequest(request: NextRequest) {
  const host = request.headers.get("host") || "";
  return host.startsWith("localhost:")
    || host.startsWith("127.0.0.1:")
    || host.startsWith("[::1]:");
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function readLineField(text: string, names: string[]) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = text.match(new RegExp(`(?:${escaped})\\s*[:：]\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function inferPriceText(text: string) {
  const match = text.match(/(?:¥|￥)?\s*\d+(?:\.\d+)?\s*(?:元|块|rmb)?/i);
  return match?.[0]?.trim() || "";
}

function inferHeatText(text: string) {
  const match = text.match(/(?:评价|评论|销量|月销|已售|售出|浏览|收藏)\s*[:：]?\s*\d+(?:\.\d+)?\s*(?:万\+?|w\+?|千\+?|k\+?|\+)?/i)
    || text.match(/\d+(?:\.\d+)?\s*(?:万\+?|w\+?|千\+?|k\+?|\+)?\s*(?:评价|评论|销量|月销|已售|售出|浏览|收藏)/i);
  return match?.[0]?.trim() || "";
}

function inferProductName(text: string, priceText: string, heatText: string) {
  const firstLine = text.split("\n").find((line) => line.trim())?.trim() || "";
  if (!firstLine) return "";

  const cleaned = firstLine
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(priceText, " ")
    .replace(heatText, " ")
    .replace(/^(京东|淘宝|天猫|拼多多|抖音|小红书|jd|pdd)\s*/i, "")
    .replace(/\s*(平台|商品|产品|名称)\s*[:：]\s*/gi, " ")
    .split(/[，,。；;｜|]/)[0]
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned.slice(0, 60);
}

function detectPlatformFromText(text: string): Platform | "unknown" {
  if (/京东|jd/i.test(text)) return "jd";
  if (/淘宝/i.test(text)) return "taobao";
  if (/天猫/i.test(text)) return "tmall";
  if (/拼多多|pdd/i.test(text)) return "pdd";
  if (/抖音/i.test(text)) return "douyin";
  if (/小红书/i.test(text)) return "xhs";
  return "manual";
}

function splitManualEntries(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const byBlank = normalized.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  if (byBlank.length > 1) return byBlank.slice(0, 12);
  const byPlatform = normalized.split(/(?=平台\s*[:：])/).map((item) => item.trim()).filter(Boolean);
  return (byPlatform.length ? byPlatform : [normalized]).slice(0, 12);
}

function createTextCard(text: string, index: number): EvidenceCard {
  const priceText = readLineField(text, ["价格", "售价", "客单价"]) || inferPriceText(text);
  const heatText = readLineField(text, ["热度", "销量", "互动", "评价"]) || inferHeatText(text);
  const productName = readLineField(text, ["商品名", "产品名", "名称"]) || inferProductName(text, priceText, heatText);
  const rankText = readLineField(text, ["排名", "榜单"]);
  const platform = detectPlatformFromText(text);
  const missingFields = [
    productName ? "" : "商品名",
    priceText ? "" : "价格",
    heatText || rankText ? "" : "销量/评价/排名",
  ].filter(Boolean);

  return {
    id: makeId("card"),
    materialId: makeId(`text-${index}`),
    materialType: "text",
    detectedMaterialType: "manual_text",
    status: missingFields.length ? "partial" : "success",
    missingFields,
    message: missingFields.length ? "已从文字中提取部分信息，请补充缺失字段。" : "已从手动文字中提取到基础证据。",
    riskNotes: "",
    userNotes: "",
    productName,
    normalizedProductName: productName,
    priceText,
    salesText: heatText,
    ratingText: heatText.includes("评价") ? heatText : "",
    rankText,
    shopName: readLineField(text, ["店铺", "店铺名"]),
    brandName: readLineField(text, ["品牌", "品牌名"]),
    pageTitle: "",
    visibleDescription: readLineField(text, ["备注", "卖点", "描述"]),
    sourceUrl: readLineField(text, ["链接", "地址"]),
    platform,
    rawEvidenceText: text,
    capturedAt: new Date().toISOString(),
    confidenceFields: [
      { fieldName: "商品名", value: productName || "未识别", confidence: productName ? "medium" : "low", reason: "来自用户粘贴文字。" },
      { fieldName: "价格", value: priceText || "未识别", confidence: priceText ? "medium" : "low", reason: "来自用户粘贴文字。" },
      { fieldName: "热度", value: heatText || rankText || "未识别", confidence: heatText || rankText ? "medium" : "low", reason: "来自用户粘贴文字。" },
    ],
  };
}

function createImageCard(material: MaterialInput): EvidenceCard {
  return {
    id: makeId("card"),
    materialId: material.id || makeId("image"),
    materialType: "image",
    detectedMaterialType: "product_image",
    status: "need_more_info",
    missingFields: ["商品名", "价格", "销量/评价/排名", "平台"],
    message: "图片已接收。当前接口不强依赖视觉模型，请手动补充截图中的商品名、价格、销量或评价。",
    riskNotes: "",
    userNotes: "",
    productName: "",
    normalizedProductName: "",
    priceText: "",
    salesText: "",
    ratingText: "",
    rankText: "",
    shopName: "",
    brandName: "",
    pageTitle: "",
    visibleDescription: "",
    sourceUrl: "",
    platform: "unknown",
    rawEvidenceText: `图片文件：${material.fileName || material.sourceName || "未命名图片"}`,
    capturedAt: new Date().toISOString(),
    confidenceFields: [
      { fieldName: "图片文件", value: material.fileName || material.sourceName || "未命名图片", confidence: "high", reason: "来自本地上传文件名。" },
      { fieldName: "图片识别", value: "需要人工补充", confidence: "low", reason: "V1 优先保留上传和预览，不强依赖视觉模型。" },
    ],
  };
}

export async function POST(request: NextRequest) {
  if (!isRadarEnabled()) {
    return radarNotFoundResponse();
  }

  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "素材识别接口只允许在 localhost 使用。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });
  }

  const source = typeof body === "object" && body !== null ? body as { manualText?: unknown; materials?: unknown } : {};
  const manualText = typeof source.manualText === "string" ? source.manualText : "";
  const materials = Array.isArray(source.materials) ? source.materials.filter((item): item is MaterialInput => typeof item === "object" && item !== null) : [];
  const imageCards = materials.filter((item) => item.type === "image").slice(0, 10).map(createImageCard);
  const textCards = splitManualEntries(manualText).map(createTextCard);
  const evidenceCards = [...imageCards, ...textCards];

  return NextResponse.json({
    status: evidenceCards.length ? "success" : "need_more_info",
    evidenceCards,
    message: evidenceCards.length ? `已生成 ${evidenceCards.length} 张证据卡片。` : "还没有可识别素材，请上传图片或粘贴商品文字。",
  });
}
