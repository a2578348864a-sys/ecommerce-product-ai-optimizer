"use client";

import { useMemo, useState } from "react";
import type { CreativeHandoffPreview, HandoffDetailConfirmedFact } from "@/components/creative-handoff/types";
import { HandoffApiRequestError } from "@/components/creative-handoff/useCreativeHandoffApi";
import { createBrowserUuid } from "@/lib/browserUuid";

/**
 * Task-linked Listing 死路修复：当 listingEligibleFacts=0 时，原地展示
 * 现有 confirmableFactCandidates（含标题派生候选）供勾选确认；若无可用候选，
 * 提供最小手工输入兜底（受控字段白名单）。
 *
 * 安全边界（全部由服务端 enforce，本组件只提交 selectionId 或受控 field/value）：
 * - 勾选候选只提交 selectionId（服务端锁内重投影后确认）
 * - 手工输入只提交白名单 field + value（服务端构造 human_confirmed/user_confirmation）
 * - prohibitedClaims / market signal 永不进入确认事实
 * - 均走 Creative Handoff create/append（expectedStorageVersion/revision CAS）
 */

const MANUAL_FIELD_LABELS: Record<string, string> = {
  brand: "品牌",
  product_type: "商品类型",
  series_or_model: "系列/型号",
  material: "材质",
  capacity: "容量",
  dimensions: "商品尺寸",
  weight: "商品重量",
  color_or_variant: "颜色/款式",
  quantity_or_pack_size: "数量/包装",
  functional_feature: "功能特性",
  usage: "使用场景",
  care: "清洁保养",
  construction: "构造/做工",
  included_components: "随附组件",
  operation: "操作方式",
  compatibility: "兼容性",
  other: "其他确定商品事实",
};

const MANUAL_FIELD_OPTIONS = Object.entries(MANUAL_FIELD_LABELS).map(([field, label]) => ({ field, label }));

function titleDerivedHint(canonicalField: string): string {
  return MANUAL_FIELD_LABELS[canonicalField] ?? canonicalField;
}

export type ManualFactInput = { field: string; value: string };

export function ListingFactSupplementPanel({
  taskId,
  preview,
  create,
  refresh,
  onCommitted,
  existingFacts = [],
}: {
  taskId: string;
  preview: CreativeHandoffPreview | null;
  create: (input: {
    requestId: string;
    selectedFactCandidateIds: string[];
    manualConfirmedFacts?: ManualFactInput[];
    expectedStorageVersion: { resultJsonHash: string; updatedAt: string };
    expectedResearchRevision: number;
    expectedCurrentHandoffRevision: number;
    onConflict?: (error: { status: number; code: string; message: string }) => void;
  }) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  onCommitted?: () => void;
  existingFacts?: HandoffDetailConfirmedFact[];
}) {
  const existingFields = useMemo(() => new Set(existingFacts.map((fact) => fact.field)), [existingFacts]);
  const candidates = useMemo(
    () => (preview?.confirmableFactCandidates ?? []).filter((candidate) =>
      candidate.allowedUsageScopes.includes("listing") && !existingFields.has(candidate.canonicalField)),
    [preview, existingFields],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 手工兜底输入：{ field: value }，空值表示未填写
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const manualFilled = Object.entries(manualValues)
    .filter(([, value]) => value.trim().length > 0)
    .map(([field, value]) => ({ field, value: value.trim() }));
  const canSubmit = Boolean(
    preview
    && preview.storageVersion
    && preview.expectedResearchRevision
    && preview.expectedCurrentHandoffRevision !== undefined
    && (selectedIds.length > 0 || manualFilled.length > 0)
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
        ...(manualFilled.length > 0 ? { manualConfirmedFacts: manualFilled } : {}),
        expectedStorageVersion: preview.storageVersion,
        expectedResearchRevision: preview.expectedResearchRevision,
        expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      });
      setSelectedIds([]);
      setManualValues({});
      setConfirmed(false);
      await refresh();
      onCommitted?.();
      setNotice({ tone: "info", text: "商品事实已确认，可生成 Listing 草稿。" });
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
        <div>
          <h3 className="text-sm font-bold text-slate-900">商品事实</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            这里填写的是你已经核实过的商品真实信息。确认后会用于 Listing 的事实校验。
          </p>
        </div>
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
          已确认 {existingFacts.length} 项
        </span>
      </div>

      {existingFacts.length > 0 ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2" data-testid="listing-confirmed-facts">
          {existingFacts.map((fact) => (
            <div key={`${fact.field}:${fact.value}`} className="rounded-xl border border-teal-100 bg-teal-50/50 p-3 text-sm text-slate-700">
              <strong>{fact.label}</strong>：{fact.value}
              <span className="mt-1 block text-xs text-teal-700">
                {fact.sourceKind === "user_confirmation" ? "人工核实确认" : "来源证据确认"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <h4 className="mt-4 text-sm font-bold text-slate-900">补充商品事实</h4>

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
        <>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            以下候选来自商品标题 / 来源资料，<strong className="text-slate-800">需人工核实</strong>后才可用于 Listing 草稿。
            勾选后确认，系统会保存新的创作资料版本。
          </p>
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
                    onChange={(event) => {
                      setSelectedIds((current) => (event.target.checked
                        ? [...new Set([...current.filter((id) => candidates.find((item) => item.selectionId === id)?.canonicalField !== candidate.canonicalField), candidate.selectionId])]
                        : current.filter((id) => id !== candidate.selectionId)));
                      if (event.target.checked) {
                        setManualValues((current) => ({ ...current, [candidate.canonicalField]: "" }));
                      }
                      setConfirmed(false);
                    }}
                  />
                  <span>
                    <strong>{titleDerivedHint(candidate.canonicalField)}</strong>：{candidate.displayValue}
                    <span className="mt-0.5 block text-xs text-slate-400">来自商品标题/来源资料，需人工核实</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </>
      ) : (
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {(() => {
            const allCandidates = preview?.confirmableFactCandidates ?? [];
            const referenceOnly = allCandidates.filter((c) => !c.allowedUsageScopes.includes("listing"));
            if (allCandidates.length > 0 && referenceOnly.length > 0) {
              return "已载入研究证据（含仅内部参考的市场观察，如 Observed Price / Rating / BSR；它们不会自动成为 Listing 事实）。可在下方人工填写已核实的商品事实。";
            }
            return "当前来源资料没有可直接核实的商品事实候选，仍可在下方填写你已核实的信息。";
          })()}
        </p>
      )}

      <>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            <strong className="text-slate-800">人工填写已核实事实</strong>：请填写以下你已核实确定的商品信息
            （<strong className="text-slate-800">不必全部填写</strong>），填写项将保存为创作资料并可用于 Listing 草稿。
          </p>
          <div className="mt-2 rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs leading-5 text-slate-600">
            <p className="font-bold text-slate-800">建议核实的缺失信息</p>
            {!existingFields.has("dimensions") ? <p>• 可补充商品尺寸</p> : null}
            {!existingFields.has("weight") ? <p>• 可补充商品重量</p> : null}
            {!existingFields.has("usage") ? <p>• 可补充已确认的使用场景</p> : null}
            {!existingFields.has("compatibility") ? <p>• 是否有杯架/设备兼容信息？</p> : null}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2" data-testid="listing-fact-manual-inputs">
            {MANUAL_FIELD_OPTIONS.filter(({ field }) => !existingFields.has(field)).map(({ field, label }) => (
              <label key={field} className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 text-sm text-slate-700">
                <span className="text-xs font-semibold text-slate-600">{label}</span>
                <input
                  type="text"
                  maxLength={200}
                  value={manualValues[field] ?? ""}
                  placeholder={field === "other" ? "例如：含替换吸管" : label}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setManualValues((current) => ({ ...current, [field]: nextValue }));
                    if (nextValue.trim()) {
                      setSelectedIds((current) => current.filter((id) => candidates.find((candidate) => candidate.selectionId === id)?.canonicalField !== field));
                    }
                    setConfirmed(false);
                  }}
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                />
              </label>
            ))}
          </div>
      </>

      <label className="mt-4 flex gap-3 rounded-xl border border-teal-200 bg-teal-50/60 p-3 text-sm leading-6 text-teal-900">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={selectedIds.length === 0 && manualFilled.length === 0}
        />
        <span>我已核对，这是商品真实信息；确认后可用于 Listing 草稿与事实校验。</span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-teal-600 px-5 text-sm font-bold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "正在保存…" : "确认并保存创作资料"}
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
    return "创作资料已更新，请刷新后重新勾选。";
  }
  if (["invalid_selection", "no_facts_selected", "usage_scope_denied", "invalid_manual_fact"].includes(error.code)) {
    return "所选事实已不可确认，请刷新后重新填写。";
  }
  if (error.code === "confirmed_fact_conflict") {
    return "同一商品事实存在不同值，请选择一个真实值后再确认。";
  }
  return error.message || "保存失败，请稍后重试。";
}
