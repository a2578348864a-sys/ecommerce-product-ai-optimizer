"use client";

import Link from "next/link";
import {
  AlertCircle,
  Ban,
  Brain,
  ClipboardCheck,
  Download,
  FileText,
  History,
  ImagePlus,
  LayoutDashboard,
  RefreshCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  useRef,
  useState,
} from "react";
import { CopyButton } from "@/components/CopyButton";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { useLocalDraft } from "@/hooks/useLocalDraft";
import { canRequestWithAccessPassword, useAccessPassword } from "@/lib/client/accessPassword";
import {
  EvidenceCardList,
  EvidenceSection,
  KeywordAndDirectionPanel,
  NextActions,
  PlatformStatusList,
  ProductCard,
  ProductGroup,
  RiskAndIdeas,
  SectionTitle,
  SummaryCard,
  TrafficLightPanel,
  getConfidenceLabel,
  getDecisionLabel,
} from "@/components/ResultSection";
import {
  analysisGoals,
  imageLimits,
  inputLimits,
  linkLimits,
  personalLimitOptions,
  platformLabels,
  platformOptions,
  reportDisclaimer,
} from "@/lib/types";
import { agentCapabilityMatrix, workflowPreviewSteps } from "@/lib/taskConcepts";
import type {
  ConfidenceField,
  DetectedMaterialType,
  EvidenceCard,
  FinalDecision,
  GenerateErrorResponse,
  HotProductRadarResult,
  LinkType,
  MaterialInput,
  MaterialAgentResult,
  Platform,
  RadarFormInput,
  ViralAgentResult,
} from "@/lib/types";

type FieldErrors = Partial<Record<keyof RadarFormInput | "accessPassword", string>>;
type EvidenceRole = "primary" | "supporting";
type ManualEvidenceDraft = {
  productName: string;
  platform: Platform | "unknown";
  priceText: string;
  heatText: string;
  notes: string;
};

type HomeDraft = {
  form: RadarFormInput;
  result: HotProductRadarResult | null;
  generatedAt: string;
};

const emptyManualEvidenceDraft: ManualEvidenceDraft = {
  productName: "",
  platform: "manual",
  priceText: "",
  heatText: "",
  notes: "",
};

const materialChangedMessage = "素材已变化，请重新识别证据，旧证据可能不再准确。";
const insufficientEvidenceMessage = "当前证据不足，建议补充价格、热度或平台来源。";

const emptyForm: RadarFormInput = {
  keyword: "",
  analysisGoal: "全部分析",
  targetPriceRange: "",
  targetAudience: "",
  excludedCategories: "",
  selectedPlatforms: ["manual"],
  personalLimits: [
    "不做食品",
    "不做美妆",
    "不做儿童用品",
    "不做带电产品",
    "不做大件",
    "不做易碎",
    "不做高售后",
    "不做品牌/IP相关",
  ],
  notes: "",
  linksText: "",
  manualText: "",
  lowTokenMode: true,
  materials: [],
  evidenceCards: [],
};

const sampleLinks = "https://www.amazon.com/dp/example-kitchen-gadget";

const sampleManualText = `Platform: TikTok
Product: Portable USB-C rechargeable mini blender
Price: $19.99
Popularity: 2M+ views, comments asking where to buy
Notes: Portable, good for gym/office/camping, small and lightweight

Platform: Amazon
Product: Pet slow feeder bowl
Price: $14.99
Popularity: 5,000+ reviews, 4.5 stars
Notes: Anti-choke design, suitable for small/medium dogs, dishwasher safe

Platform: Etsy
Product: Handmade resin phone charm
Price: $8.50
Popularity: Top seller badge, many 5-star reviews
Notes: Customizable colors, aesthetic accessory, small parcel shipping`;

const sampleForm: RadarFormInput = {
  ...emptyForm,
  keyword: "kitchen gadgets / pet accessories",
  targetPriceRange: "$5 - $25 USD",
  targetAudience: "US/Europe, home organization, pet owners, kitchen enthusiasts, gift buyers",
  excludedCategories: "食品、美妆、儿童用品、带电、大件、易碎、强 IP",
  selectedPlatforms: ["manual", "tiktok", "amazon", "etsy"],
  notes: "V1 focus on low-risk general merchandise small items. Prioritize compact, low after-sales, easy-to-self-photograph products for cross-border e-commerce.",
  linksText: sampleLinks,
  manualText: sampleManualText,
};

const progressSteps = [
  "识别输入类型",
  "识别平台和素材类型",
  "提取可见商品证据",
  "生成证据卡片和置信度",
  "执行反向淘汰器",
  "判断推荐做 / 谨慎做 / 不建议做",
  "生成找货关键词和同类扩展",
  "生成下一步行动和本地档案",
];

const localArchiveKey = "hot-material-agent-archives";

const materialTypeLabels: Record<DetectedMaterialType, string> = {
  product_page: "商品页",
  ranking_page: "榜单页",
  search_result: "搜索结果",
  note: "内容素材",
  comment_screenshot: "评论截图",
  product_image: "商品图/截图",
  manual_text: "手动文字",
  unknown: "未知",
};

const skillButtons = [
  "识别这是什么商品",
  "判断能不能跟品",
  "提取找货关键词",
  "检查高风险",
  "生成差异化方案",
  "生成同类扩展方向",
  "保存到选品档案",
];

const displayAgents = [
  {
    name: "素材接收",
    description: "提取商品、卖点、人群、场景和价格。",
    icon: UploadCloud,
  },
  {
    name: "爆款拆解",
    description: "看标题、卖点、场景是否有爆款感。",
    icon: Sparkles,
  },
  {
    name: "货源判断",
    description: "判断是否容易找同款或平替。",
    icon: ClipboardCheck,
  },
  {
    name: "风险排查",
    description: "检查侵权、功效宣称和售后风险。",
    icon: ShieldCheck,
  },
  {
    name: "小白结论",
    description: "直接告诉你能不能做、为什么。",
    icon: Brain,
  },
];

const beginnerGuideSteps = [
  { step: "Step 1", title: "输入商品或素材", description: "先粘贴商品文字、链接说明或素材信息。", href: "/materials" },
  { step: "Step 2", title: "货源判断", description: "判断是否容易找到稳定供应商和可替代货源。", href: "/sourcing" },
  { step: "Step 3", title: "风险排查", description: "先排除侵权、认证、儿童、食品接触、带电带磁等高风险。", href: "/risk" },
  { step: "Step 4", title: "新品体检 / Listing", description: "测算利润、整理关键词和 listing 草稿。", href: "/products/new" },
  { step: "Step 5", title: "小白汇总结论", description: "用大白话看 AI 的保守结论和下一步建议。", href: "/summary" },
  { step: "Step 6", title: "任务中心复盘", description: "保存任务后人工决定继续、补资料或淘汰。", href: "/tasks" },
] as const;

const demoProducts = [
  {
    name: "桌面手机支架",
    risk: "低风险",
    riskClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    highlight: "适合展示可小单测试",
    reason: "结构简单、客单价低、合规和售后风险相对可控，适合演示基础选品流程。",
    href: "/products/new",
    pageLabel: "打开新品体检",
  },
  {
    name: "宠物慢食碗",
    risk: "中风险",
    riskClass: "border-amber-200 bg-amber-50 text-amber-700",
    highlight: "适合展示谨慎判断",
    reason: "涉及宠物进食接触，需要人工确认材质、供应商文件和平台表达，适合演示保守判断。",
    href: "/risk",
    pageLabel: "打开风险排查",
  },
  {
    name: "儿童电动牙刷",
    risk: "高风险",
    riskClass: "border-rose-200 bg-rose-50 text-rose-700",
    highlight: "适合展示风险拦截",
    reason: "同时涉及儿童、带电、认证和合规表达，适合演示为什么不能只看利润和热度。",
    href: "/summary",
    pageLabel: "打开小白结论",
  },
] as const;

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getTextLength(value: string | undefined) {
  return (value || "").trim().length;
}

function hasRawMaterialInput(form: RadarFormInput) {
  return form.materials.some((item) => item.type === "image")
    || Boolean(form.linksText.trim())
    || Boolean(form.manualText.trim());
}

function hasAnyMaterialInput(form: RadarFormInput) {
  return hasRawMaterialInput(form) || form.evidenceCards.length > 0;
}

function isValidEvidenceCard(card: EvidenceCard) {
  return Boolean(
    (card.productName || "").trim()
    || (card.pageTitle || "").trim()
    || (card.visibleDescription || "").trim()
    || (card.userNotes || "").trim(),
  );
}

function hasPriceOrHeat(card: EvidenceCard) {
  return Boolean(
    (card.priceText || "").trim()
    && ((card.salesText || "").trim() || (card.ratingText || "").trim() || (card.rankText || "").trim()),
  );
}

function getPrimaryEvidenceId(cards: EvidenceCard[], roles: Record<string, EvidenceRole>) {
  const primary = cards.find((card) => roles[card.id] === "primary" && isValidEvidenceCard(card));
  return primary?.id || "";
}

function assignEvidenceRoles(cards: EvidenceCard[], roles: Record<string, EvidenceRole>) {
  const next: Record<string, EvidenceRole> = {};
  const validCards = cards.filter(isValidEvidenceCard);
  const existingPrimary = validCards.find((card) => roles[card.id] === "primary");
  const primaryId = existingPrimary?.id || validCards[0]?.id || "";

  for (const card of cards) {
    next[card.id] = card.id === primaryId ? "primary" : "supporting";
  }

  return next;
}

function orderCardsForAnalysis(cards: EvidenceCard[], roles: Record<string, EvidenceRole>) {
  const primaryId = getPrimaryEvidenceId(cards, roles);
  if (!primaryId) return cards;
  const primary = cards.filter((card) => card.id === primaryId);
  const supporting = cards.filter((card) => card.id !== primaryId);
  return [...primary, ...supporting];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 48) || "爆款素材识别报告";
}

function downloadTextFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function listLines(items: string[]) {
  return items.length ? items.map((item) => "- " + item).join("\n") : "- 未提供";
}

function toFriendlyError(message: string) {
  const text = (message || "").trim();
  if (!text) return "当前信息不足，建议补充价格、热度或平台来源。";
  if (/JSON|502|结构不完整|selector timeout|failed to fetch|parse error|schema error|undefined|null|stack trace/i.test(text)) {
    return "AI 这次没有按格式返回，我已经尽量整理。你可以减少输入后重试。";
  }
  if (/too large|内容过长|素材太多|413/i.test(text)) {
    return "这次素材太多了，建议先分析 1 个商品，结果会更准，也更省分析次数。";
  }
  if (/网络|fetch|ECONN|timeout/i.test(text)) {
    return "本地服务刚才没有正常响应，请稍后重试，或确认 http://localhost:3005 是否打开。";
  }
  return text;
}

function normalizeUrlCandidate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function extractUrls(text: string) {
  const urls = new Set<string>();
  const urlRegex = /(https?:\/\/[^\s，。；、]+|(?:www\.)?(?:amazon|tiktok|etsy|shopify|ebay|alibaba|1688)\.com\/[^\s，。；、]+|(?:www\.)?(?:taobao|tmall|pinduoduo|jd|xiaohongshu|douyin)\.com\/[^\s，。；、]+)/gi;
  for (const match of text.matchAll(urlRegex)) {
    urls.add(normalizeUrlCandidate(match[0]));
  }
  return Array.from(urls).slice(0, linkLimits.maxCount);
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost"
    || host === "0.0.0.0"
    || host.startsWith("127.")
    || host.startsWith("10.")
    || host.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

function detectPlatform(hostname: string): Platform | "unknown" {
  const host = hostname.toLowerCase();
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "amazon.com" || host.endsWith(".amazon.com") || host.endsWith(".amazon.co.uk") || host.endsWith(".amazon.de") || host.endsWith(".amazon.co.jp")) return "amazon";
  if (host === "etsy.com" || host.endsWith(".etsy.com")) return "etsy";
  if (host === "shopify.com" || host.endsWith(".shopify.com") || host.endsWith(".myshopify.com")) return "shopify";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  if (host === "pinterest.com" || host.endsWith(".pinterest.com")) return "pinterest";
  if (host === "youtube.com" || host.endsWith(".youtube.com")) return "youtube_shorts";
  if (host === "ebay.com" || host.endsWith(".ebay.com")) return "other";
  if (host === "alibaba.com" || host.endsWith(".alibaba.com")) return "other";
  return "unknown";
}

function detectLinkType(url: URL, platform: Platform | "unknown"): LinkType {
  const value = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
  if (platform === "instagram" || platform === "pinterest") return "note";
  if (/item|product|detail|goods|listing|dp\//.test(value)) return "product";
  if (/rank|top|best.seller|榜/.test(value)) return "ranking";
  if (/search|keyword|q=|wd=|s=|k=/.test(value)) return "search";
  return "unknown";
}

function cleanSupportedUrl(rawUrl: string) {
  const normalized = normalizeUrlCandidate(rawUrl);
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false as const, message: "该链接协议不支持，已阻止打开。请改用截图或手动粘贴商品信息。" };
    }
    if (isPrivateHost(url.hostname)) {
      return { ok: false as const, message: "该链接指向本地或内网地址，已阻止打开。" };
    }
    const platform = detectPlatform(url.hostname);
    if (platform === "unknown") {
      return { ok: false as const, message: "该链接不在安全白名单内，已阻止打开。你可以上传截图或手动粘贴商品信息继续分析。" };
    }
    const trackingKeys = ["utm", "spm", "share", "invite", "tracking", "track", "from", "refer"];
    for (const key of Array.from(url.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (trackingKeys.some((prefix) => lower.startsWith(prefix) || lower.includes(prefix))) {
        url.searchParams.delete(key);
      }
    }
    return {
      ok: true as const,
      originalUrl: rawUrl,
      cleanedUrl: url.toString(),
      platform,
      linkType: detectLinkType(url, platform),
    };
  } catch {
    return { ok: false as const, message: "链接格式无法识别，请检查后重试，或改用截图/手动文字。" };
  }
}

function detectPlatformFromText(text: string): Platform | "unknown" {
  if (/tiktok/i.test(text)) return "tiktok";
  if (/amazon/i.test(text)) return "amazon";
  if (/etsy/i.test(text)) return "etsy";
  if (/shopify/i.test(text)) return "shopify";
  if (/instagram/i.test(text)) return "instagram";
  if (/pinterest/i.test(text)) return "pinterest";
  if (/youtube\s*shorts/i.test(text)) return "youtube_shorts";
  if (/manual|other|unknown/i.test(text)) return "manual";
  return "manual";
}

function readLineField(text: string, names: string[]) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = text.match(new RegExp(`(?:${escaped})\\s*[:：]\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function splitManualEntries(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const byBlank = normalized.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  if (byBlank.length > 1) return byBlank.slice(0, 12);
  const byPlatform = normalized.split(/(?=平台\s*[:：])/).map((item) => item.trim()).filter(Boolean);
  return (byPlatform.length ? byPlatform : [normalized]).slice(0, 12);
}

function confidenceField(fieldName: string, value: string, confidence: ConfidenceField["confidence"], reason: string): ConfidenceField {
  return { fieldName, value, confidence, reason };
}

function createLinkEvidenceCard(rawUrl: string): { material: MaterialInput; card: EvidenceCard } {
  const materialId = makeId("url");
  const parsed = cleanSupportedUrl(rawUrl);
  const now = new Date().toISOString();
  const failedMaterial: MaterialInput = {
    id: materialId,
    type: "url",
    originalUrl: rawUrl,
    rawText: rawUrl,
    createdAt: now,
  };

  if (!parsed.ok) {
    return {
      material: failedMaterial,
      card: {
        id: makeId("card"),
        materialId,
        materialType: "url",
        detectedMaterialType: "unknown",
        status: "failed",
        missingFields: ["商品名", "价格", "热度证据"],
        message: "待补充证据卡片：链接没有识别成功，请手动补商品名、价格、热度或换成截图。",
        riskNotes: parsed.message,
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
        sourceUrl: rawUrl,
        platform: "unknown",
        rawEvidenceText: rawUrl,
        capturedAt: now,
        confidenceFields: [confidenceField("链接安全", "未通过", "high", "链接不在白名单或协议不安全。")],
      },
    };
  }

  return {
    material: {
      ...failedMaterial,
      sourceName: platformLabels[parsed.platform],
      cleanedUrl: parsed.cleanedUrl,
    },
    card: {
      id: makeId("card"),
      materialId,
      materialType: "url",
      detectedMaterialType: parsed.linkType === "product" ? "product_page" : parsed.linkType === "ranking" ? "ranking_page" : parsed.linkType === "search" ? "search_result" : parsed.linkType === "note" ? "note" : "unknown",
      status: "partial",
      missingFields: ["商品名", "价格", "销量/评价/排名", "店铺/品牌"],
      message: "链接已通过白名单和基础清洗。V1 不自动抓取页面，请补充页面可见信息或上传截图。",
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
      sourceUrl: parsed.cleanedUrl,
      platform: parsed.platform,
      rawEvidenceText: parsed.cleanedUrl,
      capturedAt: now,
      confidenceFields: [
        confidenceField("平台", platformLabels[parsed.platform], "high", "根据域名识别。"),
        confidenceField("链接类型", parsed.linkType, "medium", "根据路径关键词粗略识别。"),
      ],
    },
  };
}

function createTextEvidenceCard(text: string, index: number): { material: MaterialInput; card: EvidenceCard } {
  const now = new Date().toISOString();
  const materialId = makeId("text");
  const productName = readLineField(text, ["商品名", "产品名", "名称"]);
  const priceText = readLineField(text, ["价格", "售价", "客单价"]);
  const heatText = readLineField(text, ["热度", "销量", "互动", "评价"]);
  const rankText = readLineField(text, ["排名", "榜单"]);
  const shopName = readLineField(text, ["店铺", "店铺名"]);
  const brandName = readLineField(text, ["品牌", "品牌名"]);
  const sourceUrl = extractUrls(text)[0] || readLineField(text, ["链接", "地址"]);
  const platform = detectPlatformFromText(text);
  const missingFields = [
    productName ? "" : "商品名",
    priceText ? "" : "价格",
    heatText || rankText ? "" : "销量/评价/排名",
  ].filter(Boolean);

  return {
    material: {
      id: materialId,
      type: "text",
      sourceName: `手动文字 ${index + 1}`,
      rawText: text,
      createdAt: now,
    },
    card: {
      id: makeId("card"),
      materialId,
      materialType: "text",
      detectedMaterialType: "manual_text",
      status: missingFields.length ? "partial" : "success",
      missingFields,
      message: missingFields.length ? "已从文字中提取部分信息，请补充缺失字段后再完整分析。" : "已从手动文字中提取到基础证据。",
      riskNotes: "",
      userNotes: "",
      productName,
      normalizedProductName: productName,
      priceText,
      salesText: heatText,
      ratingText: heatText.includes("评价") ? heatText : "",
      rankText,
      shopName,
      brandName,
      pageTitle: "",
      visibleDescription: readLineField(text, ["备注", "卖点", "描述"]),
      sourceUrl,
      platform,
      rawEvidenceText: text,
      capturedAt: now,
      confidenceFields: [
        confidenceField("商品名", productName || "未识别", productName ? "medium" : "low", "来自用户粘贴文字。"),
        confidenceField("价格", priceText || "未识别", priceText ? "medium" : "low", "来自用户粘贴文字。"),
        confidenceField("热度", heatText || rankText || "未识别", heatText || rankText ? "medium" : "low", "来自用户粘贴文字。"),
      ],
    },
  };
}

function createImageEvidenceCard(material: MaterialInput): EvidenceCard {
  return {
    id: makeId("card"),
    materialId: material.id,
    materialType: "image",
    detectedMaterialType: "product_image",
    status: "need_more_info",
    missingFields: ["商品名", "价格", "销量/评价/排名", "平台"],
    message: "待补充证据卡片：图片已上传，请手动补充截图里的商品名、价格、销量或评价。",
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
    rawEvidenceText: `图片文件：${material.fileName || "未命名图片"}`,
    capturedAt: new Date().toISOString(),
    confidenceFields: [
      confidenceField("图片文件", material.fileName || "未命名图片", "high", "来自本地上传文件名。"),
      confidenceField("图片识别", "需要人工补充", "low", "V1 优先保留上传和预览，不强依赖视觉模型。"),
    ],
  };
}

function createFallbackEvidenceCard(reason: string): EvidenceCard {
  const now = new Date().toISOString();
  return {
    id: makeId("card"),
    materialId: makeId("manual-fallback"),
    materialType: "text",
    detectedMaterialType: "unknown",
    status: "need_more_info",
    missingFields: ["商品名", "平台", "价格", "热度"],
    message: "待补充证据卡片：识别不完整，请手动填写商品名、平台、价格、热度或备注。",
    riskNotes: reason,
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
    rawEvidenceText: reason,
    capturedAt: now,
    confidenceFields: [
      confidenceField("识别状态", "待补充", "low", "本地解析没有拿到足够信息。"),
    ],
  };
}

function getMaterialAgentText(form: RadarFormInput) {
  const imageNames = form.materials
    .filter((item) => item.type === "image")
    .map((item) => item.fileName || item.sourceName || "未命名图片")
    .filter(Boolean);

  return [
    form.keyword.trim() ? `关键词/品类：${form.keyword.trim()}` : "",
    form.manualText.trim() ? `用户粘贴内容：\n${form.manualText.trim()}` : "",
    form.linksText.trim() ? `用户粘贴链接：\n${form.linksText.trim()}` : "",
    imageNames.length ? `用户上传图片：${imageNames.join("、")}` : "",
  ].filter(Boolean).join("\n\n");
}

function materialListText(values: string[]) {
  return values.length ? values.join("、") : "未提到";
}

function createMaterialAgentEvidenceCard(result: MaterialAgentResult, rawText: string): EvidenceCard {
  const now = new Date().toISOString();
  const productName = result.productType && result.productType !== "未提到" ? result.productType : "";
  const missingFields = result.missingInfo.length ? result.missingInfo : [
    productName ? "" : "商品类型",
    result.priceRange && result.priceRange !== "未提到" ? "" : "价格区间",
    result.targetUsers.length ? "" : "目标人群",
    result.usageScenarios.length ? "" : "使用场景",
    result.commentDemands.length ? "" : "评论需求",
  ].filter(Boolean);

  return {
    id: makeId("card"),
    materialId: makeId("material-agent"),
    materialType: "text",
    detectedMaterialType: "manual_text",
    status: result.materialCompleteness === "完整" ? "success" : result.materialCompleteness === "一般" ? "partial" : "need_more_info",
    missingFields,
    message: "素材接收 Agent 已识别。请检查下面的信息是否准确。",
    riskNotes: materialListText(result.riskWords),
    userNotes: result.summary,
    productName,
    normalizedProductName: productName,
    priceText: result.priceRange === "未提到" ? "" : result.priceRange,
    salesText: materialListText(result.commentDemands),
    ratingText: "",
    rankText: "",
    shopName: "",
    brandName: "",
    pageTitle: result.productType || "",
    visibleDescription: [
      `核心卖点：${materialListText(result.sellingPoints)}`,
      `目标人群：${materialListText(result.targetUsers)}`,
      `使用场景：${materialListText(result.usageScenarios)}`,
      `用户痛点：${materialListText(result.painPoints)}`,
    ].join("\n"),
    sourceUrl: "",
    platform: "tiktok",
    rawEvidenceText: rawText || result.summary,
    capturedAt: now,
    confidenceFields: [
      confidenceField("商品类型", result.productType || "未提到", productName ? "medium" : "low", "来自素材接收 Agent。"),
      confidenceField("价格区间", result.priceRange || "未提到", result.priceRange && result.priceRange !== "未提到" ? "medium" : "low", "来自素材接收 Agent。"),
      confidenceField("素材完整度", result.materialCompleteness, result.materialCompleteness === "完整" ? "high" : "medium", "来自素材接收 Agent。"),
    ],
  };
}

function buildEvidenceFromForm(form: RadarFormInput) {
  const materials: MaterialInput[] = [];
  const cards: EvidenceCard[] = [];

  const imageMaterials = form.materials.filter((item) => item.type === "image");
  materials.push(...imageMaterials);
  cards.push(...imageMaterials.map(createImageEvidenceCard));

  const linkCandidates = [
    ...extractUrls(form.linksText),
    ...extractUrls(form.manualText),
  ].slice(0, linkLimits.maxCount);
  for (const rawUrl of Array.from(new Set(linkCandidates))) {
    const item = createLinkEvidenceCard(rawUrl);
    materials.push(item.material);
    cards.push(item.card);
  }

  splitManualEntries(form.manualText).forEach((entry, index) => {
    const item = createTextEvidenceCard(entry, index);
    materials.push(item.material);
    cards.push(item.card);
  });

  return { materials, cards };
}

function resultToMarkdown(form: RadarFormInput, result: HotProductRadarResult, generatedAt: string) {
  const lines: string[] = [];
  lines.push(`# 爆款素材识别报告：${form.keyword || "未命名选品"}`);
  lines.push("");
  lines.push(`生成时间：${generatedAt}`);
  lines.push("");
  lines.push("## Agent 结论");
  lines.push("");
  lines.push(`- 最终判断：${getDecisionLabel(result.finalDecision)}`);
  lines.push(`- 置信度：${getConfidenceLabel(result.confidenceLevel)}`);
  lines.push(`- 样本质量：${result.sampleQuality}`);
  lines.push("");
  lines.push(result.summary || "未生成总结。");
  lines.push("");
  lines.push(result.agentConclusion || "");
  lines.push("");
  lines.push("## 风险红黄绿灯");
  lines.push("");
  result.trafficLightRisks.forEach((risk) => {
    lines.push(`- ${risk.name}：${risk.level}，${risk.explanation}`);
  });
  lines.push("");
  lines.push("## 证据卡片");
  lines.push("");
  result.evidenceCards.forEach((card, index) => {
    lines.push(`### 素材 ${index + 1}`);
    lines.push(`- 平台：${card.platform}`);
    lines.push(`- 类型：${materialTypeLabels[card.detectedMaterialType] || card.detectedMaterialType}`);
    lines.push(`- 商品名：${card.productName || "未识别"}`);
    lines.push(`- 价格：${card.priceText || "未识别"}`);
    lines.push(`- 热度：${card.salesText || card.ratingText || card.rankText || "未识别"}`);
    lines.push(`- 缺失：${card.missingFields.join("、") || "无"}`);
    lines.push(`- 备注：${card.userNotes || card.message}`);
    lines.push("");
  });
  lines.push("## 候选商品");
  lines.push("");
  result.candidateProducts.forEach((product, index) => {
    lines.push(`### ${index + 1}. ${product.productName}`);
    lines.push(`- 判断：${getDecisionLabel(product.finalDecision)}`);
    lines.push(`- 综合分：${product.finalScore}`);
    lines.push(`- 平台：${product.platform || product.sourcePlatform}`);
    lines.push(`- 价格：${product.priceText}`);
    lines.push(`- 热度证据：${product.evidenceText}`);
    lines.push(`- 风险标签：${product.riskTags.join("、") || "无"}`);
    lines.push(`- 理由：${product.reason}`);
    lines.push(`- 差异化：${product.differentiationAngle}`);
    lines.push(`- 找货关键词：${[
      ...product.sourcingKeywords.source1688,
      ...product.sourcingKeywords.pdd,
      ...product.sourcingKeywords.taobao,
      ...product.sourcingKeywords.specsAndMaterials,
    ].join("、")}`);
    lines.push("");
  });
  lines.push("## 推荐做 / 谨慎做 / 不建议做");
  lines.push("");
  lines.push("### 推荐做");
  lines.push(listLines(result.recommendedProducts.map((item) => `${item.productName}：${item.reason}`)));
  lines.push("");
  lines.push("### 谨慎做");
  lines.push(listLines(result.cautiousProducts.map((item) => `${item.productName}：${item.reason}`)));
  lines.push("");
  lines.push("### 不建议做");
  lines.push(listLines(result.rejectedProducts.map((item) => `${item.productName}：${item.reason}`)));
  lines.push("");
  lines.push("## 找货关键词");
  lines.push("");
  lines.push(listLines(result.sourcingKeywords));
  lines.push("");
  lines.push("## 同类扩展方向");
  lines.push("");
  lines.push(listLines(result.similarProductDirections));
  lines.push("");
  lines.push("## 下一步行动");
  lines.push("");
  result.nextActions.forEach((action) => {
    lines.push(`### ${action.productDirection}`);
    lines.push("");
    lines.push(action.action);
    lines.push("");
    lines.push(listLines(action.checklist));
    lines.push("");
    lines.push(`测试建议：${action.testSuggestion}`);
    lines.push("");
  });
  lines.push("---");
  lines.push("");
  lines.push(result.disclaimer || reportDisclaimer);
  return lines.join("\n");
}

function resultToWordHtml(form: RadarFormInput, result: HotProductRadarResult, generatedAt: string) {
  const esc = escapeHtml;
  const markdown = resultToMarkdown(form, result, generatedAt)
    .split("\n")
    .map((line) => {
      if (line.startsWith("# ")) return `<h1>${esc(line.slice(2))}</h1>`;
      if (line.startsWith("## ")) return `<h2>${esc(line.slice(3))}</h2>`;
      if (line.startsWith("### ")) return `<h3>${esc(line.slice(4))}</h3>`;
      if (line.startsWith("- ")) return `<li>${esc(line.slice(2))}</li>`;
      if (line.trim() === "---") return "<hr />";
      if (!line.trim()) return "";
      return `<p>${esc(line)}</p>`;
    })
    .join("\n");

  return "<!DOCTYPE html><html><head><meta charset='utf-8'><title>爆款素材识别报告</title>"
    + "<style>body{font-family:'Microsoft YaHei',Arial,sans-serif;line-height:1.7;color:#111827;}h1,h2,h3{color:#0f172a;}li{margin:4px 0}</style>"
    + `</head><body><p>生成时间：${esc(generatedAt)}</p>${markdown}</body></html>`;
}

function getDecisionFileName(decision: FinalDecision) {
  switch (decision) {
    case "recommend": return "推荐做";
    case "reject": return "不建议做";
    default: return "谨慎做";
  }
}

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, "")
    .trim();
}

function getStoredArchives() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(localArchiveKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item?.name === "string") as Array<{ name: string; decision: string; risks: string; savedAt: string }> : [];
  } catch {
    return [];
  }
}

function findDuplicateReminder(cards: EvidenceCard[]) {
  const archives = getStoredArchives();
  if (!archives.length || !cards.length) return "";

  const cardNames = cards
    .map((card) => normalizeMatchText(card.productName || card.normalizedProductName || ""))
    .filter((name) => name.length >= 4);
  if (!cardNames.length) return "";

  const matched = archives.find((archive) => {
    const archiveName = normalizeMatchText(archive.name);
    return cardNames.some((name) => archiveName.includes(name) || name.includes(archiveName));
  });

  if (!matched) return "";
  return `你之前分析过类似商品：${matched.name}。上次结论：${matched.decision || "未记录"}。主要风险：${matched.risks || "未记录"}。`;
}

function rememberLocalArchive(result: HotProductRadarResult) {
  if (typeof window === "undefined") return;
  const archives = getStoredArchives();
  const primaryName = result.candidateProducts[0]?.productName || result.summary.slice(0, 24) || "未命名选品";
  const item = {
    name: primaryName,
    decision: getDecisionLabel(result.finalDecision),
    risks: result.riskWarnings.slice(0, 3).map((risk) => risk.riskType).join("、"),
    savedAt: new Date().toISOString(),
  };
  const next = [item, ...archives.filter((archive) => normalizeMatchText(archive.name) !== normalizeMatchText(item.name))].slice(0, 30);
  window.localStorage.setItem(localArchiveKey, JSON.stringify(next));
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [accessPassword, setAccessPassword, isAccessPasswordReady] = useAccessPassword();
  const { draftValue, setDraftValue, clearDraft, restored: draftRestored } = useLocalDraft<HomeDraft>({
    storageKey: "qx:draft:home:v1",
    initialValue: {
      form: emptyForm,
      result: null,
      generatedAt: "",
    },
  });
  const { form, result, generatedAt } = draftValue;
  const setForm = (value: RadarFormInput | ((prev: RadarFormInput) => RadarFormInput)) => {
    setDraftValue((current) => ({
      ...current,
      form: typeof value === "function" ? value(current.form) : value,
    }));
  };
  const setResult = (value: HotProductRadarResult | null) => {
    setDraftValue((current) => ({ ...current, result: value }));
  };
  const setGeneratedAt = (value: string) => {
    setDraftValue((current) => ({ ...current, generatedAt: value }));
  };
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [materialAgentResult, setMaterialAgentResult] = useState<MaterialAgentResult | null>(null);
  const [viralAgentResult, setViralAgentResult] = useState<ViralAgentResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [recognizingEvidence, setRecognizingEvidence] = useState(false);
  const [analyzingViral, setAnalyzingViral] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingToTasks, setSavingToTasks] = useState(false);
  const [tasksMessage, setTasksMessage] = useState<string | null>(null);
  const [showBeginnerGuide, setShowBeginnerGuide] = useState(false);
  const [showDemoSamples, setShowDemoSamples] = useState(false);
  const [progressStep, setProgressStep] = useState(-1);
  const [materialsDirtyAfterEvidence, setMaterialsDirtyAfterEvidence] = useState(false);
  const [evidenceDirtyAfterAnalysis, setEvidenceDirtyAfterAnalysis] = useState(false);
  const [evidenceRoles, setEvidenceRoles] = useState<Record<string, EvidenceRole>>({});
  const [manualEvidenceDraft, setManualEvidenceDraft] = useState<ManualEvidenceDraft>(emptyManualEvidenceDraft);

  const reportMarkdown = result ? resultToMarkdown(form, result, generatedAt) : "";

  function markMaterialsChanged() {
    if (form.evidenceCards.length) {
      setMaterialsDirtyAfterEvidence(true);
      setNotice(materialChangedMessage);
    }
    setMaterialAgentResult(null);
    setViralAgentResult(null);
  }

  function markEvidenceChanged() {
    setEvidenceDirtyAfterAnalysis(true);
    setViralAgentResult(null);
    setNotice(result ? "证据已修改，当前体检报告可能已过期，请重新分析。" : "证据已修改，可重新分析。");
  }

  function updateField<K extends keyof RadarFormInput>(field: K, value: RadarFormInput[K]) {
    if (field === "linksText" || field === "manualText") {
      markMaterialsChanged();
    }
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function updateEvidenceCard(cardId: string, updates: Partial<EvidenceCard>) {
    markEvidenceChanged();
    setForm((current) => ({
      ...current,
      evidenceCards: current.evidenceCards.map((card) => card.id === cardId ? { ...card, ...updates } : card),
    }));
    setEvidenceRoles((current) => assignEvidenceRoles(
      form.evidenceCards.map((card) => card.id === cardId ? { ...card, ...updates } : card),
      current,
    ));
  }

  function clearProgressTimer() {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  function startProgress() {
    clearProgressTimer();
    setProgressStep(0);
    progressTimerRef.current = setInterval(() => {
      setProgressStep((current) => Math.min(current + 1, progressSteps.length - 1));
    }, 900);
  }

  function finishProgress(success: boolean) {
    clearProgressTimer();
    setProgressStep(success ? progressSteps.length - 1 : -1);
  }

  function removeEvidenceCard(cardId: string) {
    markEvidenceChanged();
    setForm((current) => ({
      ...current,
      evidenceCards: current.evidenceCards.filter((card) => card.id !== cardId),
    }));
    setEvidenceRoles((current) => assignEvidenceRoles(form.evidenceCards.filter((card) => card.id !== cardId), current));
  }

  function addImageFiles(files: FileList | File[]) {
    setError("");
    const currentImages = form.materials.filter((item) => item.type === "image").length;
    const accepted: MaterialInput[] = [];
    const rejected: string[] = [];

    Array.from(files).forEach((file) => {
      if (currentImages + accepted.length >= imageLimits.maxCount) {
        rejected.push(`${file.name}：一次最多 ${imageLimits.maxCount} 张图片`);
        return;
      }
      if (!imageLimits.acceptedMimeTypes.includes(file.type)) {
        rejected.push(`${file.name}：只支持 png、jpg、jpeg、webp`);
        return;
      }
      if (file.size > imageLimits.maxSizeBytes) {
        rejected.push(`${file.name}：单张图片不能超过 8MB`);
        return;
      }
      accepted.push({
        id: makeId("image"),
        type: "image",
        sourceName: file.name,
        fileName: file.name.replace(/[\\/:*?"<>|]+/g, "-"),
        mimeType: file.type,
        size: file.size,
        previewUrl: URL.createObjectURL(file),
        createdAt: new Date().toISOString(),
      });
    });

    if (accepted.length) {
      const hadEvidence = form.evidenceCards.length > 0;
      markMaterialsChanged();
      setForm((current) => ({
        ...current,
        materials: [...current.materials.filter((item) => item.type !== "image"), ...current.materials.filter((item) => item.type === "image"), ...accepted],
        evidenceCards: current.evidenceCards.filter((card) => card.materialType !== "image"),
      }));
      setNotice(hadEvidence ? materialChangedMessage : `已添加 ${accepted.length} 张图片，请点击“识别素材”生成证据卡片。`);
    }
    if (rejected.length) {
      setError(rejected.join("；"));
    }
  }

  function removeImage(materialId: string) {
    markMaterialsChanged();
    setForm((current) => ({
      ...current,
      materials: current.materials.filter((item) => item.id !== materialId),
      evidenceCards: current.evidenceCards.filter((card) => card.materialId !== materialId),
    }));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      addImageFiles(event.target.files);
      event.target.value = "";
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    addImageFiles(event.dataTransfer.files);
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length) {
      addImageFiles(files);
    }
  }

  async function recognizeEvidence() {
    if (recognizingEvidence || loading) return;
    if (!hasRawMaterialInput(form)) {
      setNotice("请先放入素材。");
      return;
    }
    if (!isAccessPasswordReady) {
      setFieldErrors((current) => ({ ...current, accessPassword: "正在读取访问状态，请稍后再试。" }));
      setNotice("正在读取访问状态，请稍后再试。");
      return;
    }
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setFieldErrors((current) => ({ ...current, accessPassword: "访问密码缺失或已过期，请先在首页输入访问密码。" }));
      setNotice("访问密码缺失或已过期，请先在首页输入访问密码。");
      return;
    }

    setRecognizingEvidence(true);
    setNotice("素材接收 Agent 正在识别...");
    setError("");
    try {
      const response = await fetch("/api/agents/material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessPassword,
          keyword: form.keyword,
          linksText: form.linksText,
          manualText: form.manualText,
          materials: form.materials,
        }),
      });
      const data = await response.json() as { result?: MaterialAgentResult; error?: string };
      if (!response.ok || !data.result) {
        const message = toFriendlyError(data.error || "素材识别失败，请补充商品信息后重试。");
        const fallbackCard = createFallbackEvidenceCard(message);
        setMaterialAgentResult(null);
        setViralAgentResult(null);
        setForm((current) => ({ ...current, evidenceCards: [fallbackCard] }));
        setEvidenceRoles(assignEvidenceRoles([fallbackCard], {}));
        setMaterialsDirtyAfterEvidence(false);
        setEvidenceDirtyAfterAnalysis(false);
        setResult(null);
        setGeneratedAt("");
        setError(message);
        setNotice(message);
        return;
      }

      const agentResult = data.result;
      const agentText = getMaterialAgentText(form);
      const card = createMaterialAgentEvidenceCard(agentResult, agentText);
      setMaterialAgentResult(agentResult);
      setViralAgentResult(null);
      setForm((current) => ({ ...current, evidenceCards: [card] }));
      setEvidenceRoles(assignEvidenceRoles([card], {}));
      setMaterialsDirtyAfterEvidence(false);
      setEvidenceDirtyAfterAnalysis(false);
      setResult(null);
      setGeneratedAt("");
      const duplicateReminder = findDuplicateReminder([card]);
      setNotice(`素材接收 Agent 已识别。${agentResult.summary}${duplicateReminder ? ` ${duplicateReminder}` : ""}`);
      setError("");
    } catch {
      const fallbackCard = createFallbackEvidenceCard("素材识别失败，请补充商品信息后重试。");
      setMaterialAgentResult(null);
      setViralAgentResult(null);
      setForm((current) => ({ ...current, evidenceCards: [fallbackCard] }));
      setEvidenceRoles(assignEvidenceRoles([fallbackCard], {}));
      setMaterialsDirtyAfterEvidence(false);
      setNotice("素材识别失败，请补充商品信息后重试。");
      setError("素材识别失败，请补充商品信息后重试。");
    } finally {
      setRecognizingEvidence(false);
    }
  }

  async function analyzeViralPotential() {
    if (analyzingViral || loading || recognizingEvidence) return;
    if (!hasRawMaterialInput(form)) {
      setNotice("请先放入素材。");
      return;
    }
    if (!materialAgentResult) {
      setNotice("请先识别素材，再进行爆款拆解。");
      return;
    }
    if (!isAccessPasswordReady) {
      setFieldErrors((current) => ({ ...current, accessPassword: "正在读取访问状态，请稍后再试。" }));
      setNotice("正在读取访问状态，请稍后再试。");
      return;
    }
    if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      setFieldErrors((current) => ({ ...current, accessPassword: "访问密码缺失或已过期，请先在首页输入访问密码。" }));
      setNotice("访问密码缺失或已过期，请先在首页输入访问密码。");
      return;
    }

    setAnalyzingViral(true);
    setNotice("爆款拆解 Agent 正在分析...");
    setError("");
    try {
      const response = await fetch("/api/agents/viral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessPassword,
          keyword: form.keyword,
          linksText: form.linksText,
          manualText: form.manualText,
          materials: form.materials,
          evidenceCards: form.evidenceCards,
          materialAgentResult,
        }),
      });
      const data = await response.json() as { result?: ViralAgentResult; error?: string };
      if (!response.ok || !data.result) {
        const message = toFriendlyError(data.error || "爆款拆解失败，请补充标题、卖点、场景或评论需求后重试。");
        setViralAgentResult(null);
        setError(message);
        setNotice(message);
        return;
      }

      setViralAgentResult(data.result);
      setNotice(`爆款拆解 Agent 已完成。${data.result.summary}`);
      setError("");
    } catch {
      setViralAgentResult(null);
      setNotice("爆款拆解失败，请补充标题、卖点、场景或评论需求后重试。");
      setError("爆款拆解失败，请补充标题、卖点、场景或评论需求后重试。");
    } finally {
      setAnalyzingViral(false);
    }
  }

  function addManualEvidence() {
    const hasContent = manualEvidenceDraft.productName.trim()
      || manualEvidenceDraft.priceText.trim()
      || manualEvidenceDraft.heatText.trim()
      || manualEvidenceDraft.notes.trim();

    if (!hasContent) {
      setNotice("请至少填写商品名、价格、热度或备注中的一项。");
      return;
    }

    const now = new Date().toISOString();
    const card: EvidenceCard = {
      id: makeId("card"),
      materialId: makeId("manual"),
      materialType: "text",
      detectedMaterialType: "manual_text",
      status: manualEvidenceDraft.productName.trim() ? "partial" : "need_more_info",
      missingFields: [
        manualEvidenceDraft.productName.trim() ? "" : "商品名",
        manualEvidenceDraft.priceText.trim() ? "" : "价格",
        manualEvidenceDraft.heatText.trim() ? "" : "热度",
      ].filter(Boolean),
      message: "手动填写的证据卡片。识别不准时，可以用它继续分析。",
      riskNotes: "",
      userNotes: manualEvidenceDraft.notes.trim(),
      productName: manualEvidenceDraft.productName.trim(),
      normalizedProductName: manualEvidenceDraft.productName.trim(),
      priceText: manualEvidenceDraft.priceText.trim(),
      salesText: manualEvidenceDraft.heatText.trim(),
      ratingText: "",
      rankText: "",
      shopName: "",
      brandName: "",
      pageTitle: "",
      visibleDescription: manualEvidenceDraft.notes.trim(),
      sourceUrl: "",
      platform: manualEvidenceDraft.platform,
      rawEvidenceText: manualEvidenceDraft.notes.trim() || manualEvidenceDraft.productName.trim() || "手动填写证据",
      capturedAt: now,
      confidenceFields: [
        confidenceField("手动填写", "用户确认", "high", "来自用户手动补充。"),
      ],
    };

    const hasPrimary = Boolean(getPrimaryEvidenceId(form.evidenceCards, evidenceRoles));
    const nextCards = [...form.evidenceCards, card];
    const nextRoles = assignEvidenceRoles(nextCards, {
      ...evidenceRoles,
      [card.id]: hasPrimary ? "supporting" : "primary",
    });

    setForm((current) => ({ ...current, evidenceCards: [...current.evidenceCards, card] }));
    setEvidenceRoles(nextRoles);
    setManualEvidenceDraft(emptyManualEvidenceDraft);
    setMaterialsDirtyAfterEvidence(false);
    markEvidenceChanged();
  }

  function setEvidenceRole(cardId: string, role: EvidenceRole) {
    markEvidenceChanged();
    setEvidenceRoles((current) => {
      if (role === "primary") {
        const next: Record<string, EvidenceRole> = {};
        for (const card of form.evidenceCards) {
          next[card.id] = card.id === cardId ? "primary" : "supporting";
        }
        return assignEvidenceRoles(form.evidenceCards, next);
      }
      return assignEvidenceRoles(form.evidenceCards, { ...current, [cardId]: "supporting" });
    });
  }

  function validateBeforeAnalyze(currentForm: RadarFormInput) {
    const errors: FieldErrors = {};
    if (!isAccessPasswordReady) {
      errors.accessPassword = "正在读取访问状态，请稍后再试。";
    } else if (!canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)) {
      errors.accessPassword = "访问密码缺失或已过期，请先在首页输入访问密码。";
    }
    if (!currentForm.keyword.trim()) {
      errors.keyword = "请输入关键词或品类。";
    }
    if (materialsDirtyAfterEvidence) {
      errors.manualText = materialChangedMessage;
    }
    if (!currentForm.evidenceCards.some(isValidEvidenceCard)) {
      errors.manualText = "请先补充至少一张有效证据卡片。";
    }
    for (const [field, limit] of Object.entries(inputLimits) as Array<[keyof RadarFormInput, number]>) {
      const value = currentForm[field];
      if (typeof value === "string" && getTextLength(value) > limit) {
        errors[field] = `最多输入 ${limit} 个字符。`;
      }
    }
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || recognizingEvidence || analyzingViral) return;

    const primaryId = getPrimaryEvidenceId(form.evidenceCards, evidenceRoles);
    if (!primaryId) {
      setNotice("请先补充一张有效证据卡片，并设为主商品。");
      return;
    }

    const orderedCards = orderCardsForAnalysis(form.evidenceCards, evidenceRoles);
    const primaryCard = orderedCards[0];
    const currentForm = {
      ...form,
      evidenceCards: orderedCards,
      notes: [
        form.notes,
        `主商品：${primaryCard.productName || primaryCard.pageTitle || primaryCard.visibleDescription || primaryCard.userNotes || "未命名商品"}`,
        "请围绕主商品分析，其他辅助证据只作为热度、同类方向、价格参考或风险参考。",
      ].filter(Boolean).join("\n"),
    };

    const errors = validateBeforeAnalyze(currentForm);
    setFieldErrors(errors);
    setError("");
    setNotice("");
    if (Object.keys(errors).length > 0) {
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);
    startProgress();
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...currentForm, accessPassword }),
        signal: controller.signal,
      });
      const data = await response.json() as HotProductRadarResult | GenerateErrorResponse;
      if (!response.ok) {
        const errorData = data as GenerateErrorResponse;
        setError(toFriendlyError(errorData.error || "生成失败，请稍后重试。"));
        setFieldErrors(errorData.fieldErrors || {});
        finishProgress(false);
        return;
      }
      setResult(data as HotProductRadarResult);
      setGeneratedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
      setEvidenceDirtyAfterAnalysis(false);
      finishProgress(true);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        setNotice("已取消本次分析。你可以继续修改证据卡片后重新开始。");
      } else {
        setError(toFriendlyError("failed to fetch"));
      }
      finishProgress(false);
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }

  function fillSample() {
    setForm(sampleForm);
    setEvidenceRoles({});
    setMaterialsDirtyAfterEvidence(false);
    setEvidenceDirtyAfterAnalysis(false);
    setMaterialAgentResult(null);
    setViralAgentResult(null);
    setAnalyzingViral(false);
    setManualEvidenceDraft(emptyManualEvidenceDraft);
    setFieldErrors({});
    setError("");
    setNotice("示例已填入，点击“识别素材”即可生成证据卡片。");
    setResult(null);
    setGeneratedAt("");
  }

  function clearAll() {
    clearDraft();
    setForm(emptyForm);
    setEvidenceRoles({});
    setMaterialsDirtyAfterEvidence(false);
    setEvidenceDirtyAfterAnalysis(false);
    setMaterialAgentResult(null);
    setViralAgentResult(null);
    setAnalyzingViral(false);
    setManualEvidenceDraft(emptyManualEvidenceDraft);
    setFieldErrors({});
    setError("");
    setNotice("");
    setResult(null);
    setGeneratedAt("");
    setProgressStep(-1);
    clearProgressTimer();
  }

  function cancelAnalysis() {
    abortControllerRef.current?.abort();
    clearProgressTimer();
    setLoading(false);
    setProgressStep(-1);
  }

  function restartAnalysis() {
    setResult(null);
    setGeneratedAt("");
    setProgressStep(-1);
    setEvidenceDirtyAfterAnalysis(false);
    setNotice("已回到证据确认阶段，你可以修改证据卡片后重新分析。");
  }

  function togglePlatform(platform: Platform) {
    const selected = new Set(form.selectedPlatforms);
    if (selected.has(platform)) {
      selected.delete(platform);
    } else {
      selected.add(platform);
    }
    if (selected.size === 0) {
      selected.add("manual");
    }
    updateField("selectedPlatforms", Array.from(selected) as Platform[]);
  }

  function toggleLimit(limit: string) {
    const selected = new Set(form.personalLimits);
    if (selected.has(limit)) {
      selected.delete(limit);
    } else {
      selected.add(limit);
    }
    updateField("personalLimits", Array.from(selected));
  }

  function exportMarkdown() {
    if (!result) return;
    downloadTextFile(`${sanitizeFileName(form.keyword)}-爆款素材识别报告.md`, reportMarkdown, "text/markdown;charset=utf-8");
  }

  function exportWord() {
    if (!result) return;
    downloadTextFile(
      `${sanitizeFileName(form.keyword)}-爆款素材识别报告.doc`,
      resultToWordHtml(form, result, generatedAt),
      "application/msword;charset=utf-8",
    );
  }

  function confidenceToScore(level: string) {
    if (level === "high") return 80;
    if (level === "medium") return 55;
    return 30;
  }

  async function saveToTaskCenter() {
    if (!result || savingToTasks) return;
    setSavingToTasks(true);
    setTasksMessage(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessPassword,
          type: "radar",
          title: form.keyword.trim() || "未命名分析",
          platform: "manual",
          source: "ai",
          materialText: form.manualText || form.keyword,
          result: {
            ...result,
            oneLineSummary: result.summary || result.agentConclusion,
            level: result.finalDecision,
            score: confidenceToScore(result.confidenceLevel),
          },
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: { code?: string; message?: string } };
      if (!response.ok || !data.ok) {
        setTasksMessage(data.error?.message || "保存到任务中心失败。");
        return;
      }
      setTasksMessage("已保存到任务中心");
    } catch {
      setTasksMessage("网络异常，保存失败。");
    } finally {
      setSavingToTasks(false);
    }
  }

  async function saveLocalArchive() {
    if (!result || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/radar/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessPassword,
          keyword: form.keyword,
          finalDecision: getDecisionFileName(result.finalDecision),
          markdown: reportMarkdown,
          payload: { form, result, generatedAt },
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; markdownFileName?: string; jsonFileName?: string; relativeDir?: string };
      if (!response.ok || !data.ok) {
        setError(toFriendlyError(data.error || "保存失败，请稍后重试。"));
        return;
      }
      rememberLocalArchive(result);
      const savedFileName = data.markdownFileName || data.jsonFileName || "";
      const savedLocation = savedFileName
        ? `${data.relativeDir || ".local/radar-research"}/${savedFileName}`
        : data.relativeDir || ".local/radar-research";
      setNotice(`已保存本地选品档案：${savedLocation}`);
    } catch {
      setError(toFriendlyError("failed to fetch"));
    } finally {
      setSaving(false);
    }
  }

  const imageMaterials = form.materials.filter((item) => item.type === "image");
  const rawMaterialReady = hasRawMaterialInput(form);
  const anyMaterialReady = hasAnyMaterialInput(form);
  const validEvidenceCards = form.evidenceCards.filter(isValidEvidenceCard);
  const primaryEvidenceId = getPrimaryEvidenceId(form.evidenceCards, evidenceRoles);
  const evidenceNeedsMoreInfo = validEvidenceCards.some((card) => !hasPriceOrHeat(card));

  const recognizeDisabled = recognizingEvidence || loading || analyzingViral || !rawMaterialReady;
  const analyzeDisabled = loading
    || recognizingEvidence
    || analyzingViral
    || !anyMaterialReady
    || !canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)
    || materialsDirtyAfterEvidence
    || !primaryEvidenceId
    || (Boolean(result) && !evidenceDirtyAfterAnalysis);
  const viralAnalyzeDisabled = loading || recognizingEvidence || analyzingViral;

  const recognizeHint = recognizingEvidence
    ? "素材接收 Agent 正在识别..."
    : !rawMaterialReady
      ? "请先放入素材。"
      : "先提取商品类型、卖点、人群、场景、价格和风险。";

  const analyzeHint = loading
    ? "正在分析素材，请稍等。"
    : !anyMaterialReady
      ? "请先放入素材。"
      : !isAccessPasswordReady
        ? "正在读取访问状态，请稍后再试。"
        : !canRequestWithAccessPassword(isAccessPasswordReady, accessPassword)
          ? "访问密码缺失或已过期，请先在首页输入访问密码。"
        : materialsDirtyAfterEvidence
          ? materialChangedMessage
          : !primaryEvidenceId
            ? "请先确认一张有效证据。"
            : result && !evidenceDirtyAfterAnalysis
              ? "已生成选品结论，先查看右侧报告。"
              : "开始体检：根据确认后的证据生成最终选品结论。";

  const viralHint = analyzingViral
    ? "爆款拆解 Agent 正在分析..."
    : !rawMaterialReady
      ? "请先放入素材。"
      : !materialAgentResult
        ? "请先识别素材，再进行爆款拆解。"
        : viralAgentResult
          ? "爆款拆解 Agent 已完成。"
          : "根据标题、卖点、场景、评论需求和痛点，判断海外平台内容爆款潜力。";

  const assistantState = loading
    ? {
        title: "正在分析素材",
        text: "正在生成小白选品结论，已开启省钱模式。",
        detail: "请不要重复点击，避免浪费分析次数。",
      }
    : recognizingEvidence
      ? {
          title: "素材接收 Agent 正在识别...",
          text: "正在提取商品类型、卖点、人群、场景、价格和风险词。",
          detail: "这一步只整理证据，不生成最终选品结论。",
        }
    : analyzingViral
      ? {
          title: "爆款拆解 Agent 正在分析...",
          text: "正在看标题钩子、卖点、场景、评论需求和内容可拍性。",
          detail: "这一步分析海外平台内容趋势与商品机会，不构成经营决策。",
        }
    : result
      ? {
          title: "查看选品结论",
          text: "先看最终判断，再看适合无货源吗、爆款潜力和下一步建议。",
          detail: evidenceDirtyAfterAnalysis ? "证据已修改，当前体检报告可能已过期，请重新分析。" : "详细依据在下方折叠区。",
        }
      : viralAgentResult
        ? {
            title: "爆款拆解 Agent 已完成",
            text: viralAgentResult.summary,
            detail: "这只是内容爆款潜力判断，不是最终做不做的结论。",
          }
      : materialAgentResult
        ? {
            title: "素材接收 Agent 已识别",
            text: materialAgentResult.summary,
            detail: "请先核对商品类型、卖点、人群、场景和缺失信息。",
          }
      : materialsDirtyAfterEvidence
        ? {
            title: "请重新识别证据",
            text: materialChangedMessage,
            detail: "不要用旧证据直接分析新素材。",
          }
        : form.evidenceCards.length
          ? {
              title: "检查证据",
              text: "请检查商品类型、卖点、价格、热度是否正确。识别不准可以手动修改。",
              detail: evidenceNeedsMoreInfo ? insufficientEvidenceMessage : "确认无误后再点开始体检。",
            }
          : rawMaterialReady
            ? {
                title: "下一步：识别素材",
                text: "下一步：点击“识别素材”，先提取商品类型、卖点、价格和风险。",
                detail: "本地识别不要求访问密码。",
              }
            : {
                title: "请先放入素材",
                text: "先粘贴海外平台内容链接、商品信息或选品想法。",
                detail: "只需要先完成第一步，不用理解技术设置。",
              };

  const hasMaterialInput = hasRawMaterialInput(form);

  return (
    <main className="app-shell px-3 py-4 sm:px-5 lg:px-6">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="flex min-w-0 flex-col gap-4">
          <header className="workspace-header">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="section-title text-2xl">粘贴商品素材，判断这个品能不能做</h1>
                <p className="muted-text mt-1 text-sm">半自动 AI 分析工具：AI 负责分析/生成/整理，关键决策由人工确认。</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="linear-pill px-3 py-1 text-sm">本地部署</span>
                <span className="linear-pill linear-pill-brand px-3 py-1 text-sm">省钱模式：已开启</span>
                <button
                  type="button"
                  onClick={() => {
                    clearAll();
                  }}
                  className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                >
                  新建体检
                </button>
              </div>
            </div>
            <WorkspaceMobileNav />
          </header>

          <section className="surface-card p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="linear-kicker">v1.1 小白入口</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">不知道从哪开始，就先跑一遍标准流程</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  AI 结果仅供初筛，关键动作需人工确认。这里不会自动爬取、发布或操作外部平台。
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
                <button
                  type="button"
                  onClick={() => setShowBeginnerGuide((current) => !current)}
                  className="linear-button-primary inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                >
                  我是新手，带我跑一遍
                </button>
                <button
                  type="button"
                  onClick={() => setShowDemoSamples((current) => !current)}
                  className="linear-button inline-flex h-11 items-center justify-center px-5 text-sm font-semibold"
                >
                  加载演示样例
                </button>
              </div>
            </div>

            {showBeginnerGuide ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {beginnerGuideSteps.map((item) => (
                  <article key={item.step} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-bold text-teal-700">{item.step}</p>
                    <h3 className="mt-1 text-base font-semibold text-slate-950">{item.title}</h3>
                    <p className="mt-2 min-h-[48px] text-sm leading-6 text-slate-600">{item.description}</p>
                    <Link
                      href={item.href}
                      className="linear-button-soft mt-3 inline-flex h-10 items-center justify-center px-4 text-sm font-semibold"
                    >
                      去这一步
                    </Link>
                  </article>
                ))}
              </div>
            ) : null}

            {showDemoSamples ? (
              <div className="mt-5">
                <div className="rounded-2xl border border-teal-200 bg-teal-50/80 p-4">
                  <p className="text-sm font-bold text-teal-800">演示样例，不调用真实 AI</p>
                  <p className="mt-1 text-sm leading-6 text-teal-700">
                    以下是固定静态样例，只用于面试或产品演示，不代表真人测试结果，也不会写入数据库。
                  </p>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  {demoProducts.map((item) => (
                    <article key={item.name} className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="text-base font-semibold text-slate-950">{item.name}</h3>
                        <span className={"rounded-full border px-3 py-1 text-xs font-bold " + item.riskClass}>
                          {item.risk}
                        </span>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-slate-800">{item.highlight}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.reason}</p>
                      <Link
                        href={item.href}
                        className="linear-button-soft mt-4 inline-flex h-10 items-center justify-center px-4 text-sm font-semibold"
                      >
                        {item.pageLabel}
                      </Link>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <form onSubmit={handleSubmit} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-5">
              <section className="surface-card-strong p-5 sm:p-6">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="section-title text-2xl sm:text-3xl">素材输入</h2>
                    <p className="muted-text mt-1 text-sm">填入素材后逐步识别、拆解、生成结论。当前是半自动流程，AI 负责整理证据，你负责确认判断。</p>
                    {draftRestored ? (
                      <p className="mt-2 text-xs font-semibold text-teal-700">已恢复上次未完成内容</p>
                    ) : null}
                  </div>
                  <span className="linear-pill linear-pill-brand px-3 py-1 text-xs">
                    {assistantState.title}
                  </span>
                </div>

                <TextareaInput
                  label="素材输入"
                  value={form.manualText}
                  limit={inputLimits.manualText || 12000}
                  error={fieldErrors.manualText}
                  onChange={(value) => updateField("manualText", value)}
                  placeholder="粘贴海外平台内容、商品信息、评论需求、选品想法。例如：标题、卖点、价格、目标人群、使用场景、评论区问题。"
                  rows={8}
                />

                {/* 主操作按钮 — 放在输入区下方首屏可见 */}
                <div className="mt-4 grid gap-3 lg:grid-cols-5">
                  <button
                    type="button"
                    onClick={() => {
                      void recognizeEvidence();
                    }}
                    disabled={recognizeDisabled}
                    className="linear-button-primary inline-flex h-12 items-center justify-center gap-2 px-4 text-sm font-semibold disabled:hover:translate-y-0 lg:col-span-1"
                  >
                    <Sparkles className="size-4" />
                    {recognizingEvidence ? "1 识别中" : "1 识别素材"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void analyzeViralPotential();
                    }}
                    disabled={viralAnalyzeDisabled}
                    className="linear-button-soft inline-flex h-12 items-center justify-center gap-2 px-4 text-sm font-semibold disabled:hover:translate-y-0 lg:col-span-1"
                  >
                    <Brain className="size-4" />
                    {analyzingViral ? "2 分析中" : "2 爆款拆解"}
                  </button>
                  <button
                    type="submit"
                    disabled={analyzeDisabled}
                    className="linear-button-primary inline-flex h-12 items-center justify-center gap-2 px-4 text-sm font-semibold disabled:hover:translate-y-0 lg:col-span-1"
                  >
                    <Wand2 className="size-4" />
                    {loading ? "3 体检中" : "3 开始体检"}
                  </button>
                  <button
                    type="button"
                    onClick={fillSample}
                    className="linear-button inline-flex h-12 items-center justify-center gap-2 px-4 text-sm font-semibold"
                  >
                    <RefreshCcw className="size-4" />
                    填入示例
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="linear-button inline-flex h-12 items-center justify-center gap-2 px-4 text-sm font-semibold hover:text-red-700"
                  >
                    <Trash2 className="size-4" />
                    清空
                  </button>
                </div>

                {/* 三步说明 */}
                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  {[
                    ["01", "粘贴素材", "内容 / 链接 / 截图"],
                    ["02", "识别证据", "商品、卖点、风险"],
                    ["03", "开始体检", "推荐 / 谨慎 / 不建议"],
                  ].map(([step, title, text]) => (
                    <div key={step} className="workflow-step p-3">
                      <p className="text-[11px] font-semibold text-teal-700">{step}</p>
                      <h3 className="mt-1 text-sm font-semibold text-slate-900">{title}</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{text}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <TextInput
                    label="访问密码"
                    required
                    type="password"
                    value={accessPassword}
                    error={fieldErrors.accessPassword}
                    onChange={(value) => {
                      setAccessPassword(value);
                      setFieldErrors((current) => ({ ...current, accessPassword: undefined }));
                      if (value.trim()) {
                        setNotice("访问密码已保存，本次会话内全站可用");
                      }
                    }}
                    placeholder="开始体检前需要填写"
                  />
                  <TextInput
                    label="关键词 / 品类"
                    required
                    value={form.keyword}
                    limit={inputLimits.keyword || 80}
                    error={fieldErrors.keyword}
                    onChange={(value) => updateField("keyword", value)}
                    placeholder="例如：TikTok kitchen gadgets、Amazon pet supplies"
                  />
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
                  <div
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleDrop}
                    onPaste={handlePaste}
                    className="surface-card-soft border-dashed border-teal-200/80 p-4 text-center"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <div className="linear-icon mx-auto size-12 rounded-xl">
                      <ImagePlus className="size-5" />
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-900">图片 / 截图</p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="linear-button-soft mt-2 inline-flex h-11 items-center gap-2 px-3 text-xs font-semibold"
                    >
                      <UploadCloud className="size-4" />
                      选择图片
                    </button>
                  </div>
                  <TextareaInput
                    label="补充链接"
                    value={form.linksText}
                    limit={inputLimits.linksText || 3000}
                    error={fieldErrors.linksText}
                    onChange={(value) => updateField("linksText", value)}
                    placeholder="也可以粘贴 TikTok、Amazon、Etsy、Shopify 等链接。"
                    rows={4}
                  />
                </div>

                {imageMaterials.length ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {imageMaterials.map((image) => (
                        <div key={image.id} className="relative overflow-hidden rounded-2xl border border-white/80 bg-white/80 shadow-sm">
                        {image.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={image.previewUrl} alt={image.fileName || "商品截图"} className="h-24 w-full object-cover" />
                        ) : null}
                        <div className="flex items-center justify-between gap-2 px-2 py-1">
                          <p className="truncate text-xs text-slate-600">{image.fileName}</p>
                          <button type="button" onClick={() => removeImage(image.id)} className="text-slate-400 hover:text-red-600" title="移除图片">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="surface-card-soft mt-4 grid gap-2 p-3 text-xs leading-5 text-slate-600 md:grid-cols-3">
                  <p><span className="font-semibold text-teal-800">1 识别素材：</span>{recognizeHint}</p>
                  <p><span className="font-semibold text-teal-800">2 爆款拆解：</span>{viralHint}</p>
                  <p><span className="font-semibold text-teal-800">3 开始体检：</span>{analyzeHint}</p>
                </div>

                {evidenceNeedsMoreInfo && form.evidenceCards.length ? (
                  <div className="mt-3"><AlertBox tone="notice" text={insufficientEvidenceMessage} /></div>
                ) : null}
                {error ? <div className="mt-3"><AlertBox tone="error" text={error} /></div> : null}
                {notice ? <div className="mt-3"><AlertBox tone="notice" text={notice} /></div> : null}

                <details className="surface-card-soft mt-3 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-800">更多设置 / 手动补充</summary>
                  <div className="mt-3 flex flex-col gap-3">
                    <details className="surface-card-soft p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-indigo-800">识别不准？手动填写商品信息</summary>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <TextInput label="商品名" value={manualEvidenceDraft.productName} onChange={(value) => setManualEvidenceDraft((current) => ({ ...current, productName: value }))} placeholder="例如：透明桌面收纳盒" />
                        <SelectInput label="平台" value={manualEvidenceDraft.platform} onChange={(value) => setManualEvidenceDraft((current) => ({ ...current, platform: value as Platform | "unknown" }))} options={[{ value: "unknown", label: "未知" }, ...platformOptions.map((platform) => ({ value: platform, label: platformLabels[platform] }))]} />
                        <TextInput label="价格" value={manualEvidenceDraft.priceText} onChange={(value) => setManualEvidenceDraft((current) => ({ ...current, priceText: value }))} placeholder="例如：19.9 元" />
                        <TextInput label="热度" value={manualEvidenceDraft.heatText} onChange={(value) => setManualEvidenceDraft((current) => ({ ...current, heatText: value }))} placeholder="例如：评价10万+、榜单靠前" />
                        <div className="md:col-span-2">
                          <TextareaInput label="备注" value={manualEvidenceDraft.notes} onChange={(value) => setManualEvidenceDraft((current) => ({ ...current, notes: value }))} placeholder="补充你看到的卖点、截图内容或风险" rows={3} />
                        </div>
                      </div>
                      <button type="button" onClick={addManualEvidence} className="linear-button-soft mt-3 inline-flex h-11 items-center justify-center px-4 text-sm font-semibold">
                        添加为证据卡片
                      </button>
                    </details>

                    <SelectInput label="分析目标" value={form.analysisGoal} onChange={(value) => updateField("analysisGoal", value)} options={analysisGoals.map((goal) => ({ value: goal, label: goal }))} />
                    <TextInput label="目标价格带" value={form.targetPriceRange} limit={inputLimits.targetPriceRange || 80} onChange={(value) => updateField("targetPriceRange", value)} placeholder="例如：9.9-39.9 元" />
                    <TextareaInput label="目标人群" value={form.targetAudience} limit={inputLimits.targetAudience || 200} onChange={(value) => updateField("targetAudience", value)} placeholder="例如：学生宿舍、租房人群、厨房清洁需求" rows={3} />
                    <TextareaInput label="排除类目" value={form.excludedCategories} limit={inputLimits.excludedCategories || 300} onChange={(value) => updateField("excludedCategories", value)} placeholder="食品、美妆、儿童用品、带电、大件、易碎、强 IP" rows={3} />
                    <CheckboxGroup label="平台选择" options={platformOptions.map((platform) => ({ value: platform, label: platformLabels[platform] }))} selected={form.selectedPlatforms} onToggle={(value) => togglePlatform(value as Platform)} />
                    <CheckboxGroup label="我的限制" options={personalLimitOptions.map((limit) => ({ value: limit, label: limit }))} selected={form.personalLimits} onToggle={toggleLimit} />
                  </div>
                </details>
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <div className="surface-card-soft p-4 sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-3">
                      <span className="linear-icon size-11 shrink-0 rounded-xl">
                        <ClipboardCheck className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-emerald-700">常用入口</p>
                        <h2 className="mt-1 text-lg font-semibold text-slate-950">跨境商品利润测算</h2>
                        <p className="mt-1 text-sm leading-6 text-slate-600">
                          需要先算成本和利润时再进入；主流程仍然是先粘贴素材做选品分析。
                        </p>
                      </div>
                    </div>
                    <Link href="/products/new" className="linear-button-soft inline-flex h-11 shrink-0 items-center justify-center px-5 text-sm font-semibold">
                      开始测算
                    </Link>
                  </div>
                </div>
                <div className="surface-card-soft p-4 sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-3">
                      <span className="linear-icon size-11 shrink-0 rounded-xl">
                        <FileText className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-sky-700">任务中心</p>
                        <h2 className="mt-1 text-lg font-semibold text-slate-950">沉淀分析结果</h2>
                        <p className="mt-1 text-sm leading-6 text-slate-600">
                          查看历史任务、继续分析素材，把每次判断沉淀成可复盘记录。
                        </p>
                      </div>
                    </div>
                    <Link href="/tasks" className="linear-button inline-flex h-11 shrink-0 items-center justify-center px-5 text-sm font-semibold">
                      查看任务
                    </Link>
                  </div>
                </div>
              </section>


              {materialAgentResult ? <MaterialAgentSummaryCard result={materialAgentResult} /> : null}
              {viralAgentResult ? <ViralAgentSummaryCard result={viralAgentResult} /> : null}

              {form.evidenceCards.length ? (
                <section className="surface-card p-5 sm:p-6">
                  <SectionTitle title="确认证据" count={form.evidenceCards.length} />
                  <div className="flex flex-col gap-3">
                    {form.evidenceCards.map((card, index) => (
                      <EvidenceCardEditor
                        key={card.id}
                        card={card}
                        index={index}
                        role={evidenceRoles[card.id] || "supporting"}
                        isValid={isValidEvidenceCard(card)}
                        onChange={(updates) => updateEvidenceCard(card.id, updates)}
                        onRemove={() => removeEvidenceCard(card.id)}
                        onRoleChange={(role) => setEvidenceRole(card.id, role)}
                      />
                    ))}
                  </div>
                </section>
              ) : (
                <div className="surface-card flex min-h-[220px] flex-col items-center justify-center border-dashed border-teal-200 p-6 text-center">
                  <div className="linear-icon size-12 rounded-xl">
                    <UploadCloud className="size-5" />
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-slate-950">等待素材输入</h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">放入素材后，先点“识别素材”。</p>
                </div>
              )}

              {result ? (
                <section className="flex flex-col gap-4">
                  <SummaryCard result={result} />
                  <TrafficLightPanel risks={result.trafficLightRisks} />
                  <details open className="surface-card p-4">
                    <summary className="cursor-pointer text-sm font-bold text-slate-900">详细依据</summary>
                    <div className="mt-4 flex flex-col gap-4">
                      <KeywordAndDirectionPanel result={result} />
                      <RiskAndIdeas result={result} />
                      <NextActions result={result} />
                    </div>
                  </details>
                  <details className="surface-card p-4">
                    <summary className="cursor-pointer text-sm font-bold text-slate-900">候选商品</summary>
                    <div className="mt-4 flex flex-col gap-4">
                      <div className="grid gap-4 xl:grid-cols-3">
                        <ProductGroup title="推荐做" type="recommend" products={result.recommendedProducts} />
                        <ProductGroup title="谨慎做" type="caution" products={result.cautiousProducts} />
                        <ProductGroup title="不建议做" type="reject" products={result.rejectedProducts} />
                      </div>
                      <div className="flex flex-col gap-3">
                        {result.candidateProducts.length ? result.candidateProducts.map((product, index) => (
                          <ProductCard key={product.productName + index} product={product} />
                        )) : (
                          <EmptyState text="没有识别到候选商品，请补充更清晰的商品/榜单信息。" />
                        )}
                      </div>
                    </div>
                  </details>
                  <details className="surface-card p-4">
                    <summary className="cursor-pointer text-sm font-bold text-slate-900">平台读取情况</summary>
                    <div className="mt-4 flex flex-col gap-4">
                      <PlatformStatusList statuses={result.platformSearchStatus} />
                      <EvidenceSection result={result} />
                    </div>
                  </details>
                  <details className="surface-card p-4">
                    <summary className="cursor-pointer text-sm font-bold text-slate-900">原始证据</summary>
                    <div className="mt-4">
                      <EvidenceCardList cards={result.evidenceCards} />
                    </div>
                  </details>
                  <p className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-xs leading-6 text-amber-800">
                    {result.disclaimer || reportDisclaimer}
                  </p>
                </section>
              ) : null}
            </div>

            <aside className="flex flex-col gap-4">
              <section className="surface-card sticky top-4 p-4">
                <p className="linear-kicker">当前步骤</p>
                <h2 className="section-title mt-3 text-xl">{assistantState.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{assistantState.text}</p>
                <div className="mt-4 flex flex-col gap-2">
                  {[
                    { step: 1, label: "放入素材", desc: "粘贴内容、链接或截图" },
                    { step: 2, label: "AI 识别信息", desc: "提取商品证据和风险" },
                    { step: 3, label: "生成判断报告", desc: "推荐做 / 谨慎做 / 不建议做" },
                  ].map((item) => (
                    <div key={item.step} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">{item.step}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                        <p className="text-xs text-slate-500">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {result ? (
                  <div className="mt-4 grid gap-2">
                    <CopyButton text={reportMarkdown} label="复制报告" />
                    <button type="button" onClick={exportMarkdown} className="linear-button inline-flex h-11 items-center justify-center gap-2 px-3 text-sm font-semibold">
                      <Download className="size-4" />
                      导出 Markdown
                    </button>
                    <button type="button" onClick={exportWord} className="linear-button inline-flex h-11 items-center justify-center gap-2 px-3 text-sm font-semibold">
                      <FileText className="size-4" />
                      导出 Word
                    </button>
                    <button type="button" onClick={saveLocalArchive} disabled={saving} className="linear-button inline-flex h-11 items-center justify-center gap-2 px-3 text-sm font-semibold disabled:opacity-60">
                      <Save className="size-4" />
                      {saving ? "保存中" : "保存本地档案"}
                    </button>
                    <button type="button" onClick={saveToTaskCenter} disabled={savingToTasks} className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-3 text-sm font-semibold disabled:opacity-60">
                      <Save className="size-4" />
                      {savingToTasks ? "保存中" : "保存到任务中心"}
                    </button>
                    {tasksMessage ? (
                      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">{tasksMessage}</p>
                    ) : null}
                  </div>
                ) : null}
              </section>
            </aside>
          </form>

          <details className="surface-card p-5 sm:p-6">
            <summary className="cursor-pointer text-base font-semibold text-slate-800">后续能力规划</summary>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              当前主流程：半自动分析 + 人工确认。以下能力仅为规划，不会自动发布、投广告或操作外部平台。
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {agentCapabilityMatrix.map((item) => {
                const isLive = item.status === "已上线" && "href" in item && item.href;
                return (
                <div key={item.name} className={(isLive ? "agent-card" : "agent-card-planned") + " p-3"}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-950">{item.name}</h3>
                    <span className={(isLive ? "linear-pill-brand" : "text-slate-500") + " linear-pill px-2 py-0.5 text-[11px]"}>
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
                  <div className="mt-2">
                    {isLive ? (
                      <Link href={item.href} className="linear-button-primary inline-flex h-9 items-center justify-center px-3 text-xs font-semibold">
                        {item.cta}
                      </Link>
                    ) : (
                      <button type="button" disabled className="linear-button inline-flex h-9 items-center justify-center px-3 text-xs font-semibold opacity-60">
                        规划中
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
              {workflowPreviewSteps.map((step, index) => (
                <div key={step} className="workflow-step p-2 text-center">
                  <span className="text-[10px] font-semibold text-slate-400">0{index + 1}</span>
                  <p className="mt-0.5 text-xs text-slate-500">{step}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              未来多 Agent 工作流仅为规划，不会自动发布、投广告或操作外部平台。高风险动作后期也必须保留人工确认。
            </p>
          </details>
        </div>
      </div>
    </main>
  );
}

function MaterialAgentSummaryCard({ result }: { result: MaterialAgentResult }) {
  const rows = [
    ["商品类型", result.productType],
    ["核心卖点", materialListText(result.sellingPoints)],
    ["目标人群", materialListText(result.targetUsers)],
    ["使用场景", materialListText(result.usageScenarios)],
    ["价格区间", result.priceRange || "未提到"],
    ["用户痛点", materialListText(result.painPoints)],
    ["评论需求", materialListText(result.commentDemands)],
    ["初步风险词", materialListText(result.riskWords)],
    ["素材完整度", result.materialCompleteness],
    ["缺失信息", materialListText(result.missingInfo)],
  ] as const;

  return (
    <div className="linear-panel border-teal-200 bg-teal-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-teal-700">素材接收 Agent 已识别</p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">{result.productType || "未提到"}</h3>
        </div>
        <span className="rounded-full border border-teal-200 bg-white px-2 py-0.5 text-xs font-bold text-teal-700">
          {result.materialCompleteness}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700">{result.summary || "这段素材还可以再补充一点信息。"}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-teal-100 bg-white/85 p-3">
            <p className="text-xs font-bold text-slate-500">{label}</p>
            <p className="mt-1 text-sm leading-6 text-slate-800">{value || "未提到"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function getViralLevelClass(level: "高" | "中" | "低") {
  switch (level) {
    case "高":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "中":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

function ViralAgentSummaryCard({ result }: { result: ViralAgentResult }) {
  const fields = [
    { label: "标题吸引力", value: result.titleAttraction },
    { label: "卖点清晰度", value: result.sellingPointClarity },
    { label: "场景代入感", value: result.sceneSense },
    { label: "评论需求强度", value: result.commentDemand },
    { label: "痛点强度", value: result.painPointStrength },
    { label: "内容可拍性", value: result.contentShootability },
  ] as const;

  const listGroups = [
    { label: "主要加分点", items: result.bonusPoints },
    { label: "主要短板", items: result.weakPoints },
    { label: "优化建议", items: result.optimizationSuggestions },
    { label: "可尝试的内容角度", items: result.suggestedAngles },
  ] as const;

  return (
    <div className="linear-panel border-sky-200 bg-sky-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-sky-700">爆款拆解 Agent 已完成</p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">{result.summary || "海外平台内容趋势与商品机会已拆解完成。"}</h3>
        </div>
        <span className={"rounded-full border px-2 py-0.5 text-xs font-bold " + getViralLevelClass(result.viralPotential)}>
          爆款潜力：{result.viralPotential}
        </span>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className={"rounded-2xl border p-3 " + getViralLevelClass(result.viralPotential)}>
          <p className="text-sm font-semibold">爆款潜力</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{result.viralPotential}</p>
          <p className="mt-1 text-sm leading-6 text-slate-700">这是内容爆款潜力判断，不是最终做不做的结论。</p>
        </div>
        {fields.map((field) => (
          <div key={field.label} className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">{field.label}</p>
              <span className={"rounded-full border px-2 py-0.5 text-xs font-bold " + getViralLevelClass(field.value.level)}>
                {field.value.level}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-700">{field.value.reason?.trim() || "证据不足"}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {listGroups.map((group) => {
          const items = group.items.filter((item) => item.trim()).slice(0, 3);
          return (
            <div key={group.label} className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-sm font-semibold text-slate-900">{group.label}</p>
              {items.length ? (
                <ul className="mt-2 flex flex-col gap-2 text-sm leading-6 text-slate-700">
                  {items.map((item, index) => (
                    <li key={group.label + item} className="flex gap-2">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
                        {index + 1}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm leading-6 text-slate-500">证据不足</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AlertBox({ text, tone }: { text: string; tone: "error" | "notice" }) {
  const isError = tone === "error";
  return (
    <div className={`flex gap-2 rounded-[22px] border px-3 py-2 text-sm ${isError ? "border-red-200 bg-red-50 text-red-700" : "border-teal-200 bg-teal-50 text-teal-800"}`}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  error,
  required,
  limit,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  limit?: number;
  type?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-slate-700">{label}{required ? <span className="text-red-500"> *</span> : null}</span>
        {limit ? <span className="text-xs text-slate-400">{getTextLength(value)}/{limit}</span> : null}
      </div>
      <input
        type={type}
        autoComplete={type === "password" ? "current-password" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={"premium-input h-12 w-full rounded-[22px] px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 " + (error ? "border-red-300 focus:border-red-400" : "")}
      />
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </label>
  );
}

function SelectInput({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="premium-input h-12 w-full rounded-[22px] px-4 text-sm text-slate-900 outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function TextareaInput({
  label,
  value,
  onChange,
  placeholder,
  error,
  required,
  limit,
  rows = 5,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  limit?: number;
  rows?: number;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-slate-700">{label}{required ? <span className="text-red-500"> *</span> : null}</span>
        {limit ? <span className="text-xs text-slate-400">{getTextLength(value)}/{limit}</span> : null}
      </div>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={"premium-input w-full rounded-[24px] px-4 py-3 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 " + (error ? "border-red-300 focus:border-red-400" : "")}
      />
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </label>
  );
}

function CheckboxGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-bold text-slate-700">{label}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label
              key={option.value}
              className={"flex cursor-pointer items-center gap-2 rounded-[22px] border px-3 py-2 text-sm transition duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] " + (checked ? "border-teal-300 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-700 hover:border-teal-200 hover:bg-teal-50/50")}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(option.value)}
                className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function EvidenceCardEditor({
  card,
  index,
  role,
  isValid,
  onChange,
  onRemove,
  onRoleChange,
}: {
  card: EvidenceCard;
  index: number;
  role: EvidenceRole;
  isValid: boolean;
  onChange: (updates: Partial<EvidenceCard>) => void;
  onRemove: () => void;
  onRoleChange: (role: EvidenceRole) => void;
}) {
  return (
    <article className="surface-card-soft p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-teal-700">证据卡片 {index + 1}</p>
            <span className={"rounded-full px-2 py-0.5 text-xs font-bold " + (isValid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
              {isValid ? "有效证据" : "待补充证据卡片"}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{card.message}</p>
        </div>
        <button type="button" onClick={onRemove} className="text-slate-400 hover:text-red-600" title="删除证据卡片">
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onRoleChange("primary")}
          className={"h-11 rounded-full px-3 text-sm font-semibold " + (role === "primary" ? "linear-nav-active" : "linear-button")}
        >
          主商品
        </button>
        <button
          type="button"
          onClick={() => onRoleChange("supporting")}
          className={"h-11 rounded-full px-3 text-sm font-semibold " + (role === "supporting" ? "linear-nav-active" : "linear-button")}
        >
          辅助证据
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <TextInput label="商品名" value={card.productName || ""} onChange={(value) => onChange({ productName: value, normalizedProductName: value })} placeholder="例如：厨房缝隙清洁刷" />
        <SelectInput
          label="平台"
          value={card.platform}
          onChange={(value) => onChange({ platform: value as EvidenceCard["platform"] })}
          options={[{ value: "unknown", label: "未知" }, ...platformOptions.map((platform) => ({ value: platform, label: platformLabels[platform] }))]}
        />
        <TextInput label="价格" value={card.priceText || ""} onChange={(value) => onChange({ priceText: value })} placeholder="例如：9.9" />
        <TextInput label="热度" value={card.salesText || card.ratingText || card.rankText || ""} onChange={(value) => onChange({ salesText: value, ratingText: "", rankText: "" })} placeholder="例如：评价10万+、榜单靠前" />
      </div>
      <div className="mt-3">
        <TextareaInput label="备注" value={card.userNotes || card.visibleDescription || ""} onChange={(value) => onChange({ userNotes: value, visibleDescription: value })} rows={3} />
      </div>
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="surface-card-soft p-6 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

