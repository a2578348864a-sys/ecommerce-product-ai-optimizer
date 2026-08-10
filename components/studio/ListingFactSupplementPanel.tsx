"use client";

import { useMemo, useState } from "react";
import type { CreativeHandoffPreview } from "@/components/creative-handoff/types";
import { HandoffApiRequestError } from "@/components/creative-handoff/useCreativeHandoffApi";
import { createBrowserUuid } from "@/lib/browserUuid";

/**
 * Task-linked Listing 死路修复：当 listingEligibleFacts=0 时，原地展示
 * 现有 confirmableFactCandidates（含标题派生候选），供用户勾选后复用
 * Creative Handoff 的 create/append 流程追加新 revision（CAS 安全）。
 *
 * 安全边界（全部由服务端 enforce，本组件只提交 selectionId）：
 * - 只展示服务端投影的 confirmableFactCandidates（source_snapshot 层）
 * - 浏览器不构造事实值/field/SourceReference
 * - 勾选后走 api.create（expectedStorageVersion/revision CAS）
 * - prohibitedClaims / market signal 永不进入确认候选
 */

const FIELD_LABELS: Record<string, string> = {
  brand: "品牌",
  product_type: "商品类型",
  series_or_model: "系列/型号",
  material: "材质",
  capacity: "容量",
  color_or_variant: "颜色/款式",
  quantity_or_pack_size: "数量/包装",
};

function titleDerivedHint(canonicalField: string): string {
  return FIELD_LABELS[canonicalField] ?? canonicalField;
}

export function ListingFactSupplementPanel({
  taskId,
  preview,
  create,
  refresh,
  onCommitted,
}: {
  taskId: string;
  preview: CreativeHandoffPreview | null;
  create: (input: {
    requestId: string;
    selectedFactCandidateIds: string[];
    expectedStorageVersion: { resultJsonHash: string; updatedAt: string };
    expectedResearchRevision: number;
    expectedCurrentHandoffRevision: number;
    onConflict?: (error: { status: number; code: string; message: string }) => void;
  }) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  onCommitted?: () => void;
}) {
  const candidates = useMemo(
    () => (preview?.confirmableFactCandidates ?? []).filter((c) => c.allowedUsageScopes.includes("listing")),
    [preview],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const canSubmit = Boolean(
    preview
    && preview.storageVersion
    && preview.expectedResearchRevision
    && preview.expectedCurrentHandoffRevision !== undefined
    && selectedIds.length > 0
    && confirmed
    && !submitting,
  );

  async function submit() {
    if (!preview || !preview.storageVersion || preview.expectedResearchRevision === undefined) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await create({
        requestId: createBrowserUuid(),
        selectedFactCandidateIds: selectedIds,
        expectedStorageVersion: preview.storageVersion,
        expectedResearchRevision: preview.expectedResearchRevision,
        expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      });
      setSelectedIds([]);
      setConfirmed(false);
      await refresh();
      onCommitted?.();
      setNotice({ tone: "info", text: "商品事实已确认并写入创作交接，可生成 Listing 草稿。" });
      void result;
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof HandoffApiRequestError
          ? friendlySupplementError(error.error)
          : "保存失败，请稍后重试。",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-amber-200 bg-white p-4" data-testid="listing-fact-supplement-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">补充并确认商品事实</h3>
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
          当前无可用 Listing 事实
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        以下候选来自商品标题 / 来源资料，<strong className="text-slate-800">需人工核实</strong>后才可用于 Listing 草稿。
        勾选后确认，系统会写入新的创作交接版本。
      </p>

      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${notice.tone === "error" ? "bg-red-50 text-red-800" : "bg-teal-50 text-teal-800"}`}
        >
          {notice.text}
        </p>
      ) : null}

      {candidates.length > 0 ? (
        <fieldset className="mt-3">
          <legend className="text-xs font-bold uppercase tracking-wide text-slate-500">待核实商品事实</legend>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {candidates.map((candidate) => (
              <label
                key={candidate.selectionId}
                className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm leading-6 text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(candidate.selectionId)}
                  onChange={(event) => setSelectedIds((current) => (event.target.checked
                    ? [...new Set([...current, candidate.selectionId])]
                    : current.filter((id) => id !== candidate.selectionId)))}
                />
                <span>
                  <strong>{titleDerivedHint(candidate.canonicalField)}</strong>：{candidate.displayValue}
                  <span className="mt-0.5 block text-xs text-slate-400">来自商品标题/来源资料，需人工核实</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          当前来源资料中没有可核实的商品事实候选，请返回研究记录补充来源信息后再试。
        </p>
      )}

      <label className="mt-4 flex gap-3 rounded-xl border border-teal-200 bg-teal-50/60 p-3 text-sm leading-6 text-teal-900">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={selectedIds.length === 0}
        />
        <span>我已核实以上勾选的信息，可用于 Listing 草稿。</span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-teal-600 px-5 text-sm font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "正在保存…" : "确认并写入创作交接"}
        </button>
      </div>
    </section>
  );
}

function friendlySupplementError(error: { status: number; code: string; message: string }): string {
  if (error.status === 409) {
    return "研究资料已更新，请刷新后重新勾选。";
  }
  if (["handoff_stale", "research_revision_conflict", "handoff_revision_conflict"].includes(error.code)) {
    return "创作交接已更新，请刷新后重新勾选。";
  }
  if (["invalid_selection", "no_facts_selected", "usage_scope_denied"].includes(error.code)) {
    return "所选事实已不可确认，请刷新后重新勾选。";
  }
  return error.message || "保存失败，请稍后重试。";
}
