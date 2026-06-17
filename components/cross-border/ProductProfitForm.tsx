"use client";

import { useEffect, useMemo, useState } from "react";
import { AiAnalysisPreview } from "@/components/cross-border/AiAnalysisPreview";
import { KeywordPreview } from "@/components/cross-border/KeywordPreview";
import { ListingCopyPreview } from "@/components/cross-border/ListingCopyPreview";
import { ListingPreviewCard } from "@/components/cross-border/ListingPreviewCard";
import {
  deleteDatabaseListingCopyHistory,
  fetchListingCopyHistory,
  saveListingCopyHistory,
} from "@/components/cross-border/listingCopyHistoryApi";
import {
  createListingCopyHistoryItem,
  deleteListingCopyHistoryItem,
  prependListingCopyHistoryItem,
  readCachedListingCopy,
  readCachedListingCopyHistory,
  removeCachedListingCopy,
  type ListingCopyHistoryItem,
  writeCachedListingCopy,
  writeCachedListingCopyHistory,
} from "@/components/cross-border/listingCopyStorage";
import { calculateProfit, getProfitLevel, normalizeNumber } from "@/lib/profit";
import type {
  AiAnalysisResult,
  CrossBorderProductFormInput,
  CrossBorderProductInput,
  CurrencyCode,
  KeywordGenerationResult,
  ListingCopyResult,
  ProfitCalculationInput,
  ProfitCalculationResult,
  ProfitLevel,
  StructuredListingData,
  TargetPlatform,
} from "@/lib/types";

type ProductProfitFormInput = CrossBorderProductFormInput & {
  manualSellingPrice: string;
};

const platformOptions: Array<{ value: TargetPlatform; label: string }> = [
  { value: "amazon", label: "Amazon" },
  { value: "ebay", label: "eBay" },
  { value: "etsy", label: "Etsy" },
  { value: "shopify", label: "Shopify" },
  { value: "tiktok_shop", label: "TikTok Shop" },
  { value: "shopee", label: "Shopee" },
  { value: "lazada", label: "Lazada" },
  { value: "temu", label: "Temu" },
  { value: "other", label: "其他平台" },
];

const currencyOptions: CurrencyCode[] = ["USD", "EUR", "GBP", "JPY", "CNY"];

const initialForm: ProductProfitFormInput = {
  name: "",
  description: "",
  purchasePrice: "",
  domesticShippingFee: "",
  internationalShippingFee: "",
  otherCost: "",
  commissionRate: "15",
  expectedProfitRate: "30",
  manualSellingPrice: "",
  weight: "",
  packageLength: "",
  packageWidth: "",
  packageHeight: "",
  targetCountry: "",
  targetPlatform: "shopify",
  currency: "USD",
  stock: "100",
  imagePaths: [],
};

const profitLevelLabels: Record<ProfitLevel, string> = {
  loss: "亏损",
  low: "低利润",
  medium: "中等利润",
  high: "高利润",
};

const profitLevelClasses: Record<ProfitLevel, string> = {
  loss: "border-red-200 bg-red-50 text-red-700",
  low: "border-amber-200 bg-amber-50 text-amber-700",
  medium: "border-blue-200 bg-blue-50 text-blue-700",
  high: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

function percentToRate(value: string) {
  return normalizeNumber(value) / 100;
}

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatMoney(value: number, currency: CurrencyCode) {
  return `${currency} ${formatNumber(value)}`;
}

function formatPercent(value: number) {
  return `${formatNumber(value * 100)}%`;
}

function updateTextField<K extends keyof ProductProfitFormInput>(
  setter: React.Dispatch<React.SetStateAction<ProductProfitFormInput>>,
  field: K,
  value: ProductProfitFormInput[K],
) {
  setter((current) => ({ ...current, [field]: value }));
}

function makeTemporarySku() {
  return `CB-${Date.now().toString().slice(-6)}`;
}

function positiveNumberOrUndefined(value: string) {
  const normalized = normalizeNumber(value);
  return normalized > 0 ? normalized : undefined;
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalPercentRate(value: string) {
  const normalized = optionalNumber(value);
  return normalized === undefined ? undefined : normalized / 100;
}

function buildProductPayload(form: ProductProfitFormInput, sku: string): CrossBorderProductInput {
  return {
    sku,
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    purchasePrice: optionalNumber(form.purchasePrice),
    domesticShippingFee: optionalNumber(form.domesticShippingFee),
    internationalShippingFee: optionalNumber(form.internationalShippingFee),
    otherCost: optionalNumber(form.otherCost),
    commissionRate: optionalPercentRate(form.commissionRate),
    expectedProfitRate: optionalPercentRate(form.expectedProfitRate),
    weight: optionalNumber(form.weight),
    packageLength: optionalNumber(form.packageLength),
    packageWidth: optionalNumber(form.packageWidth),
    packageHeight: optionalNumber(form.packageHeight),
    targetCountry: form.targetCountry.trim() || undefined,
    targetPlatform: form.targetPlatform,
    currency: form.currency,
    stock: optionalNumber(form.stock),
    imagePaths: form.imagePaths,
    status: "draft",
  };
}

function buildListingPreview(
  form: ProductProfitFormInput,
  profitResult: ProfitCalculationResult,
  sku: string,
): StructuredListingData {
  return {
    sku,
    title: form.name.trim() || "未填写商品名称",
    price: profitResult.suggestedPrice,
    stock: Math.max(0, Math.trunc(normalizeNumber(form.stock))),
    targetPlatform: form.targetPlatform,
    targetCountry: form.targetCountry.trim() || "未填写目标国家",
    categorySuggestion: "待 AI 分析后补充",
    attributes: {
      currency: form.currency,
      productDescription: form.description.trim() || "未填写商品描述",
      purchasePrice: String(normalizeNumber(form.purchasePrice)),
      domesticShippingFee: String(normalizeNumber(form.domesticShippingFee)),
      internationalShippingFee: String(normalizeNumber(form.internationalShippingFee)),
      otherCost: String(normalizeNumber(form.otherCost)),
      commissionRate: String(profitResult.commissionRate),
      grossMargin: String(profitResult.grossMargin),
      roi: String(profitResult.roi),
    },
    keywords: [],
    bulletPoints: [],
    description: form.description.trim() || "未填写商品描述",
    weight: positiveNumberOrUndefined(form.weight),
    dimensions: {
      length: positiveNumberOrUndefined(form.packageLength),
      width: positiveNumberOrUndefined(form.packageWidth),
      height: positiveNumberOrUndefined(form.packageHeight),
    },
    imagePaths: form.imagePaths,
    riskNotes: profitResult.warnings,
    confirmStatus: "pending",
  };
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  helper,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  helper?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-800">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        step={type === "number" ? "0.01" : undefined}
        className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
      />
      {helper ? <p className="mt-1.5 text-xs leading-5 text-slate-500">{helper}</p> : null}
    </label>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-right text-sm font-semibold text-slate-950">{value}</span>
    </div>
  );
}

type AiAnalysisApiResponse =
  | { ok: true; data: AiAnalysisResult }
  | { ok: false; error?: { code?: string; message?: string } };

type KeywordsApiResponse =
  | { ok: true; data: KeywordGenerationResult }
  | { ok: false; error?: { code?: string; message?: string } };

type ListingCopyApiResponse =
  | { ok: true; data: ListingCopyResult }
  | { ok: false; error?: { code?: string; message?: string } };

type ListingCopyHistorySource = "database" | "local";

type ApiErrorPayload = {
  code?: string;
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAiAnalysisApiResponse(value: unknown): value is AiAnalysisApiResponse {
  return isRecord(value) && typeof value.ok === "boolean";
}

function isKeywordsApiResponse(value: unknown): value is KeywordsApiResponse {
  return isRecord(value) && typeof value.ok === "boolean";
}

function isListingCopyApiResponse(value: unknown): value is ListingCopyApiResponse {
  return isRecord(value) && typeof value.ok === "boolean";
}

function getFriendlyAiErrorMessage(error: ApiErrorPayload | undefined, fallback: string) {
  switch (error?.code) {
    case "missing_api_key":
      return "服务端 AI Key 未配置，请检查环境变量。";
    case "missing_model":
      return "服务端 AI_MODEL / DEEPSEEK_MODEL 未配置。";
    case "missing_base_url":
      return "服务端 AI_BASE_URL / DEEPSEEK_BASE_URL 未配置。";
    case "timeout":
      return "AI 请求超时，请稍后重试。";
    case "network_error":
      return "AI 服务网络连接失败，请检查服务器网络或 Base URL。";
    case "invalid_api_key":
      return "AI Key 无效或权限不足，请检查服务端环境变量。";
    case "insufficient_balance":
      return "AI 服务余额不足或额度不可用，请检查服务商账户。";
    case "invalid_model":
      return "AI 模型名无效或当前 Key 无权使用，请检查 AI_MODEL / DEEPSEEK_MODEL。";
    case "invalid_parameters":
      return "AI 请求参数不被服务商接受，请检查模型兼容性和请求格式。";
    case "rate_limited":
      return "AI 请求过于频繁或触发限流，请稍后重试。";
    case "provider_unavailable":
      return "AI 服务商暂时不可用，请稍后重试。";
    case "provider_error":
      return "AI 服务返回错误，请检查模型名、余额、权限或服务商状态。";
    case "json_parse_error":
      return "AI 返回格式异常，请稍后重试。";
    case "empty_response":
      return "AI 返回为空，请稍后重试。";
    case "unknown_error":
      return "AI 服务出现未知错误，请检查服务端 AI 配置或稍后重试。";
    default:
      return error?.message?.trim() || fallback;
  }
}

export function ProductProfitForm() {
  const [form, setForm] = useState<ProductProfitFormInput>(initialForm);
  const [temporarySku, setTemporarySku] = useState("CB-TEMP");
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisResult | null>(null);
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false);
  const [aiAnalysisError, setAiAnalysisError] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<KeywordGenerationResult | null>(null);
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [keywordsError, setKeywordsError] = useState<string | null>(null);
  const [listingCopy, setListingCopy] = useState<ListingCopyResult | null>(null);
  const [listingCopyLoading, setListingCopyLoading] = useState(false);
  const [listingCopyError, setListingCopyError] = useState<string | null>(null);
  const [listingCopyNotice, setListingCopyNotice] = useState<string | null>(null);
  const [databaseListingCopyHistoryItems, setDatabaseListingCopyHistoryItems] = useState<ListingCopyHistoryItem[]>([]);
  const [localListingCopyHistoryItems, setLocalListingCopyHistoryItems] = useState<ListingCopyHistoryItem[]>([]);
  const [listingCopyHistorySource, setListingCopyHistorySource] = useState<ListingCopyHistorySource>("local");
  const [listingCopyHistoryLoading, setListingCopyHistoryLoading] = useState(false);
  const [listingCopyHistoryMessage, setListingCopyHistoryMessage] = useState<string | null>(null);
  const [activeAiTab, setActiveAiTab] = useState<"analysis" | "keywords" | "listing">("analysis");
  const [savingToTasks, setSavingToTasks] = useState(false);
  const [tasksSaveMessage, setTasksSaveMessage] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const profitInput = useMemo<ProfitCalculationInput>(() => ({
    purchasePrice: form.purchasePrice,
    domesticShippingFee: form.domesticShippingFee,
    internationalShippingFee: form.internationalShippingFee,
    otherCost: form.otherCost,
    commissionRate: percentToRate(form.commissionRate),
    expectedProfitRate: percentToRate(form.expectedProfitRate),
    manualSellingPrice: form.manualSellingPrice.trim() ? form.manualSellingPrice : undefined,
    currency: form.currency,
  }), [form]);

  const profitResult = useMemo(() => calculateProfit(profitInput), [profitInput]);
  const profitLevel = getProfitLevel(profitResult);
  const listingPreview = useMemo(
    () => buildListingPreview(form, profitResult, temporarySku),
    [form, profitResult, temporarySku],
  );
  const listingCopyHistoryItems = listingCopyHistorySource === "database"
    ? databaseListingCopyHistoryItems
    : localListingCopyHistoryItems;

  useEffect(() => {
    setTemporarySku(makeTemporarySku());
  }, []);

  useEffect(() => {
    const cachedListingCopy = readCachedListingCopy();
    if (!cachedListingCopy) return;

    setListingCopy(cachedListingCopy);
    setListingCopyNotice("已恢复上次本地文案");
  }, []);

  useEffect(() => {
    let active = true;
    const localItems = readCachedListingCopyHistory();
    setLocalListingCopyHistoryItems(localItems);
    setListingCopyHistoryLoading(true);

    async function loadDatabaseHistory() {
      const result = await fetchListingCopyHistory(10);
      if (!active) return;

      if (result.ok) {
        setDatabaseListingCopyHistoryItems(result.data);
        setListingCopyHistorySource("database");
        setListingCopyHistoryMessage(null);
      } else {
        setListingCopyHistorySource("local");
        setListingCopyHistoryMessage(result.message);
      }

      setListingCopyHistoryLoading(false);
    }

    loadDatabaseHistory();

    return () => {
      active = false;
    };
  }, []);

  async function handleGenerateAiAnalysis() {
    if (aiAnalysisLoading) return;

    if (!form.name.trim()) {
      setAiAnalysisError("请先填写商品名称。");
      return;
    }

    setAiAnalysisError(null);
    setAiAnalysisLoading(true);

    try {
      const response = await fetch("/api/products/ai-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product: buildProductPayload(form, temporarySku),
          profit: profitResult,
          listingPreview,
        }),
      });

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        setAiAnalysisError("服务端返回格式异常。");
        return;
      }

      if (!isAiAnalysisApiResponse(payload)) {
        setAiAnalysisError("服务端返回格式异常。");
        return;
      }

      if (payload.ok) {
        setAiAnalysis(payload.data);
        return;
      }

      if (response.status >= 500) {
        setAiAnalysisError(getFriendlyAiErrorMessage(
          payload.error,
          "AI 分析失败，请检查服务端 AI 配置或稍后重试。",
        ));
        return;
      }

      setAiAnalysisError(getFriendlyAiErrorMessage(payload.error, "AI 分析失败，请稍后重试。"));
    } catch {
      setAiAnalysisError("网络异常，请检查本地服务或网络。");
    } finally {
      setAiAnalysisLoading(false);
    }
  }

  async function handleGenerateKeywords() {
    if (keywordsLoading) return;

    if (!form.name.trim()) {
      setKeywordsError("请先填写商品名称。");
      return;
    }

    setKeywordsError(null);
    setKeywordsLoading(true);

    try {
      const response = await fetch("/api/products/keywords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product: buildProductPayload(form, temporarySku),
          profit: profitResult,
          listingPreview,
          ...(aiAnalysis ? { aiAnalysis } : {}),
        }),
      });

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        setKeywordsError("服务端返回格式异常。");
        return;
      }

      if (!isKeywordsApiResponse(payload)) {
        setKeywordsError("服务端返回格式异常。");
        return;
      }

      if (payload.ok) {
        setKeywords(payload.data);
        return;
      }

      if (response.status >= 500) {
        setKeywordsError(getFriendlyAiErrorMessage(
          payload.error,
          "关键词生成失败，请检查服务端 AI 配置或稍后重试。",
        ));
        return;
      }

      setKeywordsError(getFriendlyAiErrorMessage(payload.error, "关键词生成失败，请稍后重试。"));
    } catch {
      setKeywordsError("网络异常，请检查本地服务或网络。");
    } finally {
      setKeywordsLoading(false);
    }
  }

  async function handleGenerateListingCopy() {
    if (listingCopyLoading) return;

    setListingCopyError(null);
    setListingCopyNotice(null);
    setListingCopyLoading(true);

    try {
      const productPayload = buildProductPayload(form, temporarySku);
      const response = await fetch("/api/products/listing-copy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product: productPayload,
          profit: profitResult,
          listingPreview,
          ...(aiAnalysis ? { aiAnalysis } : {}),
          ...(keywords ? { keywords } : {}),
        }),
      });

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        setListingCopyError("服务端返回格式异常。");
        return;
      }

      if (!isListingCopyApiResponse(payload)) {
        setListingCopyError("服务端返回格式异常。");
        return;
      }

      if (payload.ok) {
        setListingCopy(payload.data);
        writeCachedListingCopy(payload.data);
        const historyItem = createListingCopyHistoryItem(form.name, payload.data);
        setLocalListingCopyHistoryItems((currentItems) => {
          const nextItems = prependListingCopyHistoryItem(currentItems, historyItem);
          writeCachedListingCopyHistory(nextItems);
          return nextItems;
        });

        const saveResult = await saveListingCopyHistory({
          productId: productPayload.id,
          productName: productPayload.name || "未命名商品",
          data: payload.data,
          sourceInput: {
            product: productPayload,
            profit: profitResult,
            listingPreview,
            ...(aiAnalysis ? { aiAnalysis } : {}),
            ...(keywords ? { keywords } : {}),
          },
        });

        if (saveResult.ok) {
          setDatabaseListingCopyHistoryItems((currentItems) => [saveResult.data, ...currentItems]
            .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
            .slice(0, 10));
          setListingCopyHistorySource("database");
          setListingCopyHistoryMessage(null);
          setListingCopyNotice("已保存到数据库历史");
        } else {
          setListingCopyHistorySource("local");
          setListingCopyHistoryMessage(saveResult.message);
          setListingCopyNotice("数据库保存失败，已保存在本地。");
        }

        return;
      }

      setListingCopyError(payload.error?.message?.trim() || "英文上架文案生成失败，请稍后重试。");
    } catch {
      setListingCopyError("网络异常，请检查本地服务或网络。");
    } finally {
      setListingCopyLoading(false);
    }
  }

  const profitReportText = useMemo(() => {
    const p = profitResult;
    const lines = [
      `# 商品利润测算报告`,
      "",
      `商品名称：${form.name.trim() || "未填写"}`,
      `目标平台：${form.targetPlatform}`,
      `币种：${p.currency}`,
      "",
      `## 利润测算`,
      `- 建议售价：${formatMoney(p.suggestedPrice, p.currency)}`,
      `- 保本价：${formatMoney(p.breakEvenPrice, p.currency)}`,
      `- 基础成本：${formatMoney(p.baseCost, p.currency)}`,
      `- 总固定成本：${formatMoney(p.totalFixedCost, p.currency)}`,
      `- 平台佣金：${formatMoney(p.commissionAmount, p.currency)}（${formatPercent(p.commissionRate)}）`,
      `- 毛利润：${formatMoney(p.grossProfit, p.currency)}`,
      `- 毛利率：${formatPercent(p.grossMargin)}`,
      `- ROI：${formatPercent(p.roi)}`,
      "",
      `## 风险提示`,
      ...(p.warnings.length ? p.warnings.map((w) => `- ${w}`) : ["- 当前没有明显公式风险"]),
      "",
    ];
    if (aiAnalysis) {
      lines.push("## AI 选品分析");
      lines.push(`- 推荐结论：${aiAnalysis.recommendation}`);
      lines.push(`- 综合评分：${aiAnalysis.score}/100`);
      if (aiAnalysis.reasons.length) { lines.push(`- 推荐理由：${aiAnalysis.reasons.join("；")}`); }
      if (aiAnalysis.risks.length) { lines.push(`- AI 风险点：${aiAnalysis.risks.join("；")}`); }
      lines.push(`- 平台适配度：${aiAnalysis.platformFit}`);
      lines.push(`- 是否适合新手：${aiAnalysis.newbieFriendly ? "是" : "否"}`);
      lines.push("");
    }
    lines.push("---");
    lines.push("> 报告由轻选 Agent 自动生成，仅供运营参考。");
    return lines.join("\n");
  }, [form, profitResult, aiAnalysis]);

  async function handleCopyReport() {
    try {
      await navigator.clipboard.writeText(profitReportText);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("failed");
    }
  }

  function handleExportMarkdown() {
    const fileName = (form.name.trim().slice(0, 40) || "利润测算报告").replace(/[\\/:*?"<>|]+/g, "-") + ".md";
    const blob = new Blob([profitReportText], { type: "text/markdown;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function handleSaveToTaskCenter() {
    if (savingToTasks) return;
    setSavingToTasks(true);
    setTasksSaveMessage(null);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "product",
          title: form.name.trim() || "未命名商品",
          platform: form.targetPlatform || "manual",
          source: "ai",
          materialText: form.description.trim() || form.name.trim(),
          result: {
            oneLineSummary: profitLevelLabels[profitLevel],
            level: profitLevel,
            score: Math.round(profitResult.grossMargin * 100),
            suggestedPrice: profitResult.suggestedPrice,
            breakEvenPrice: profitResult.breakEvenPrice,
            grossProfit: profitResult.grossProfit,
            grossMargin: profitResult.grossMargin,
            roi: profitResult.roi,
            baseCost: profitResult.baseCost,
            aiAnalysis: aiAnalysis ? {
              recommendation: aiAnalysis.recommendation,
              score: aiAnalysis.score,
              reasons: aiAnalysis.reasons,
              risks: aiAnalysis.risks,
            } : null,
          },
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: { code?: string; message?: string } };
      if (!response.ok || !data.ok) {
        setTasksSaveMessage(data.error?.message || "保存到任务中心失败。");
        return;
      }
      setTasksSaveMessage("已保存到任务中心");
    } catch {
      setTasksSaveMessage("网络异常，保存失败。");
    } finally {
      setSavingToTasks(false);
    }
  }

  function handleClearListingCopy() {
    removeCachedListingCopy();
    setListingCopy(null);
    setListingCopyError(null);
    setListingCopyNotice("本地文案已清除");
  }

  function handleRestoreListingCopyHistory(item: ListingCopyHistoryItem) {
    setListingCopy(item.data);
    setListingCopyError(null);
    setListingCopyNotice("已恢复历史文案");
    writeCachedListingCopy(item.data);
  }

  async function handleDeleteListingCopyHistory(item: ListingCopyHistoryItem) {
    if (item.source === "database") {
      const result = await deleteDatabaseListingCopyHistory(item.id);
      if (!result.ok) {
        setListingCopyError(result.message);
        return;
      }

      setDatabaseListingCopyHistoryItems((currentItems) => deleteListingCopyHistoryItem(currentItems, item.id));
      setListingCopyError(null);
      setListingCopyNotice("数据库历史记录已删除");
      return;
    }

    setLocalListingCopyHistoryItems((currentItems) => {
      const nextItems = deleteListingCopyHistoryItem(currentItems, item.id);
      writeCachedListingCopyHistory(nextItems);
      return nextItems;
    });
    setListingCopyError(null);
    setListingCopyNotice("本地历史记录已删除");
  }

  return (
    <div className="space-y-6">
      {/* ===== Layer 1: Two-column layout ===== */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
      <section className="surface-card rounded-[28px] p-5">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-slate-950">商品输入表单</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            先填基础成本和平台参数。空值会按 0 处理，不会保存到服务器。
          </p>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-bold text-slate-900">商品基础信息</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                label="商品名称"
                value={form.name}
                onChange={(value) => updateTextField(setForm, "name", value)}
                placeholder="例如：便携式桌面收纳盒"
              />
              <TextInput
                label="目标国家"
                value={form.targetCountry}
                onChange={(value) => updateTextField(setForm, "targetCountry", value)}
                placeholder="例如：United States"
              />
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">目标平台</span>
                <select
                  value={form.targetPlatform}
                  onChange={(event) => updateTextField(setForm, "targetPlatform", event.target.value as TargetPlatform)}
                  className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                >
                  {platformOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">币种</span>
                <select
                  value={form.currency}
                  onChange={(event) => updateTextField(setForm, "currency", event.target.value as CurrencyCode)}
                  className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                >
                  {currencyOptions.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-2 block text-sm font-semibold text-slate-800">商品描述</span>
                <textarea
                  value={form.description}
                  onChange={(event) => updateTextField(setForm, "description", event.target.value)}
                  rows={4}
                  placeholder="简单写商品用途、材质、卖点，后续接 AI 时会用到。"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-bold text-slate-900">成本信息</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="采购价" type="number" value={form.purchasePrice} onChange={(value) => updateTextField(setForm, "purchasePrice", value)} />
              <TextInput label="国内运费" type="number" value={form.domesticShippingFee} onChange={(value) => updateTextField(setForm, "domesticShippingFee", value)} />
              <TextInput label="国际物流费" type="number" value={form.internationalShippingFee} onChange={(value) => updateTextField(setForm, "internationalShippingFee", value)} />
              <TextInput label="其他成本" type="number" value={form.otherCost} onChange={(value) => updateTextField(setForm, "otherCost", value)} placeholder="包装、损耗、预留成本" />
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-bold text-slate-900">平台和利润设置</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                label="平台佣金率"
                type="number"
                value={form.commissionRate}
                onChange={(value) => updateTextField(setForm, "commissionRate", value)}
                helper="填写百分比，15 表示 15%。"
              />
              <TextInput
                label="预期利润率"
                type="number"
                value={form.expectedProfitRate}
                onChange={(value) => updateTextField(setForm, "expectedProfitRate", value)}
                helper="填写百分比，30 表示 30%。"
              />
              <TextInput
                label="手动售价"
                type="number"
                value={form.manualSellingPrice}
                onChange={(value) => updateTextField(setForm, "manualSellingPrice", value)}
                helper="不填时，系统按预期利润率自动算建议售价。"
              />
              <TextInput label="库存" type="number" value={form.stock} onChange={(value) => updateTextField(setForm, "stock", value)} />
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-bold text-slate-900">尺寸重量信息</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <TextInput label="商品重量" type="number" value={form.weight} onChange={(value) => updateTextField(setForm, "weight", value)} placeholder="kg 或 g，先按你习惯填写" />
              <TextInput label="包装长" type="number" value={form.packageLength} onChange={(value) => updateTextField(setForm, "packageLength", value)} />
              <TextInput label="包装宽" type="number" value={form.packageWidth} onChange={(value) => updateTextField(setForm, "packageWidth", value)} />
              <TextInput label="包装高" type="number" value={form.packageHeight} onChange={(value) => updateTextField(setForm, "packageHeight", value)} />
            </div>
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="surface-card rounded-[28px] p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-950">利润测算结果</h2>
              <p className="mt-1 text-sm text-slate-500">实时按程序公式计算，不依赖 AI。</p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-sm font-bold ${profitLevelClasses[profitLevel]}`}>
              {profitLevelLabels[profitLevel]}
            </span>
          </div>

          <div className="rounded-[22px] bg-slate-950/90 backdrop-blur-md p-4 text-white">
            <p className="text-sm text-slate-300">建议售价</p>
            <p className="mt-1 text-3xl font-bold">{formatMoney(profitResult.suggestedPrice, profitResult.currency)}</p>
            <p className="mt-2 text-xs text-slate-400">手动售价为空时，按预期利润率自动推算。</p>
          </div>

          <div className="mt-4 divide-y divide-slate-100">
            <ResultRow label="基础成本" value={formatMoney(profitResult.baseCost, profitResult.currency)} />
            <ResultRow label="总固定成本" value={formatMoney(profitResult.totalFixedCost, profitResult.currency)} />
            <ResultRow label="平台佣金率" value={formatPercent(profitResult.commissionRate)} />
            <ResultRow label="保本价" value={formatMoney(profitResult.breakEvenPrice, profitResult.currency)} />
            <ResultRow label="平台佣金金额" value={formatMoney(profitResult.commissionAmount, profitResult.currency)} />
            <ResultRow label="毛利润" value={formatMoney(profitResult.grossProfit, profitResult.currency)} />
            <ResultRow label="毛利率" value={formatPercent(profitResult.grossMargin)} />
            <ResultRow label="ROI" value={formatPercent(profitResult.roi)} />
          </div>
        </section>

        <section className="surface-card rounded-[28px] border-amber-200 bg-amber-50 p-5">
          <h3 className="text-sm font-bold text-amber-900">风险提示</h3>
          {profitResult.warnings.length ? (
            <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-800">
              {profitResult.warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm leading-6 text-amber-800">当前没有明显公式风险。后续仍需人工确认平台规则、物流、售后和侵权风险。</p>
          )}
        </section>

        <section className="surface-card rounded-[28px] p-5">
          <h3 className="text-sm font-bold text-slate-950">人工确认状态</h3>
          <p className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
            待人工确认
          </p>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            当前只是预览，不会保存、不调用 AI、不自动上架。请人工复核利润、风险和上架资料。
          </p>
        </section>
      </aside>
    </div>

    {/* ===== Layer 2: Full-width 上架资料预览 ===== */}
    <ListingPreviewCard
      form={form}
      listingData={listingPreview}
      profitResult={profitResult}
    />

    {/* ===== Layer 3: Full-width AI 辅助分析与生成 Tabs ===== */}
    <section className="surface-card rounded-[28px] p-5">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-slate-950">AI 辅助分析与生成</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          使用 AI 辅助选品分析、关键词生成和英文文案撰写。结果仅供运营参考，不等于平台最终规则。
        </p>
      </div>

      {/* Tab bar */}
      <div className="mb-5 flex gap-1 border-b border-slate-200" role="tablist">
        {(
          [
            { key: "analysis" as const, label: "AI 选品分析" },
            { key: "keywords" as const, label: "关键词生成" },
            { key: "listing" as const, label: "英文上架文案" },
          ]
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeAiTab === tab.key}
            onClick={() => setActiveAiTab(tab.key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
              activeAiTab === tab.key
                ? "border-teal-500 text-teal-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels — all mounted, hidden when inactive to preserve state */}
      <div className={activeAiTab === "analysis" ? "" : "hidden"}>
        <AiAnalysisPreview
          form={form}
          listingData={listingPreview}
          analysis={aiAnalysis}
          loading={aiAnalysisLoading}
          error={aiAnalysisError}
          onGenerate={handleGenerateAiAnalysis}
        />
      </div>
      <div className={activeAiTab === "keywords" ? "" : "hidden"}>
        <KeywordPreview
          form={form}
          listingData={listingPreview}
          keywords={keywords}
          loading={keywordsLoading}
          error={keywordsError}
          onGenerate={handleGenerateKeywords}
        />
      </div>
      <div className={activeAiTab === "listing" ? "" : "hidden"}>
        <ListingCopyPreview
          form={form}
          listingData={listingPreview}
          copyResult={listingCopy}
          loading={listingCopyLoading}
          error={listingCopyError}
          notice={listingCopyNotice}
          historyItems={listingCopyHistoryItems}
          historySource={listingCopyHistorySource}
          historyLoading={listingCopyHistoryLoading}
          historyMessage={listingCopyHistoryMessage}
          onGenerate={handleGenerateListingCopy}
          onClear={handleClearListingCopy}
          onRestoreHistory={handleRestoreListingCopyHistory}
          onDeleteHistory={handleDeleteListingCopyHistory}
        />
      </div>
    </section>

    {/* ===== Layer 4: Full-width 人工确认下一步 ===== */}
    <section className="surface-card rounded-[28px] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-950">人工确认下一步</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            请人工复核以上所有信息（利润测算、风险提示、上架资料预览、AI 分析结果）。
            确认无误后，可继续后续上架流程。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleCopyReport}
            className="glass-button-primary inline-flex h-11 items-center justify-center gap-2 px-4 text-sm font-semibold"
          >
            {copyState === "copied" ? "已复制" : "复制报告"}
          </button>
          <button
            type="button"
            onClick={handleExportMarkdown}
            className="glass-button-primary inline-flex h-11 items-center justify-center gap-2 px-4 text-sm font-semibold"
          >
            导出 Markdown
          </button>
          <button
            type="button"
            onClick={handleSaveToTaskCenter}
            disabled={savingToTasks}
            className="glass-button-primary inline-flex h-11 items-center justify-center gap-2 px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingToTasks ? "保存中" : "保存到任务中心"}
          </button>
          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
            待人工确认
          </span>
        </div>
      </div>
      {copyState === "failed" ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">复制失败，请手动选择文本复制。</p>
      ) : null}
      {tasksSaveMessage ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">{tasksSaveMessage}</p>
      ) : null}
    </section>
    </div>
  );
}
