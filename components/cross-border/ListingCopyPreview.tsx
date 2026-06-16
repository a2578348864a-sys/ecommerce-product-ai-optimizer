"use client";

import { useState } from "react";
import type {
  CrossBorderProductFormInput,
  ListingCopyResult,
  StructuredListingData,
} from "@/lib/types";
import type {
  ListingCopyHistoryItem,
  ListingCopyHistorySource,
} from "@/components/cross-border/listingCopyStorage";

type ListingCopyPreviewProps = {
  form: CrossBorderProductFormInput;
  listingData: StructuredListingData;
  copyResult?: ListingCopyResult | null;
  loading?: boolean;
  error?: string | null;
  notice?: string | null;
  historyItems?: ListingCopyHistoryItem[];
  historySource?: ListingCopyHistorySource;
  historyLoading?: boolean;
  historyMessage?: string | null;
  onGenerate?: () => void;
  onClear?: () => void;
  onRestoreHistory?: (item: ListingCopyHistoryItem) => void;
  onDeleteHistory?: (item: ListingCopyHistoryItem) => void;
};

type CopyStatus = {
  key: string;
  message: string;
  type: "success" | "error";
} | null;

type CopyButtonProps = {
  label?: string;
  ariaLabel?: string;
  copyKey: string;
  text: string;
  onCopy: (copyKey: string, text: string) => void;
};

function cleanText(value?: string) {
  return value?.trim() || "";
}

function cleanItems(items?: string[]) {
  return items?.map((item) => item.trim()).filter(Boolean) || [];
}

function cleanFaq(items?: ListingCopyResult["faq"]) {
  return items?.map((item) => ({
    question: cleanText(item.question),
    answer: cleanText(item.answer),
  })).filter((item) => item.question || item.answer) || [];
}

function formatNumberedList(items?: string[]) {
  const cleaned = cleanItems(items);
  return cleaned.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function formatBulletList(items?: string[]) {
  const cleaned = cleanItems(items);
  return cleaned.map((item) => `* ${item}`).join("\n");
}

function formatCommaList(items?: string[]) {
  return cleanItems(items).join(", ");
}

function formatFaq(items?: ListingCopyResult["faq"]) {
  return cleanFaq(items)
    .map((item) => [
      item.question ? `Q: ${item.question}` : "",
      item.answer ? `A: ${item.answer}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n\n");
}

function formatSection(title: string, content: string) {
  return content ? `${title}:\n${content}` : "";
}

function formatFullListingCopy(copyResult?: ListingCopyResult | null) {
  if (!copyResult) return "";

  return [
    formatSection("Title", cleanText(copyResult.title)),
    formatSection("Bullet Points", formatNumberedList(copyResult.bulletPoints)),
    formatSection("Description", cleanText(copyResult.description)),
    formatSection("Short Description", cleanText(copyResult.shortDescription)),
    formatSection("Keywords", formatCommaList(copyResult.keywords)),
    formatSection("Long Tail Keywords", formatCommaList(copyResult.longTailKeywords)),
    formatSection("FAQ", formatFaq(copyResult.faq)),
    formatSection("Packing List", formatBulletList(copyResult.packingList)),
    formatSection("After Sales", cleanText(copyResult.afterSales)),
    formatSection("Notes", formatBulletList(copyResult.notes)),
  ].filter(Boolean).join("\n\n");
}

function formatHistoryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function previewText(value: string, fallback: string) {
  const text = value.trim() || fallback;
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function copyTextWithFallback(text: string) {
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function CopyButton({
  label = "复制",
  ariaLabel,
  copyKey,
  text,
  onCopy,
}: CopyButtonProps) {
  if (!text) return null;

  return (
    <button
      type="button"
      aria-label={ariaLabel || label}
      onClick={() => onCopy(copyKey, text)}
      className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-violet-200 bg-violet-50 px-2.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
    >
      {label}
    </button>
  );
}

function EmptyText({ label }: { label: string }) {
  return (
    <div className="surface-card-soft rounded-[22px] p-3">
      <p className="text-sm font-bold text-slate-950">{label}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">暂无</p>
    </div>
  );
}

function TextBlock({
  label,
  value,
  copyKey,
  copyText,
  onCopy,
}: {
  label: string;
  value?: string;
  copyKey: string;
  copyText: string;
  onCopy: (copyKey: string, text: string) => void;
}) {
  if (!value?.trim()) {
    return <EmptyText label={label} />;
  }

  return (
    <div className="surface-card-soft rounded-[22px] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-950">{label}</p>
        <CopyButton ariaLabel={`复制${label}`} copyKey={copyKey} text={copyText} onCopy={onCopy} />
      </div>
      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{value}</p>
    </div>
  );
}

function ListBlock({
  label,
  items,
  copyKey,
  copyText,
  onCopy,
}: {
  label: string;
  items?: string[];
  copyKey: string;
  copyText: string;
  onCopy: (copyKey: string, text: string) => void;
}) {
  if (!items?.length) {
    return <EmptyText label={label} />;
  }

  return (
    <div className="surface-card-soft rounded-[22px] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-950">{label}</p>
        <CopyButton ariaLabel={`复制${label}`} copyKey={copyKey} text={copyText} onCopy={onCopy} />
      </div>
      <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}

function FaqBlock({
  items,
  copyText,
  onCopy,
}: {
  items?: ListingCopyResult["faq"];
  copyText: string;
  onCopy: (copyKey: string, text: string) => void;
}) {
  if (!items?.length) {
    return <EmptyText label="FAQ" />;
  }

  return (
    <div className="surface-card-soft rounded-[22px] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-950">FAQ</p>
        <CopyButton ariaLabel="复制FAQ" copyKey="faq" text={copyText} onCopy={onCopy} />
      </div>
      <div className="mt-2 space-y-3 text-sm leading-6 text-slate-700">
        {items.map((item, index) => (
          <div key={`${item.question}-${index}`}>
            <p className="font-semibold text-slate-900">Q: {item.question}</p>
            <p>A: {item.answer}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryList({
  items,
  source,
  loading,
  message,
  onRestore,
  onDelete,
}: {
  items: ListingCopyHistoryItem[];
  source: ListingCopyHistorySource;
  loading?: boolean;
  message?: string | null;
  onRestore?: (item: ListingCopyHistoryItem) => void;
  onDelete?: (item: ListingCopyHistoryItem) => void;
}) {
  const isDatabase = source === "database";

  return (
    <div className="mt-4 rounded-xl border border-violet-100 bg-white/80 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-950">
            {isDatabase ? "数据库历史记录" : "本地历史兜底"}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {isDatabase
              ? "优先从本地 SQLite 数据库读取，最多展示最近 10 条。"
              : "数据库不可用时继续使用当前浏览器 localStorage，最多保留最近 10 条。"}
          </p>
        </div>
        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
          {items.length}/10
        </span>
      </div>

      {loading ? (
        <p className="mb-2 rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2 text-xs leading-5 text-violet-700">
          正在读取历史记录...
        </p>
      ) : null}

      {message ? (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          {message}
        </p>
      ) : null}

      {items.length ? (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="surface-card-soft rounded-[18px] p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-slate-950">
                      {previewText(item.productName, "未命名商品")}
                    </p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      item.source === "database"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                    >
                      {item.source === "database" ? "数据库" : "本地"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{formatHistoryTime(item.savedAt)}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {previewText(item.title, "无标题")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onRestore?.(item)}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-violet-200 bg-violet-50 px-2.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete?.(item)}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-violet-100 bg-violet-50/40 px-3 py-2 text-sm leading-6 text-slate-500">
          暂无历史记录。生成英文文案成功后会自动保留最近 10 条。
        </p>
      )}
    </div>
  );
}

export function ListingCopyPreview({
  form,
  listingData,
  copyResult,
  loading = false,
  error = null,
  notice = null,
  historyItems = [],
  historySource = "local",
  historyLoading = false,
  historyMessage = null,
  onGenerate,
  onClear,
  onRestoreHistory,
  onDeleteHistory,
}: ListingCopyPreviewProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>(null);
  const hasCopyResult = Boolean(copyResult);
  const buttonText = loading
    ? "生成中..."
    : hasCopyResult
      ? "重新生成英文文案"
      : "生成英文文案";
  const fullCopyText = formatFullListingCopy(copyResult);
  const titleCopyText = cleanText(copyResult?.title);
  const bulletPointsCopyText = formatNumberedList(copyResult?.bulletPoints);
  const descriptionCopyText = cleanText(copyResult?.description);
  const shortDescriptionCopyText = cleanText(copyResult?.shortDescription);
  const keywordsCopyText = formatCommaList(copyResult?.keywords);
  const longTailKeywordsCopyText = formatCommaList(copyResult?.longTailKeywords);
  const faqCopyText = formatFaq(copyResult?.faq);
  const packingListCopyText = formatBulletList(copyResult?.packingList);
  const afterSalesCopyText = cleanText(copyResult?.afterSales);
  const notesCopyText = formatBulletList(copyResult?.notes);

  async function handleCopy(copyKey: string, text: string) {
    if (!text.trim()) {
      setCopyStatus({ key: copyKey, message: "暂无可复制内容", type: "error" });
      return;
    }

    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      const fallbackCopied = copyTextWithFallback(text);
      setCopyStatus({
        key: copyKey,
        message: fallbackCopied ? "已复制" : "复制失败，请手动复制",
        type: fallbackCopied ? "success" : "error",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus({ key: copyKey, message: "已复制", type: "success" });
      window.setTimeout(() => {
        setCopyStatus((current) => current?.key === copyKey ? null : current);
      }, 1800);
    } catch {
      const fallbackCopied = copyTextWithFallback(text);
      setCopyStatus({
        key: copyKey,
        message: fallbackCopied ? "已复制" : "复制失败，请手动复制",
        type: fallbackCopied ? "success" : "error",
      });
    }
  }

  return (
    <section className="surface-card rounded-[28px] p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-violet-700">英文上架文案 / Listing Copy</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">
            {hasCopyResult ? "英文上架文案结果" : "标题、五点描述和详情页待生成"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            根据当前商品、利润测算、上架预览、AI 分析和关键词生成英文文案。结果仅供人工复核，不会自动上架。
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={loading}
          className="glass-button-primary inline-flex h-10 shrink-0 items-center justify-center px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        >
          {buttonText}
        </button>
      </div>

      {hasCopyResult ? (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-violet-200 bg-white/80 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-slate-600">
            已有英文文案结果。可复制为纯文本，也会尽量保留在本机浏览器里，刷新页面后自动恢复。
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton
              label="复制全部英文文案"
              ariaLabel="复制全部英文文案"
              copyKey="all"
              text={fullCopyText}
              onCopy={handleCopy}
            />
            <button
              type="button"
              onClick={onClear}
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              清除本地文案
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}

      {copyStatus ? (
        <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
          copyStatus.type === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}
        >
          {copyStatus.message}
        </p>
      ) : null}

      {loading ? (
        <p className="mb-4 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-violet-700">
          AI 正在生成英文上架文案，请稍等...
        </p>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!hasCopyResult && !loading ? (
        <div className="mb-4 rounded-xl border border-dashed border-violet-200 bg-white/70 p-3 text-sm leading-6 text-slate-600">
          当前还没有英文上架文案。点击按钮后会调用服务端接口生成，不会在前端放 Key，也不会自动发布商品。
        </div>
      ) : null}

      <div className="mb-4 rounded-xl border border-dashed border-violet-200 bg-white/70 p-3 text-sm leading-6 text-slate-600">
        预览来源：{form.name.trim() || "未填写商品名称"} ｜ 临时 SKU：{listingData.sku}
        <HistoryList
          items={historyItems}
          source={historySource}
          loading={historyLoading}
          message={historyMessage}
          onRestore={onRestoreHistory}
          onDelete={onDeleteHistory}
        />
      </div>

      <div className="grid gap-3">
        <TextBlock label="英文标题" value={copyResult?.title} copyKey="title" copyText={titleCopyText} onCopy={handleCopy} />
        <ListBlock label="五点描述" items={copyResult?.bulletPoints} copyKey="bulletPoints" copyText={bulletPointsCopyText} onCopy={handleCopy} />
        <TextBlock label="详情页描述" value={copyResult?.description} copyKey="description" copyText={descriptionCopyText} onCopy={handleCopy} />
        <TextBlock label="短描述" value={copyResult?.shortDescription} copyKey="shortDescription" copyText={shortDescriptionCopyText} onCopy={handleCopy} />
        <ListBlock label="关键词" items={copyResult?.keywords} copyKey="keywords" copyText={keywordsCopyText} onCopy={handleCopy} />
        <ListBlock label="长尾关键词" items={copyResult?.longTailKeywords} copyKey="longTailKeywords" copyText={longTailKeywordsCopyText} onCopy={handleCopy} />
        <FaqBlock items={copyResult?.faq} copyText={faqCopyText} onCopy={handleCopy} />
        <ListBlock label="包装清单" items={copyResult?.packingList} copyKey="packingList" copyText={packingListCopyText} onCopy={handleCopy} />
        <TextBlock label="售后说明" value={copyResult?.afterSales} copyKey="afterSales" copyText={afterSalesCopyText} onCopy={handleCopy} />
        <ListBlock label="注意事项" items={copyResult?.notes} copyKey="notes" copyText={notesCopyText} onCopy={handleCopy} />
      </div>
    </section>
  );
}
