"use client";

/**
 * V3.3 — 浏览器 Evidence 采集区（Browser Evidence Connector）
 *
 * 流程：读取已保存快照 → 采集（服务端受控浏览器导航任务绑定 ASIN 单页）→
 * Preview 人工确认 → 保存（confirmed:true + 并发保护）。
 *
 * 安全：Preview 由服务端生成并缓存，客户端字段值不被信任；
 * ASIN 三一致由服务端硬门禁；CAPTCHA/登录墙 fail-closed 明确提示；
 * 无"仍然保存"按钮。字段性质全部为 snapshot（capturedAt 页面观察值）。
 */
import { useCallback, useEffect, useState } from "react";
import { Camera, Check, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { buildAccessHeaders } from "@/lib/client/accessToken";
import type { AcquisitionCapabilityView } from "@/lib/client/acquisitionCapability";
import { CapabilityNotice } from "@/components/evidence/CapabilityNotice";

function buildFetchHeaders(extra?: Record<string, string>): Headers {
  return new Headers({ ...buildAccessHeaders(), ...extra });
}

/* ── 前端投影类型（安全子集；不引入 server-only 模块） ── */

export type BrowserSnapshotFieldView = {
  value: string | number | null;
  status: "correct" | "unknown";
  reason: string | null;
};

export type BrowserSnapshotView = {
  evidenceId: string;
  pageUrl: string;
  currency: "USD" | "JPY" | "other" | null;
  entityBound: boolean;
  capturedAt: string;
  confirmedBy: { mode: "owner" | "visitor"; actorRef: string };
  fields: {
    asin: BrowserSnapshotFieldView;
    title: BrowserSnapshotFieldView;
    price: BrowserSnapshotFieldView;
    bsr: BrowserSnapshotFieldView;
    rating: BrowserSnapshotFieldView;
    reviewCount: BrowserSnapshotFieldView;
  };
  failureReasons: string[];
};

export type BrowserEvidenceView = {
  schema: string;
  version: number;
  candidateId: string | null;
  targetAsin: string | null;
  snapshots: BrowserSnapshotView[];
  updatedAt: string;
};

export type BrowserCollectPreviewView = {
  extraction: {
    schemaVersion: string;
    expectedAsin: string | null;
    urlAsin: string | null;
    pageAsin: string | null;
    entityBound: boolean;
    bindingProof: { urlMatchesExpected: boolean; pageAnchorMatchesExpected: boolean; productContainerFound: boolean };
    pageStatus: string;
    fields: Record<string, BrowserSnapshotFieldView>;
    capturedAt: string;
    collectorVersion: string;
  };
  navigation: {
    finalUrl: string;
    httpStatus: number | null;
    navigationElapsedMs: number;
  };
  /** 采集前环境校准结果（币种/配送地） */
  calibration: {
    attempted: boolean;
    deliveryConfirmed: boolean;
    deliveryRegion: string | null;
    currencyPreference: string | null;
    usdPreferencesConfirmed: boolean;
  } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string | null = ""): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseFieldView(value: unknown): BrowserSnapshotFieldView | null {
  if (!isRecord(value)) return null;
  if (value.status !== "correct" && value.status !== "unknown") return null;
  const raw = value.value;
  return {
    value: raw === null ? null : (typeof raw === "number" || typeof raw === "string" ? raw : null),
    status: value.status,
    reason: typeof value.reason === "string" ? value.reason : null,
  };
}

export function parseBrowserEvidenceView(value: unknown): BrowserEvidenceView | null {
  if (!isRecord(value) || value.schema !== "browser-evidence.v1" || value.version !== 1) return null;
  if (!Array.isArray(value.snapshots)) return null;
  const snapshots: BrowserSnapshotView[] = [];
  for (const raw of value.snapshots) {
    const snapshot = parseSnapshotView(raw);
    if (!snapshot) return null;
    snapshots.push(snapshot);
  }
  return {
    schema: "browser-evidence.v1",
    version: 1,
    candidateId: asString(value.candidateId, null) ?? null,
    targetAsin: asString(value.targetAsin, null) ?? null,
    snapshots,
    updatedAt: asString(value.updatedAt) ?? "",
  };
}

function parseSnapshotView(value: unknown): BrowserSnapshotView | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.fields)) return null;
  const asin = parseFieldView(value.fields.asin);
  const title = parseFieldView(value.fields.title);
  const price = parseFieldView(value.fields.price);
  const bsr = parseFieldView(value.fields.bsr);
  const rating = parseFieldView(value.fields.rating);
  const reviewCount = parseFieldView(value.fields.reviewCount);
  if (!asin || !title || !price || !bsr || !rating || !reviewCount) return null;
  const confirmedBy = isRecord(value.confirmedBy)
    ? {
        mode: value.confirmedBy.mode === "owner" ? ("owner" as const) : ("visitor" as const),
        actorRef: asString(value.confirmedBy.actorRef) ?? "",
      }
    : null;
  if (!confirmedBy) return null;
  const currency = value.currency === "USD" || value.currency === "JPY" || value.currency === "other"
    ? value.currency
    : null;
  return {
    evidenceId: asString(value.evidenceId) ?? "",
    pageUrl: asString(value.pageUrl) ?? "",
    currency,
    entityBound: value.entityBinding === true || (isRecord(value.entityBinding) && value.entityBinding.bound === true),
    capturedAt: asString(value.capturedAt) ?? "",
    confirmedBy,
    fields: { asin, title, price, bsr, rating, reviewCount },
    failureReasons: Array.isArray(value.failureReasons)
      ? value.failureReasons.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function parseBrowserCollectPreviewView(value: unknown): BrowserCollectPreviewView | null {
  if (!isRecord(value)) return null;
  const extraction = isRecord(value.extraction) ? value.extraction : null;
  const navigation = isRecord(value.navigation) ? value.navigation : null;
  if (!extraction || !navigation) return null;
  const fields: Record<string, BrowserSnapshotFieldView> = {};
  if (isRecord(extraction.fields)) {
    for (const [key, raw] of Object.entries(extraction.fields)) {
      const parsed = parseFieldView(raw);
      if (parsed) fields[key] = parsed;
    }
  }
  const bindingProof = isRecord(extraction.bindingProof)
    ? {
        urlMatchesExpected: extraction.bindingProof.urlMatchesExpected === true,
        pageAnchorMatchesExpected: extraction.bindingProof.pageAnchorMatchesExpected === true,
        productContainerFound: extraction.bindingProof.productContainerFound === true,
      }
    : { urlMatchesExpected: false, pageAnchorMatchesExpected: false, productContainerFound: false };
  return {
    extraction: {
      schemaVersion: asString(extraction.schemaVersion) ?? "",
      expectedAsin: asString(extraction.expectedAsin, null) ?? null,
      urlAsin: asString(extraction.urlAsin, null) ?? null,
      pageAsin: asString(extraction.pageAsin, null) ?? null,
      entityBound: extraction.entityBound === true,
      bindingProof,
      pageStatus: asString(extraction.pageStatus) ?? "",
      fields,
      capturedAt: asString(extraction.capturedAt) ?? "",
      collectorVersion: asString(extraction.collectorVersion) ?? "",
    },
    navigation: {
      finalUrl: asString(navigation.finalUrl) ?? "",
      httpStatus: asNumber(navigation.httpStatus),
      navigationElapsedMs: asNumber(navigation.navigationElapsedMs) ?? 0,
    },
    calibration: (() => {
      const raw = isRecord(value.calibration) ? value.calibration : null;
      if (!raw) return null;
      return {
        attempted: raw.attempted === true,
        deliveryConfirmed: raw.deliveryConfirmed === true,
        deliveryRegion: asString(raw.deliveryRegion, null) ?? null,
        currencyPreference: asString(raw.currencyPreference, null) ?? null,
        usdPreferencesConfirmed: raw.usdPreferencesConfirmed === true,
      };
    })(),
  };
}

/* ── 展示工具 ── */

const FIELD_LABELS: ReadonlyArray<{ key: keyof BrowserSnapshotView["fields"]; label: string }> = [
  { key: "asin", label: "ASIN" },
  { key: "title", label: "标题" },
  { key: "price", label: "价格(USD)" },
  { key: "bsr", label: "大类BSR" },
  { key: "rating", label: "评分" },
  { key: "reviewCount", label: "评论数" },
];

const REASON_LABELS: Record<string, string> = {
  selector_not_found: "页面未找到该字段（结构变化）",
  entity_binding_unproven: "实体绑定未证明，未采集",
  format_invalid: "页面文本无法解析",
  page_status_captcha: "页面要求验证码",
  page_status_login_wall: "页面要求登录",
  page_status_error_page: "页面返回错误页",
  page_status_unknown_page: "页面无法识别",
};

function reasonLabel(reason: string | null): string {
  if (!reason) return "";
  if (reason.startsWith("currency_not_usd")) return "页面币种非 USD，价格不保存";
  return REASON_LABELS[reason] ?? reason;
}

/** P1-E：提取器字段命名（reviews）→ 快照命名（reviewCount），与服务端 buildConfirmedSnapshot 一致 */
export function normalizePreviewFields(
  fields: Record<string, BrowserSnapshotFieldView | undefined>,
): BrowserSnapshotView["fields"] {
  return {
    asin: fields.asin ?? { value: null, status: "unknown", reason: "selector_not_found" },
    title: fields.title ?? { value: null, status: "unknown", reason: "selector_not_found" },
    price: fields.price ?? { value: null, status: "unknown", reason: "selector_not_found" },
    bsr: fields.bsr ?? { value: null, status: "unknown", reason: "selector_not_found" },
    rating: fields.rating ?? { value: null, status: "unknown", reason: "selector_not_found" },
    reviewCount: fields.reviewCount ?? fields.reviews ?? { value: null, status: "unknown", reason: "selector_not_found" },
  };
}

function CurrencyNote({ currency }: { currency: "USD" | "JPY" | "other" | null }) {
  if (currency === "USD" || currency === null) return null;
  const label = currency === "JPY" ? "日元" : "其他币种";
  return (
    <p className="text-xs text-amber-700">
      页面币种为{label}（{currency}），与目标市场不一致：本次不保存价格（fail-closed，防跨币种错存）。
    </p>
  );
}

function SnapshotFields({ fields }: { fields: BrowserSnapshotView["fields"] }) {
  return (
    <dl className="mt-2 grid gap-2 sm:grid-cols-2">
      {FIELD_LABELS.map(({ key, label }) => {
        const field = fields[key];
        // P1-E：提取器命名（reviews）与快照命名（reviewCount）在 Preview 路径已归一化；
        // 这里再防御一次——字段缺失渲染"未取得"而不是崩溃
        if (!field) {
          return (
            <div key={key} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">未取得</dd>
            </div>
          );
        }
        return (
          <div key={key} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="mt-0.5 text-sm font-semibold text-slate-900" title={reasonLabel(field.reason)}>
              {field.status === "correct" ? String(field.value ?? "") : "未取得"}
              {field.status === "unknown" && (
                <span className="ml-2 text-[11px] font-normal text-slate-400">{reasonLabel(field.reason)}</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function SnapshotCard({ snapshot, index }: { snapshot: BrowserSnapshotView; index: number }) {
  const capturedLabel = snapshot.capturedAt ? new Date(snapshot.capturedAt).toLocaleString("zh-CN") : "unknown";
  const confirmLabel = snapshot.confirmedBy.mode === "owner" ? "Owner 人工确认" : "Visitor 人工确认";
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="text-xs font-semibold text-slate-700">
          {index === 0 ? "最新快照" : `快照 #${index + 1}`} · {capturedLabel}
        </p>
        <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
          <ShieldCheck className="size-3" />浏览器采集 · {confirmLabel}
        </span>
      </div>
      <p className="mt-1 truncate text-xs text-slate-400" title={snapshot.pageUrl}>{snapshot.pageUrl}</p>
      <SnapshotFields fields={snapshot.fields} />
      <CurrencyNote currency={snapshot.currency} />
    </li>
  );
}

/* ── 主组件 ── */

export function BrowserEvidenceSection({
  taskId,
  evidence,
  taskAsin,
  storageVersion,
  capability,
  onChanged,
}: {
  taskId: string;
  evidence: BrowserEvidenceView | null;
  taskAsin: string | null;
  storageVersion: { resultJsonHash: string; updatedAt: string } | null;
  /** 浏览器采集能力（服务端 capability DTO；local_env_required → 按钮禁用 + 产品提示） */
  capability?: AcquisitionCapabilityView | null;
  onChanged: () => void;
}) {
  const [collecting, setCollecting] = useState(false);
  const [preview, setPreview] = useState<BrowserCollectPreviewView | null>(null);
  const [previewEvidenceId, setPreviewEvidenceId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const canCollect = capability?.state === "available";

  async function collect() {
    if (!canCollect) return;
    setCollecting(true);
    setError("");
    setPreview(null);
    setPreviewEvidenceId(null);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/browser-evidence`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "collect" }),
        signal: AbortSignal.timeout(60_000),
      });
      const json = await res.json() as
        | { ok: true; data: { preview: unknown; evidenceId: string } }
        | { ok: false; error?: { code?: string; message?: string } };
      if (!res.ok || !json.ok) {
        setError((json as { error?: { message?: string } }).error?.message ?? "采集失败，请重试。");
        return;
      }
      const parsed = parseBrowserCollectPreviewView(json.data.preview);
      if (!parsed) {
        setError("采集返回的数据无法解析，请重试。");
        return;
      }
      setPreview(parsed);
      setPreviewEvidenceId(json.data.evidenceId);
    } catch {
      setError("采集失败，请重试。");
    } finally {
      setCollecting(false);
    }
  }

  async function confirmSave() {
    if (!previewEvidenceId || !storageVersion) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/browser-evidence`, {
        method: "POST",
        headers: buildFetchHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          signal: AbortSignal.timeout(60_000),
          action: "save",
          evidenceId: previewEvidenceId,
          expectedStorageVersion: storageVersion,
        }),
      });
      const json = await res.json() as
        | { ok: true }
        | { ok: false; error?: { code?: string; message?: string } };
      if (!res.ok || !json.ok) {
        setError((json as { error?: { message?: string } }).error?.message ?? "保存失败，请重试。");
        setPreview(null);
        setPreviewEvidenceId(null);
        return;
      }
      setPreview(null);
      setPreviewEvidenceId(null);
      onChanged();
    } catch {
      setError("保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  const pageOk = preview?.extraction.pageStatus === "ok";
  const canConfirm = preview !== null && pageOk && preview.extraction.entityBound && !saving;

  return (
    <section data-testid="workbench-browser-evidence" className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">浏览器 Evidence（Amazon 商品详情页）</h3>
        <button
          type="button"
          disabled={collecting || saving || !canCollect}
          onClick={() => void collect()}
          className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          {collecting ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          {collecting ? "采集中…" : "采集页面证据"}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        自动打开本机受控浏览器，导航到任务绑定商品页（{taskAsin ?? "未绑定 ASIN"}）单页提取 6 个字段；
        结果先预览、人工确认后才保存。不自动搜索、不批量、不绕验证码。
      </p>

      {/* Acquisition Capability（§8/§10）：公网环境不提供实时采集 → 明确提示，不显示"采集失败" */}
      <CapabilityNotice
        capability={capability}
        localEnvMessage="实时页面采集需要在本地研究环境使用。已保存的页面证据仍可正常查看。"
        unavailableMessage={capability?.reasonCategory === "not_installed"
          ? "本机未检测到可用的 Chrome/Edge 浏览器，无法进行页面采集。"
          : "浏览器采集当前暂不可用。"}
      />

      {!taskAsin && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          当前任务缺少 Amazon 商品身份信息（productUrl / ASIN），无法采集。SellerSprite 导入的候选会自动继承商品链接；如仍缺失，请返回候选商品补充 Amazon 商品来源后再开始研究。
        </p>
      )}

      {/* Preview（服务端生成） */}
      {preview && (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <p className="text-xs font-bold text-indigo-800">采集预览（尚未保存）</p>
            <span className="text-[11px] text-slate-500">
              采集时间 {new Date(preview.extraction.capturedAt).toLocaleString("zh-CN")} · 耗时 {preview.navigation.navigationElapsedMs}ms
            </span>
          </div>
          {pageOk && preview.extraction.entityBound ? (
            <>
              <p className="mt-1 text-xs text-teal-700">
                实体绑定已证明（URL ASIN = 页面 ASIN = 目标 ASIN），6 个字段为页面观察快照。
              </p>
              {/* 币种环境校准状态（Amazon US 采集前自动切配送地/USD 偏好） */}
              {preview.calibration?.attempted ? (
                preview.calibration.usdPreferencesConfirmed
                  ? (
                    <p className="mt-1 text-xs text-teal-700" data-testid="calibration-usd-ok">
                      已校准美国配送与币种（配送地：{preview.calibration.deliveryRegion ?? "美国"} · 币种偏好：{preview.calibration.currencyPreference ?? "USD"}）。
                    </p>
                  )
                  : (
                    <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700" data-testid="calibration-not-usd">
                      已尝试自动校准，但当前仍不是 Amazon US 价格环境
                      {preview.calibration.deliveryRegion ? `（配送地：${preview.calibration.deliveryRegion}）` : ""}。
                      价格不会保存（fail-closed）；请确认本机网络/代理为美国节点后重试。
                    </p>
                  )
              ) : null}
              <SnapshotFields fields={normalizePreviewFields(preview.extraction.fields)} />
              <CurrencyNote
                currency={
                  preview.extraction.fields.price?.reason?.startsWith("currency_not_usd")
                    ? (preview.extraction.fields.price.reason.split(":")[1] as "JPY" | "other" | null) ?? "other"
                    : preview.extraction.fields.price?.status === "correct" ? "USD" : null
                }
              />
              <button
                type="button"
                disabled={!canConfirm}
                onClick={() => void confirmSave()}
                className="mt-3 inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {saving ? "保存中…" : "我确认这是目标商品，保存证据"}
              </button>
            </>
          ) : (
            <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              页面未通过身份检查（{preview.extraction.pageStatus}），已 fail-closed 停止，本次不保存任何字段。
              请在本机浏览器手动打开该商品页确认后重试。
            </p>
          )}
          {preview.navigation.finalUrl && (
            <p className="mt-2 truncate text-[11px] text-slate-400" title={preview.navigation.finalUrl}>
              最终页面：{preview.navigation.finalUrl}
            </p>
          )}
        </div>
      )}

      {/* 已保存快照 */}
      {evidence && evidence.snapshots.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {evidence.snapshots.map((snapshot, index) => (
            <SnapshotCard key={snapshot.evidenceId} snapshot={snapshot} index={index} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-500">尚未保存浏览器证据。</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
        <span>字段全部为快照（观察值，带采集时间），与 XLSX Evidence 并存不覆盖。</span>
        <button
          type="button"
          onClick={onChanged}
          className="inline-flex items-center gap-1 text-slate-500 underline hover:text-slate-700"
        >
          <RefreshCw className="size-3" />刷新
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </section>
  );
}
