"use client";

import { useMemo, useState } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import type { AiListingPackSnapshot } from "@/lib/aiListingSnapshot";

export const AI_LISTING_DRAFT_PREVIEW_ENDPOINT = "/listing-pack/ai-generate";
export const AI_LISTING_DRAFT_SAVE_ENDPOINT = "/listing-pack/ai-save";
export const AI_LISTING_DRAFT_REAL_CONFIRMATION_TEXT =
  "这会尝试调用真实 AI Listing 生成能力，可能消耗真实 AI 额度。结果只是草稿，需要人工复核，不会自动保存或上架。";

type AiListingGenerationMode = "mock" | "real";

export function buildAiListingGenerateRequestBody(mode: AiListingGenerationMode) {
  if (mode === "real") return { mode: "real", confirmRealAi: true };
  return { mode: "preview" };
}

type GenerateResponse =
  | { ok: true; data: { listingPack: AiListingPackDraft; meta?: { saved?: boolean } } }
  | { ok: false; error?: { code?: string; message?: string } };

type SaveResponse =
  | { ok: true; data: { saved: true; savedAt: string; version: number; aiListingPackSnapshot: AiListingPackSnapshot } }
  | { ok: false; error?: { code?: string; message?: string } };

export function getAiListingDraftErrorMessage(status: number, code?: string) {
  if (status === 401 || code === "unauthorized") return "登录状态已失效，请回首页重新解锁。";
  if (code === "task_not_found") return "当前任务不存在或已被删除。";
  if (code === "missing_task_context") return "当前任务信息不足，无法生成 Listing 草稿。";
  if (code === "invalid_ai_listing_pack") return "生成结果结构异常，请稍后重试。";
  if (code === "ai_listing_generation_failed") return "Listing 草稿生成失败，请稍后重试。";
  if (code === "real_ai_confirmation_required") return "真实 AI 生成需要二次确认，本次没有发起真实 AI 请求。";
  if (code === "real_ai_disabled") return "真实 AI 生成暂未开启，当前没有消耗 AI 额度。你可以继续使用模拟草稿，或等待后续开启。";
  if (code === "real_ai_not_implemented") return "真实 AI Listing 生成尚未接入，当前没有消耗 AI 额度。请继续使用模拟草稿。";
  if (code === "invalid_json") return "请求内容格式异常，请稍后重试。";
  return "网络请求失败，请稍后重试。";
}

export function getAiListingSaveErrorMessage(status: number, code?: string) {
  if (status === 401 || code === "unauthorized") return "请先回首页解锁工作台。";
  if (code === "task_not_found") return "当前任务不存在或已被删除。";
  if (code === "invalid_ai_listing_pack") return "草稿结构异常，无法保存。";
  if (code === "ai_listing_pack_already_exists") return "任务中已存在 AI Listing 草稿，请确认后再覆盖。";
  if (code === "ai_listing_save_failed") return "保存失败，当前草稿仍保留在页面中，可稍后重试。";
  if (code === "invalid_json") return "请求内容格式异常，请稍后重试。";
  return "保存失败，当前草稿仍保留在页面中，可稍后重试。";
}

function listSection(title: string, items: string[]) {
  if (!items.length) return [`## ${title}`, "", "暂无", ""];
  return [`## ${title}`, "", ...items.map((item) => `- ${item}`), ""];
}

export function buildAiListingDraftMarkdown(draft: AiListingPackDraft) {
  const lines: string[] = [
    "# AI Listing 草稿预览",
    "",
    ...listSection("标题候选", draft.titles),
    ...listSection("五点描述草稿", draft.bullets),
    "## 商品描述草稿",
    "",
    draft.description,
    "",
    ...listSection("关键词 / 长尾词", draft.keywords),
    ...listSection("卖点摘要", draft.sellingPoints),
    ...listSection("风险提示", draft.riskNotes),
    "## 合规提醒",
    "",
  ];

  if (draft.complianceWarnings.length > 0) {
    lines.push(...draft.complianceWarnings.map((item) => `- ${item}`));
  } else {
    lines.push("- 暂无额外合规提醒，仍需人工复核。");
  }
  if (draft.blockedClaims.length > 0) {
    lines.push(`- 已拦截 ${draft.blockedClaims.length} 条未验证声明，未放入可直接使用正文。`);
  }
  lines.push("", ...listSection("人工复核清单", draft.reviewChecklist));
  lines.push("> 注意：这是草稿预览，不是最终上架文案。请人工复核后再使用。");

  return lines.join("\n").trim();
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "生成时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall back below
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const success = document.execCommand("copy");
  textarea.remove();
  return success;
}

function FieldList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <p className="text-sm font-bold text-slate-800">{title}</p>
      <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-600">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2">
            <span className="text-teal-500">-</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChipList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-teal-100 bg-teal-50/60 p-3">
      <p className="text-sm font-bold text-teal-900">{title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <span key={`${item}-${index}`} className="rounded-full border border-teal-200 bg-white px-2 py-0.5 text-xs font-semibold text-teal-700">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AiListingDraftPreviewCard({
  taskId,
  initialDraft = null,
  initialSavedSnapshot = null,
}: {
  taskId: string;
  initialDraft?: AiListingPackDraft | null;
  initialSavedSnapshot?: AiListingPackSnapshot | null;
}) {
  const [draft, setDraft] = useState<AiListingPackDraft | null>(initialSavedSnapshot || initialDraft);
  const [savedSnapshot, setSavedSnapshot] = useState<AiListingPackSnapshot | null>(initialSavedSnapshot);
  const [draftSaved, setDraftSaved] = useState(Boolean(initialSavedSnapshot));
  const [loading, setLoading] = useState(false);
  const [realLoading, setRealLoading] = useState(false);
  const [realConfirmOpen, setRealConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState(initialSavedSnapshot ? "已保存到任务记录。" : "");
  const [overwriteRequired, setOverwriteRequired] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");

  const markdown = useMemo(() => draft ? buildAiListingDraftMarkdown(draft) : "", [draft]);
  const hasBlockedClaims = Boolean(draft?.blockedClaims.length);

  async function handleGenerate(mode: AiListingGenerationMode = "mock") {
    const isRealMode = mode === "real";
    if (loading || realLoading) return;
    if (isRealMode) {
      setRealLoading(true);
    } else {
      setLoading(true);
    }
    setError("");
    setCopyMessage("");

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}${AI_LISTING_DRAFT_PREVIEW_ENDPOINT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify(buildAiListingGenerateRequestBody(mode)),
      });
      const data = await response.json() as GenerateResponse;
      if (!response.ok || !data.ok) {
        setError(getAiListingDraftErrorMessage(response.status, data.ok ? undefined : data.error?.code));
        return;
      }
      setDraft(data.data.listingPack);
      setDraftSaved(false);
      setSaveMessage(savedSnapshot ? "已生成新的草稿预览，如需替换任务记录，请点击覆盖保存。" : "");
      setSaveError("");
      setOverwriteRequired(false);
    } catch {
      setError(getAiListingDraftErrorMessage(0));
    } finally {
      if (isRealMode) {
        setRealLoading(false);
      } else {
        setLoading(false);
      }
    }
  }

  function handleRealGenerateClick() {
    if (loading || realLoading) return;
    setError("");
    setRealConfirmOpen(true);
  }

  function handleCancelRealGenerate() {
    setRealConfirmOpen(false);
  }

  async function handleConfirmRealGenerate() {
    setRealConfirmOpen(false);
    await handleGenerate("real");
  }

  async function handleCopy() {
    if (!markdown) return;
    const success = await copyText(markdown);
    setCopyMessage(success ? "已复制" : "复制失败，请手动复制");
    if (success) window.setTimeout(() => setCopyMessage(""), 1600);
  }

  async function handleSave() {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError("");
    setSaveMessage("");

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}${AI_LISTING_DRAFT_SAVE_ENDPOINT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildAccessHeaders() },
        body: JSON.stringify({
          listingPack: draft,
          overwrite: Boolean(savedSnapshot) || overwriteRequired,
        }),
      });
      const data = await response.json() as SaveResponse;
      if (!response.ok || !data.ok) {
        if (!data.ok && data.error?.code === "ai_listing_pack_already_exists") {
          setOverwriteRequired(true);
        }
        setSaveError(getAiListingSaveErrorMessage(response.status, data.ok ? undefined : data.error?.code));
        return;
      }
      setDraft(data.data.aiListingPackSnapshot);
      setSavedSnapshot(data.data.aiListingPackSnapshot);
      setDraftSaved(true);
      setOverwriteRequired(false);
      setSaveMessage("已保存到任务记录。");
    } catch {
      setSaveError(getAiListingSaveErrorMessage(0));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-emerald-200 bg-white p-4" data-testid="ai-listing-draft-preview">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">mock AI preview</p>
          <h3 className="mt-1 text-base font-bold text-slate-950">AI Listing 草稿预览</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            基于当前任务信息生成草稿，用于人工复核，不会自动上架。
          </p>
        </div>
        <span className={`w-fit rounded-full border px-3 py-1 text-sm font-semibold ${
          error
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : draft
              ? draftSaved
                ? "border-teal-200 bg-teal-50 text-teal-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-slate-50 text-slate-600"
        }`}>
          {error ? "生成失败" : draft ? draftSaved ? "已保存到任务记录" : "草稿预览已生成" : "未生成"}
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3 text-sm leading-6 text-amber-800">
        这是 AI 辅助草稿，不是最终上架文案。请人工复核标题、卖点、认证声明、平台规则和商品事实。
        系统不会自动上架，也不会承诺收益或销量表现。
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleGenerate("mock")}
          disabled={loading || realLoading}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="ai-listing-draft-generate"
        >
          {loading ? "正在生成草稿预览..." : draft ? "重新生成预览" : "生成草稿预览"}
        </button>
        {draft ? (
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100"
            data-testid="ai-listing-draft-copy"
          >
            {copyMessage === "已复制" ? "已复制" : "复制 Markdown"}
          </button>
        ) : null}
        {draft ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || draftSaved}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-teal-200 bg-teal-50 px-4 text-sm font-bold text-teal-700 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="ai-listing-draft-save"
          >
            {saving ? "保存中..." : draftSaved ? "已保存" : (savedSnapshot || overwriteRequired) ? "覆盖保存" : "保存到任务记录"}
          </button>
        ) : null}
        {copyMessage && copyMessage !== "已复制" ? <p className="text-sm font-semibold text-rose-600">{copyMessage}</p> : null}
      </div>

      <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/60 p-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-sky-900">真实 AI 生成草稿</p>
            <p className="mt-1 text-sm leading-6 text-sky-800">
              会消耗真实 AI 额度，当前仅生成草稿，不会自动保存；生成内容必须人工复核，也不会自动上架。
            </p>
          </div>
          <button
            type="button"
            onClick={handleRealGenerateClick}
            disabled={loading || realLoading}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-sky-300 bg-white px-4 text-sm font-bold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="ai-listing-draft-real-open"
          >
            {realLoading ? "真实 AI 请求中..." : "真实 AI 生成草稿"}
          </button>
        </div>
      </div>

      {realConfirmOpen ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3" role="dialog" aria-modal="true" aria-label="真实 AI 生成二次确认">
          <p className="text-sm font-bold text-amber-900">确认使用真实 AI 生成草稿？</p>
          <p className="mt-1 text-sm leading-6 text-amber-800">{AI_LISTING_DRAFT_REAL_CONFIRMATION_TEXT}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCancelRealGenerate}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              data-testid="ai-listing-draft-real-cancel"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmRealGenerate()}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-amber-600 px-3 text-sm font-bold text-white transition hover:bg-amber-700"
              data-testid="ai-listing-draft-real-confirm"
            >
              确认尝试真实 AI
            </button>
          </div>
        </div>
      ) : null}

      {loading ? <p className="mt-3 text-sm font-semibold text-emerald-700">正在生成草稿预览...</p> : null}
      {realLoading ? <p className="mt-3 text-sm font-semibold text-sky-700">真实 AI 草稿请求中...</p> : null}
      {error ? <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p> : null}
      {saveMessage ? <p className="mt-3 text-sm font-semibold text-teal-700">{saveMessage}</p> : null}
      {saveError ? <p className="mt-3 text-sm font-semibold text-rose-600">{saveError}</p> : null}

      {draft ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <span>source：{draft.source}</span>
            <span>model：{draft.model}</span>
            <span>{formatGeneratedAt(draft.generatedAt)}</span>
            <span>{draftSaved ? "当前草稿已保存到任务记录，刷新后仍可查看。" : "当前为草稿预览，尚未保存到任务记录。刷新页面后需要重新生成。"}</span>
            {savedSnapshot ? <span>已保存版本：{savedSnapshot.version}</span> : null}
          </div>

          {draft.humanReviewRequired ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm font-semibold text-emerald-800">
              {draftSaved ? "已保存到任务记录。请人工复核后再使用。" : "草稿预览已生成，请人工复核后再使用。"}
            </div>
          ) : null}

          {hasBlockedClaims ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-bold text-amber-800">发现未验证声明，已从草稿中拦截。</p>
              <p className="mt-1 text-sm leading-6 text-amber-700">已拦截未验证声明，需人工核验。</p>
            </div>
          ) : null}

          <FieldList title="标题候选" items={draft.titles} />
          <FieldList title="五点描述草稿" items={draft.bullets} />
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
            <p className="text-sm font-bold text-slate-800">商品描述草稿</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{draft.description}</p>
          </div>
          <ChipList title="关键词 / 长尾词" items={draft.keywords} />
          <FieldList title="卖点摘要" items={draft.sellingPoints} />
          <FieldList title="风险提示" items={draft.riskNotes} />

          {(draft.complianceWarnings.length > 0 || draft.blockedClaims.length > 0) ? (
            <div className="rounded-xl border border-amber-200 bg-white p-3">
              <p className="text-sm font-bold text-amber-800">合规检查结果</p>
              {draft.complianceWarnings.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm leading-6 text-amber-700">
                  {draft.complianceWarnings.map((item, index) => <li key={index}>- {item}</li>)}
                </ul>
              ) : null}
              {draft.blockedClaims.length > 0 ? (
                <div className="mt-3">
                  <p className="text-sm font-bold text-slate-700">被拦截的高风险声明</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    已拦截 {draft.blockedClaims.length} 条未验证声明。具体声明不放入可复制正文，请根据供应商资料和平台规则人工核验。
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <FieldList title="人工复核清单" items={draft.reviewChecklist} />
        </div>
      ) : null}
    </section>
  );
}
