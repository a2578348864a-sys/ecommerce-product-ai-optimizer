"use client";

import { useEffect, useMemo, useState } from "react";
import { buildAccessHeaders } from "@/lib/client/accessToken";

export type CommercialInputsForm = {
  purchasePriceValue: string;
  purchasePriceCurrency: "CNY" | "USD";
  moq: string;
  logisticsValue: string;
  logisticsCurrency: "CNY" | "USD";
  complianceStatus: "not_reviewed" | "reviewed_ok" | "issues_found";
  complianceNote: string;
};

const EMPTY: CommercialInputsForm = {
  purchasePriceValue: "",
  purchasePriceCurrency: "CNY",
  moq: "",
  logisticsValue: "",
  logisticsCurrency: "CNY",
  complianceStatus: "not_reviewed",
  complianceNote: "",
};

type Loaded = { ok: boolean; inputs?: Record<string, unknown>; stale?: boolean; storageVersion?: unknown };

function toForm(inputs: Record<string, unknown>): CommercialInputsForm {
  const price = (inputs.purchasePrice ?? null) as { value?: number; currency?: string } | null;
  const logistics = (inputs.logisticsCost ?? null) as { value?: number; currency?: string } | null;
  const compliance = (inputs.compliance ?? null) as { status?: string; note?: string } | null;
  return {
    purchasePriceValue: typeof price?.value === "number" ? String(price.value) : "",
    purchasePriceCurrency: price?.currency === "USD" ? "USD" : "CNY",
    moq: typeof inputs.moq === "number" ? String(inputs.moq) : "",
    logisticsValue: typeof logistics?.value === "number" ? String(logistics.value) : "",
    logisticsCurrency: logistics?.currency === "USD" ? "USD" : "CNY",
    complianceStatus: (["not_reviewed", "reviewed_ok", "issues_found"] as const).includes(compliance?.status as never)
      ? compliance?.status as CommercialInputsForm["complianceStatus"]
      : "not_reviewed",
    complianceNote: typeof compliance?.note === "string" ? compliance.note : "",
  };
}

function savedFields(form: CommercialInputsForm): { [key: string]: unknown } {
  const out: { [key: string]: unknown } = {};
  if (form.purchasePriceValue !== "") out.purchasePrice = { value: Number(form.purchasePriceValue), currency: form.purchasePriceCurrency };
  if (form.moq !== "") out.moq = Number(form.moq);
  if (form.logisticsValue !== "") out.logisticsCost = { value: Number(form.logisticsValue), currency: form.logisticsCurrency };
  if (form.complianceStatus !== "not_reviewed" || form.complianceNote !== "") {
    out.compliance = { status: form.complianceStatus, ...(form.complianceNote !== "" ? { note: form.complianceNote } : {}) };
  }
  return out;
}

/** 轮 6 成本与风险补资料：分次部分保存（仅字段写；不自动重跑 AI、不替用户做决定；completed 记录按既有 stale 机制）。 */
export function CommercialInputsCard({ taskId, onChanged }: { taskId: string; onChanged?: () => void }) {
  const [form, setForm] = useState<CommercialInputsForm>(EMPTY);
  const [storageVersion, setStorageVersion] = useState<unknown>(null);
  const [stale, setStale] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/commercial-inputs`, {
          headers: { ...buildAccessHeaders() },
          cache: "no-store",
        });
        const json = await response.json().catch(() => null) as Loaded | null;
        if (cancelled || !response.ok || !json?.ok) return;
        setForm(toForm(json.inputs ?? {}));
        setStorageVersion(json.storageVersion ?? null);
        setStale(json.stale === true);
        setLoaded(true);
      } catch {
        if (!cancelled) setError("资料读取失败，请稍后刷新。");
      }
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  const hasSaved = useMemo(() => Object.keys(savedFields(form)).length > 0, [form]);

  async function save() {
    if (saving) return;
    const newFields = savedFields(form);
    if (Object.keys(newFields).length === 0) {
      setError("请至少填写一项资料后再保存。");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/commercial-inputs`, {
        method: "PUT",
        headers: { ...buildAccessHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ ...newFields, storageVersion }),
      });
      const json = await response.json().catch(() => null) as Loaded & { error?: { code?: string; message?: string } } | null;
      if (response.status === 409) {
        setError("资料已被其它操作更新，请刷新后重试；不会覆盖他人保存。");
        return;
      }
      if (!response.ok || !json?.ok) {
        setError(json?.error?.message ?? "保存失败，请稍后重试。");
        return;
      }
      setMessage("已保存并采用你填写的数据；未填写的字段仍为待补。仍缺字段需继续补充后才算完成。");
      onChanged?.();
      setStale(json.stale === true);
    } catch {
      setError("保存失败，请检查本地服务后重试。");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100";

  return (
    <section id="formal-v2-cost-risk-evidence" data-testid="commercial-inputs-card" className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">成本与风险资料（分次保存）</h3>
        <span className="text-xs text-slate-500">{hasSaved ? "已保存部分字段；未填写的仍是待补" : "当前全部待补"}</span>
      </div>
      {stale ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700" data-testid="commercial-inputs-stale">
          该研究已完成：新填资料会按既有机制触发重新确认。
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="min-w-0">
          <span className="text-xs font-semibold text-slate-600">单件采购价</span>
          <div className="mt-1 flex gap-2">
            <input data-testid="ci-purchase-price" type="number" min="0" step="0.01" value={form.purchasePriceValue}
              onChange={(e) => setForm((f) => ({ ...f, purchasePriceValue: e.target.value }))} placeholder="待补（0 也是有效值）" className={inputCls} />
            <select aria-label="采购价币种" value={form.purchasePriceCurrency}
              onChange={(e) => setForm((f) => ({ ...f, purchasePriceCurrency: e.target.value as "CNY" | "USD" }))} className={inputCls}>
              <option value="CNY">CNY</option><option value="USD">USD</option>
            </select>
          </div>
        </label>
        <label className="min-w-0">
          <span className="text-xs font-semibold text-slate-600">MOQ（正整数）</span>
          <input data-testid="ci-moq" type="number" min="1" step="1" value={form.moq}
            onChange={(e) => setForm((f) => ({ ...f, moq: e.target.value }))} placeholder="待补" className={`mt-1 ${inputCls}`} />
        </label>
        <label className="min-w-0">
          <span className="text-xs font-semibold text-slate-600">单件物流成本</span>
          <div className="mt-1 flex gap-2">
            <input data-testid="ci-logistics" type="number" min="0" step="0.01" value={form.logisticsValue}
              onChange={(e) => setForm((f) => ({ ...f, logisticsValue: e.target.value }))} placeholder="待补" className={inputCls} />
            <select aria-label="物流币种" value={form.logisticsCurrency}
              onChange={(e) => setForm((f) => ({ ...f, logisticsCurrency: e.target.value as "CNY" | "USD" }))} className={inputCls}>
              <option value="CNY">CNY</option><option value="USD">USD</option>
            </select>
          </div>
        </label>
        <label className="min-w-0">
          <span className="text-xs font-semibold text-slate-600">合规核对状态</span>
          <select data-testid="ci-compliance-status" value={form.complianceStatus}
            onChange={(e) => setForm((f) => ({ ...f, complianceStatus: e.target.value as CommercialInputsForm["complianceStatus"] }))} className={`mt-1 ${inputCls}`}>
            <option value="not_reviewed">未核对</option>
            <option value="reviewed_ok">已核对，无问题</option>
            <option value="issues_found">有问题待处理</option>
          </select>
        </label>
        <label className="min-w-0 sm:col-span-2">
          <span className="text-xs font-semibold text-slate-600">依据备注（≤500 字）</span>
          <textarea data-testid="ci-compliance-note" value={form.complianceNote} maxLength={500} rows={2}
            onChange={(e) => setForm((f) => ({ ...f, complianceNote: e.target.value }))} placeholder="待补：说明依据来源" className={`mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100`} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={saving || !loaded}
          className="linear-button-primary inline-flex h-9 items-center px-4 text-sm font-semibold disabled:opacity-50" data-testid="ci-save">
          {saving ? "保存中…" : "保存资料"}
        </button>
        {message ? <span className="text-xs font-semibold text-emerald-700" data-testid="ci-message">{message}</span> : null}
        {error ? <span className="text-xs font-semibold text-rose-700" data-testid="ci-error">{error}</span> : null}
      </div>
    </section>
  );
}
