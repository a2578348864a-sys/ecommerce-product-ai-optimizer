"use client";

import { type ReactNode, useMemo, useState } from "react";
import { normalizeNumber } from "@/lib/profit";
import type {
  CrossBorderProductFormInput,
  CurrencyCode,
  ProfitCalculationResult,
  StructuredListingData,
  TargetPlatform,
} from "@/lib/types";

const platformLabels: Record<TargetPlatform, string> = {
  amazon: "Amazon",
  ebay: "eBay",
  etsy: "Etsy",
  shopify: "Shopify",
  tiktok_shop: "TikTok Shop",
  shopee: "Shopee",
  lazada: "Lazada",
  temu: "Temu",
  other: "其他平台",
};

const noFormulaRiskText = "当前利润测算暂无明显公式风险，仍需人工检查平台规则、物流限制和侵权风险。";

type CopyStatus = "idle" | "success" | "error";

type ListingPreviewCardProps = {
  form: CrossBorderProductFormInput;
  listingData: StructuredListingData;
  profitResult: ProfitCalculationResult;
};

function safeText(value: string, fallback = "未填写") {
  const trimmed = value.trim();
  return trimmed || fallback;
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

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2.5 last:border-b-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-right text-sm font-semibold text-slate-950">{value}</span>
    </div>
  );
}

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold text-slate-950">{title}</h3>
      <div className="mt-2 divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function buildPreviewText(params: {
  form: CrossBorderProductFormInput;
  listingData: StructuredListingData;
  profitResult: ProfitCalculationResult;
}) {
  const { form, listingData, profitResult } = params;
  const riskNotes = listingData.riskNotes.length ? listingData.riskNotes : [noFormulaRiskText];
  const packageSize = [
    normalizeNumber(form.packageLength),
    normalizeNumber(form.packageWidth),
    normalizeNumber(form.packageHeight),
  ].map((value) => formatNumber(value)).join(" x ");

  return [
    "【上架资料预览】",
    `商品名称：${safeText(form.name)}`,
    `商品描述：${safeText(form.description)}`,
    `目标平台：${platformLabels[listingData.targetPlatform]}`,
    `目标国家：${safeText(listingData.targetCountry)}`,
    `币种：${profitResult.currency}`,
    `库存：${listingData.stock}`,
    `临时 SKU：${listingData.sku}`,
    "",
    "【价格信息】",
    `建议售价：${formatMoney(profitResult.suggestedPrice, profitResult.currency)}`,
    `保本价：${formatMoney(profitResult.breakEvenPrice, profitResult.currency)}`,
    `毛利润：${formatMoney(profitResult.grossProfit, profitResult.currency)}`,
    `毛利率：${formatPercent(profitResult.grossMargin)}`,
    `ROI：${formatPercent(profitResult.roi)}`,
    `平台佣金率：${formatPercent(profitResult.commissionRate)}`,
    "",
    "【成本信息】",
    `采购价：${formatMoney(normalizeNumber(form.purchasePrice), profitResult.currency)}`,
    `国内运费：${formatMoney(normalizeNumber(form.domesticShippingFee), profitResult.currency)}`,
    `国际物流费：${formatMoney(normalizeNumber(form.internationalShippingFee), profitResult.currency)}`,
    `其他成本：${formatMoney(normalizeNumber(form.otherCost), profitResult.currency)}`,
    `总成本：${formatMoney(profitResult.totalFixedCost, profitResult.currency)}`,
    "",
    "【尺寸重量】",
    `重量：${formatNumber(normalizeNumber(form.weight))}`,
    `包装尺寸：${packageSize}`,
    "",
    "【风险备注】",
    ...riskNotes.map((item) => `- ${item}`),
    "",
    "【人工确认状态】",
    "待人工确认",
  ].join("\n");
}

function copyTextWithFallback(text: string) {
  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function ListingPreviewCard({
  form,
  listingData,
  profitResult,
}: ListingPreviewCardProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  const riskNotes = listingData.riskNotes.length ? listingData.riskNotes : [noFormulaRiskText];
  const previewText = useMemo(
    () => buildPreviewText({ form, listingData, profitResult }),
    [form, listingData, profitResult],
  );

  async function handleCopy() {
    setCopyStatus("idle");

    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        const fallbackCopied = copyTextWithFallback(previewText);
        setCopyStatus(fallbackCopied ? "success" : "error");
        return;
      }

      try {
        await navigator.clipboard.writeText(previewText);
      } catch {
        const fallbackCopied = copyTextWithFallback(previewText);
        if (!fallbackCopied) {
          throw new Error("copy failed");
        }
      }

      setCopyStatus("success");
      window.setTimeout(() => setCopyStatus("idle"), 1800);
    } catch {
      setCopyStatus("error");
    }
  }

  return (
    <section className="rounded-2xl border border-teal-100 bg-teal-50/60 p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-teal-700">上架资料预览</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">结构化上架字段</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            根据当前输入和利润测算结果自动整理，仅用于人工确认和后续导出。当前不会保存数据、不会调用 AI、不会自动发布商品。
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white transition hover:bg-teal-700"
        >
          一键复制预览内容
        </button>
      </div>

      {copyStatus === "success" ? (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          已复制
        </p>
      ) : null}
      {copyStatus === "error" ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          复制失败，请手动选中预览内容复制。
        </p>
      ) : null}

      <div className="grid gap-4">
        <PreviewSection title="基础信息">
          <PreviewRow label="商品名称" value={safeText(form.name)} />
          <PreviewRow label="商品描述" value={safeText(form.description)} />
          <PreviewRow label="目标平台" value={platformLabels[listingData.targetPlatform]} />
          <PreviewRow label="目标国家" value={safeText(listingData.targetCountry)} />
          <PreviewRow label="币种" value={profitResult.currency} />
          <PreviewRow label="库存" value={String(listingData.stock)} />
        </PreviewSection>

        <PreviewSection title="SKU 信息">
          <PreviewRow label="临时 SKU" value={listingData.sku} />
          <p className="pt-2.5 text-xs leading-5 text-slate-500">
            这是页面临时生成的 SKU，后续保存或导出前可以人工修改。
          </p>
        </PreviewSection>

        <PreviewSection title="价格信息">
          <PreviewRow label="建议售价" value={formatMoney(profitResult.suggestedPrice, profitResult.currency)} />
          <PreviewRow label="保本价" value={formatMoney(profitResult.breakEvenPrice, profitResult.currency)} />
          <PreviewRow label="毛利润" value={formatMoney(profitResult.grossProfit, profitResult.currency)} />
          <PreviewRow label="毛利率" value={formatPercent(profitResult.grossMargin)} />
          <PreviewRow label="ROI" value={formatPercent(profitResult.roi)} />
          <PreviewRow label="平台佣金率" value={formatPercent(profitResult.commissionRate)} />
        </PreviewSection>

        <PreviewSection title="成本信息">
          <PreviewRow label="采购价" value={formatMoney(normalizeNumber(form.purchasePrice), profitResult.currency)} />
          <PreviewRow label="国内运费" value={formatMoney(normalizeNumber(form.domesticShippingFee), profitResult.currency)} />
          <PreviewRow label="国际物流费" value={formatMoney(normalizeNumber(form.internationalShippingFee), profitResult.currency)} />
          <PreviewRow label="其他成本" value={formatMoney(normalizeNumber(form.otherCost), profitResult.currency)} />
          <PreviewRow label="总成本" value={formatMoney(profitResult.totalFixedCost, profitResult.currency)} />
        </PreviewSection>

        <PreviewSection title="尺寸重量信息">
          <PreviewRow label="商品重量" value={formatNumber(normalizeNumber(form.weight))} />
          <PreviewRow label="包装长" value={formatNumber(normalizeNumber(form.packageLength))} />
          <PreviewRow label="包装宽" value={formatNumber(normalizeNumber(form.packageWidth))} />
          <PreviewRow label="包装高" value={formatNumber(normalizeNumber(form.packageHeight))} />
        </PreviewSection>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-bold text-amber-900">风险备注</h3>
          <ul className="mt-2 space-y-2 text-sm leading-6 text-amber-800">
            {riskNotes.map((warning) => (
              <li key={warning}>- {warning}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-950">人工确认状态</h3>
          <p className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
            待人工确认
          </p>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            当前只是预览，不会保存、不调用 AI、不自动上架。
          </p>
        </div>
      </div>
    </section>
  );
}
