"use client";

/**
 * V3 UX Closure — Fact Candidate Review（商品事实候选确认）
 *
 * 系统从确定性证据（SellerSprite / Amazon 页面 / 商品标题）提取「事实候选」，
 * 用户勾选/取消/修改后批量确认——确认即成为本任务的 Confirmed Fact（Human Confirmation
 * Authority，独立 fact-candidates writer）。
 *
 * 安全语义：
 * - 候选来源固定为确定性证据；AI/VOC/竞品/供应商声称不会出现在这里；
 * - 「确认」是人类对候选值的核实（可修改），不是 AI 升权；
 * - 已确认事实显示来源（seller_sprite / amazon_browser / product_title），不再重复确认。
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, Sparkles } from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import { MANUAL_FACT_FIELDS, humanManualCandidateId } from "@/lib/factCandidates";

type FactCandidateView = {
  candidateId: string;
  field: string;
  label: string;
  value: string | number;
  sourceKind: "seller_sprite_product_facts" | "amazon_browser_evidence" | "product_title" | "human_manual";
  sourceRef: string;
};

type ConfirmedFactView = FactCandidateView & { confirmedAt: string; confirmedBy: string };

const SOURCE_LABELS: Record<string, string> = {
  seller_sprite_product_facts: "SellerSprite 商品数据",
  amazon_browser_evidence: "Amazon 页面证据",
  product_title: "商品标题（自动识别）",
  amazon_product_info: "Amazon 商品规格",
  human_manual: "人工核实（手动补充）",
};

function buildFetchHeaders(extra?: Record<string, string>): Headers {
  return new Headers({ ...buildAccessHeaders(), ...extra });
}

// ── V3 Final HWF：Selection Preservation（导出纯函数，供测试） ──
// 批量确认后只移除「已成功确认」的勾选；冲突项保留待复核（任务书 §12）。
export function preserveSelectionAfterConfirm(
  selected: ReadonlySet<string>,
  conflictCandidateIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set<string>();
  for (const id of selected) {
    if (conflictCandidateIds.has(id)) next.add(id);
  }
  return next;
}

// 刷新后清理「候选/已确认中已不存在」的勾选项（candidate_missing 场景），其余保留用户意图。
export function pruneSelectionToAlive(
  selected: ReadonlySet<string>,
  aliveCandidateIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set<string>();
  for (const id of selected) {
    if (aliveCandidateIds.has(id)) next.add(id);
  }
  return next;
}

export function FactCandidateReview({
  taskId,
  storageVersion,
  onChanged,
}: {
  taskId: string;
  storageVersion: { resultJsonHash: string; updatedAt: string } | null;
  onChanged: () => void;
}) {
  const [candidates, setCandidates] = useState<FactCandidateView[] | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedFactView[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editedValues, setEditedValues] = useState<Record<string, string | number>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // V3 UX Closure Manual Fact：手动补充商品事实（SYSTEM CANNOT EXTRACT → 用户手动补充）
  const [manualOpen, setManualOpen] = useState(false);
  const [manualField, setManualField] = useState(MANUAL_FACT_FIELDS[0]?.field ?? "");
  const [manualValue, setManualValue] = useState("");
  const [manualNote, setManualNote] = useState("");
  // V3 Final PHASE 1：✨ 智能补齐商品资料（采集 Amazon 商品规格 → 生成候选 → 人工确认）
  const [recovering, setRecovering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/fact-candidates`, {
        method: "GET",
        headers: buildFetchHeaders(),
        cache: "no-store",
      });
      const json = await res.json() as
        | { ok: true; data: { candidates: FactCandidateView[]; confirmed: ConfirmedFactView[] } }
        | { ok: false; error?: { message?: string } };
      if (!res.ok || !json.ok) {
        setError((json as { error?: { message?: string } }).error?.message ?? "无法读取商品事实候选。");
        return;
      }
      setCandidates(json.data.candidates);
      setConfirmed(json.data.confirmed);
      // V3 Final HWF：Selection Preservation——候选已不存在的勾选项清理（其余保留用户意图）
      const alive = new Set<string>();
      for (const c of json.data.candidates) alive.add(c.candidateId);
      for (const c of json.data.confirmed) alive.add(c.candidateId);
      setSelected((prev) => pruneSelectionToAlive(prev, alive));
    } catch {
      setError("无法读取商品事实候选，请重试。");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(candidateId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  }

  /** 服务端批量确认响应（V3 Final HWF：Safe Rebase / Partial Conflict / 幂等） */
  type ConfirmResponse =
    | { ok: true; data: { confirmedCount: number; alreadyConfirmedCount?: number; conflicts?: Array<{ candidateId: string; label: string; reason: "candidate_missing" | "value_changed" }> } }
    | { ok: false; error?: { code?: string; message?: string; conflicts?: Array<{ candidateId: string; label: string; reason: string }> } };

  function applyConfirmOutcome(json: ConfirmResponse) {
    if (!json.ok) return;
    const data = json.data;
    const conflicts = data.conflicts ?? [];
    const conflictIds = new Set(conflicts.map((c) => c.candidateId));
    // Selection Preservation：只移除已成功确认的项；冲突项保留勾选待复核
    setSelected((prev) => preserveSelectionAfterConfirm(prev, conflictIds));
    setEditedValues((prev) => {
      const next: Record<string, string | number> = {};
      for (const [id, value] of Object.entries(prev)) {
        if (conflictIds.has(id)) next[id] = value;
      }
      return next;
    });
    if (conflicts.length > 0) {
      setError(
        data.confirmedCount > 0
          ? `已确认 ${data.confirmedCount} 条。另外 ${conflicts.length} 条资料刚发生变化，请检查后重新确认。`
          : "这几条商品资料刚发生变化，系统没有替你确认。请检查最新内容后再确认。",
      );
      setNotice("");
    } else {
      const already = data.alreadyConfirmedCount ?? 0;
      setNotice(
        data.confirmedCount > 0
          ? `已确认 ${data.confirmedCount} 项商品事实。${already > 0 ? `（${already} 项已确认过，未重复写入）` : ""}`
          : `${already > 0 ? `已确认过 ${already} 项（未重复写入）。` : "没有新的商品事实需要确认。"}`,
      );
      setError("");
    }
  }

  async function confirmSelected() {
    if (selected.size === 0 || !storageVersion) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const selections = [...selected].map((candidateId) => {
        const candidate = candidates?.find((c) => c.candidateId === candidateId);
        const editedValue = editedValues[candidateId];
        const edited = editedValue !== undefined && editedValue !== String(candidate?.value);
        return {
          candidateId,
          confirmed: true,
          value: editedValue ?? candidate?.value,
          ...(edited ? { edited: true } : {}),
        };
      });
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/fact-candidates`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ selections, expectedStorageVersion: storageVersion }),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json() as ConfirmResponse;
      if (!res.ok || !json.ok) {
        const error = (json as { error?: { code?: string; message?: string; conflicts?: unknown[] } }).error ?? {};
        if (error.code === "task_result_conflict") {
          // 服务端已自动 Safe Rebase 过一次仍冲突（真实并发竞态）→ 刷新最新状态，不要求重新勾选
          setError("内容刚刚发生变化，请刷新后重试。");
          onChanged();
          return;
        }
        if (error.code === "fact_conflict") {
          setError("这几条商品资料刚发生变化，系统没有替你确认。请检查最新内容后再确认。");
          await load();
          onChanged();
          return;
        }
        setError(error.message ?? "确认失败，请重试。");
        return;
      }
      applyConfirmOutcome(json);
      await load();
      onChanged();
    } catch {
      setError("确认失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  async function addManualFact() {
    if (!storageVersion) return;
    const field = manualField.trim();
    const value = manualValue.trim();
    if (!field || !value) {
      setError("请选择事实类型并填写事实值。");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/fact-candidates`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          selections: [{
            candidateId: humanManualCandidateId(field),
            confirmed: true,
            value,
          }],
          expectedStorageVersion: storageVersion,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json() as ConfirmResponse;
      if (!res.ok || !json.ok) {
        const error = (json as { error?: { code?: string; message?: string } }).error ?? {};
        if (error.code === "task_result_conflict") {
          // 服务端已自动 Safe Rebase 过一次仍冲突（真实并发竞态）→ 刷新最新状态，不要求重新添加
          setError("内容刚刚发生变化，请刷新后重试。");
          onChanged();
          return;
        }
        if (error.code === "fact_conflict") {
          setError("这条商品资料刚发生变化，系统没有替你确认。请检查最新内容后再添加。");
          await load();
          onChanged();
          return;
        }
        setError(error.message ?? "添加失败，请重试。");
        return;
      }
      applyConfirmOutcome(json);
      setManualValue("");
      setManualNote("");
      setManualOpen(false);
      await load();
      onChanged();
    } catch {
      setError("添加失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  /** V3 Final PHASE 1：✨ 智能补齐商品资料——采集 Amazon 商品规格 → 生成候选 → 用户 Review/Confirm */
  async function runRecovery() {
    if (recovering || !storageVersion) return;
    setRecovering(true);
    setError("");
    setNotice("");
    try {
      // 1) 采集（同一受控会话：6 字段 + Product Information 规格）
      const collectRes = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/browser-evidence`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "collect" }),
        signal: AbortSignal.timeout(120_000),
      });
      const collectJson = await collectRes.json() as
        | { ok: true; data: { evidenceId: string; demo?: boolean } }
        | { ok: false; error?: { code?: string; message?: string } };
      if (!collectRes.ok || !collectJson.ok) {
        const error = (collectJson as { error?: { code?: string; message?: string } }).error ?? {};
        if (error.code === "task_asin_unbound") {
          setError("该商品缺少 Amazon 商品来源（ASIN），无法自动补齐。可先补充来源，或使用下方「手动补充商品事实」。");
          return;
        }
        if (error.code === "local_environment_required") {
          setError("商品规格自动补齐仅在本机研究环境可用（公网为演示回放）。可先使用下方「手动补充商品事实」。");
          return;
        }
        setError(error.message ?? "智能补齐失败，请稍后重试。");
        return;
      }
      // 2) 保存快照（含 Product Information）→ 候选随之出现（服务端确定性提取）
      const saveRes = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/browser-evidence`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "save",
          evidenceId: collectJson.data.evidenceId,
          expectedStorageVersion: storageVersion,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const saveJson = await saveRes.json() as { ok: boolean; error?: { code?: string; message?: string } };
      if (!saveRes.ok || !saveJson.ok) {
        const error = saveJson.error ?? {};
        if (error.code === "storage_version_required" || error.code === "task_result_conflict") {
          setError("内容刚刚发生变化，请刷新后重试。");
          onChanged();
          return;
        }
        setError(error.message ?? "补齐结果保存失败，请稍后重试。");
        return;
      }
      await load();
      onChanged();
      if (collectJson.data.demo) {
        setNotice("已读取演示采集快照（非实时访问 Amazon）；请在下方核对后确认。");
      } else {
        setNotice("已补齐商品规格资料，请在下方核对后确认。");
      }
    } catch {
      setError("智能补齐失败，请检查网络后重试。");
    } finally {
      setRecovering(false);
    }
  }

  if (loading && candidates === null && confirmed === null) {
    return (
      <div id="fact-candidate-review" className="mt-4 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500" data-testid="fact-candidates-loading">
        <Loader2 className="mr-1 inline size-4 animate-spin" /> 正在从研究证据提取商品事实候选…
      </div>
    );
  }

  const total = (candidates?.length ?? 0) + (confirmed?.length ?? 0);
  if (total === 0 && !error) {
    return (
      <div id="fact-candidate-review" className="mt-4 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500" data-testid="fact-candidates-empty">
        暂无可提取的商品事实候选（来源：SellerSprite 商品数据 / Amazon 页面证据 / 商品标题）。
      </div>
    );
  }

  return (
    <section id="fact-candidate-review" className="mt-4 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-4" data-testid="fact-candidate-review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">
          商品事实候选 <span className="ml-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">来自研究证据 · 人工确认</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={recovering || saving}
            onClick={() => void runRecovery()}
            className="inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
            data-testid="smart-recovery-trigger"
          >
            {recovering ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {recovering ? "正在补齐商品资料…" : "✨ 智能补齐商品资料"}
          </button>
          <button
            type="button"
            disabled={saving || selected.size === 0}
            onClick={() => void confirmSelected()}
            className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            确认所选事实（{selected.size}）
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        系统从已有研究证据提取以下候选；勾选并「确认」后即成为本任务已确认事实（可修改值，来源保持不变）。
        「✨ 智能补齐商品资料」会读取该商品在 Amazon 的规格资料（材质/尺寸/重量/清洁等），生成候选后仍由你确认。
        AI 摘要、评论与供应商声称不会自动成为候选。
      </p>
      {error && <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}
      {notice && <p className="mt-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-700">{notice}</p>}

      {confirmed && confirmed.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold text-slate-700">已确认（{confirmed.length}）</p>
          <ul className="mt-1 space-y-1">
            {confirmed.map((item) => (
              <li key={item.candidateId} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm" data-testid="fact-confirmed-item">
                <span className="font-semibold text-slate-800">{item.label}</span>
                <span className="flex-1 text-right text-slate-700">{item.value}</span>
                <span className="shrink-0 text-[11px] text-slate-400">来源：{SOURCE_LABELS[item.sourceKind] ?? item.sourceKind}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {candidates && candidates.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold text-slate-700">候选（{candidates.length}，勾选后批量确认）</p>
          <ul className="mt-1 space-y-1">
            {candidates.map((item) => (
              <li key={item.candidateId} className="flex items-start gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm" data-testid="fact-candidate-item">
                <input
                  type="checkbox"
                  checked={selected.has(item.candidateId)}
                  onChange={() => toggle(item.candidateId)}
                  className="mt-1 size-4 rounded border-slate-300 text-indigo-600"
                  aria-label={`确认 ${item.label}`}
                />
                <span className="w-28 shrink-0 font-semibold text-slate-800">{item.label}</span>
                <input
                  type="text"
                  value={String(editedValues[item.candidateId] ?? item.value)}
                  onChange={(event) => setEditedValues((prev) => ({ ...prev, [item.candidateId]: event.target.value }))}
                  className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-slate-700 focus:border-indigo-400 focus:outline-none"
                  aria-label={`${item.label} 值（可修改）`}
                />
                <span className="shrink-0 text-[11px] text-slate-400" title={item.sourceRef}>
                  <Sparkles className="mr-0.5 inline size-3" />
                  {SOURCE_LABELS[item.sourceKind] ?? item.sourceKind}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* V3 UX Closure Manual Fact：系统无法提取时，用户手动补充（进入同一 Human Confirmation Authority） */}
      <div className="mt-4 border-t border-slate-100 pt-3" data-testid="manual-fact-entry">
        <button
          type="button"
          onClick={() => setManualOpen((open) => !open)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          aria-expanded={manualOpen}
        >
          <Plus className="size-4" aria-hidden="true" />
          手动补充商品事实
        </button>
        {manualOpen && (
          <div className="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-[200px_1fr_auto]">
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
              事实类型
              <select
                value={manualField}
                onChange={(event) => setManualField(event.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800"
                data-testid="manual-fact-field"
              >
                {MANUAL_FACT_FIELDS.map((entry) => (
                  <option key={entry.field} value={entry.field}>{entry.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
              事实值
              <input
                type="text"
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
                placeholder="例如：304 不锈钢"
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800"
                data-testid="manual-fact-value"
              />
            </label>
            <div className="flex items-end gap-2">
              <input
                type="text"
                value={manualNote}
                onChange={(event) => setManualNote(event.target.value)}
                placeholder="可选备注"
                className="hidden w-32 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 sm:block"
                aria-label="可选备注"
              />
              <button
                type="button"
                disabled={saving || !manualValue.trim()}
                onClick={() => void addManualFact()}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-3 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50"
                data-testid="manual-fact-add"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                添加并确认
              </button>
            </div>
            <p className="text-[11px] leading-5 text-slate-400 sm:col-span-3">
              手动补充的事实会标记为「人工核实（手动补充）」——不会伪装成 Amazon / SellerSprite / 标题等自动提取来源。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
