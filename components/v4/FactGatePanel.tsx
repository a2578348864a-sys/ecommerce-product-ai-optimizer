/**
 * V4 P3 — FactGatePanel（Product Fact Gate 逐项事实确认 UI，B 工作树）。
 *
 * 纯展示 + 受控交互组件：通过 props 注入事实列表与回调，不直接写库。
 * 按 SKU/variant 分组逐项确认（材质/尺寸/颜色/功能/包装/数量/配件/限制）；
 * 操作 = confirm / reject / unknown / conflict / revoke。
 * 禁止一键全确认关键字段：不提供“全部确认”按钮，每项独立提交。
 *
 * 校验门禁与冻结契约 lib/v4/factStore.ts 的 validateFactConfirmation 对齐：
 *  - confirm 必须携带 confirmationMethod 且至少有 claimRefs 或 documentRefs；
 *  - conflict 必须携带 otherValue；
 *  - revoke 必须携带 reason。
 *
 * 服务端最终仍以 validator 为准，本组件只在 UI 层做前置禁用提示。
 */

import { useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, RotateCcw, XCircle } from "lucide-react";
import { FactStatusBadge, type DisplayFactStatus } from "./FactStatusBadge";

export const CONFIRMATION_METHODS = ["document", "sample", "expert", "other"] as const;
export type ConfirmationMethod = (typeof CONFIRMATION_METHODS)[number];

export const CONFIRMATION_METHOD_LABELS: Record<ConfirmationMethod, string> = {
  document: "文件/文档",
  sample: "样品",
  expert: "专家",
  other: "其他",
};

const FACT_FIELD_LABELS: Record<string, string> = {
  material: "材质",
  size: "尺寸",
  color: "颜色",
  function: "功能",
  packaging: "包装",
  quantity: "数量",
  accessories: "配件",
  restriction: "限制",
};

/** 已知字段的中文标签；未知字段回退到原始字段名。 */
export function factFieldLabel(field: string): string {
  return FACT_FIELD_LABELS[field] ?? field;
}

/** 把逗号/分号/换行分隔的引用文本解析为引用 id 数组（去空、去首尾空白）。 */
export function parseRefs(text: string): string[] {
  return text
    .split(/[,，;；\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** confirm 可提交：已选方法，且 claimRefs 或 documentRefs 至少一项。 */
export function canConfirmSubmit(method: ConfirmationMethod | "", claimRefs: string[], documentRefs: string[]): boolean {
  return method !== "" && (claimRefs.length > 0 || documentRefs.length > 0);
}

/** conflict 可提交：otherValue 非空。 */
export function canConflictSubmit(otherValue: string): boolean {
  return otherValue.trim().length > 0;
}

/** revoke 可提交：reason 非空。 */
export function canRevokeSubmit(reason: string): boolean {
  return reason.trim().length > 0;
}

export type FactGateItem = {
  /** 稳定唯一 key（React + 回调定位）。 */
  key: string;
  /** 具体 variant（SKU/规格指纹），用于分组。 */
  variantKey: string;
  variantLabel?: string;
  /** 字段名（material/size/…）或任意字段。 */
  field: string;
  /** 当前展示值。 */
  value: string;
  /** 当前状态；undefined 表示待确认（尚未写入任何事实记录）。 */
  status?: DisplayFactStatus;
  /** 当前 revision（从未确认时为空）。 */
  revision?: number;
  /** 最近一次操作的 actor。 */
  actor?: string;
  /** 最近一次操作的时间（ISO 字符串，展示用）。 */
  updatedAt?: string;
  confirmationMethod?: ConfirmationMethod | null;
  claimRefs?: string[];
  documentRefs?: string[];
  revokedByRevision?: number | null;
  /** 撤销原因（detail.reason），revoked 时展示。 */
  revocationReason?: string;
};

export type FactGateGroup = {
  variantKey: string;
  variantLabel?: string;
  items: FactGateItem[];
};

export type FactGateCallbacks = {
  onConfirm: (item: FactGateItem, payload: { confirmationMethod: ConfirmationMethod; claimRefs: string[]; documentRefs: string[] }) => void;
  onReject: (item: FactGateItem, payload: { reason?: string }) => void;
  onUnknown: (item: FactGateItem) => void;
  onConflict: (item: FactGateItem, payload: { otherValue: string }) => void;
  onRevoke: (item: FactGateItem, payload: { reason: string }) => void;
};

export type FactGatePanelProps = {
  items: FactGateItem[];
  /** 整面板禁用（如提交中/只读）。 */
  disabled?: boolean;
} & FactGateCallbacks;

/** 按 variantKey 分组，组内按字段名排序，保持组首次出现顺序。 */
export function groupFactsByVariant(items: FactGateItem[]): FactGateGroup[] {
  const groups = new Map<string, FactGateGroup>();
  for (const item of items) {
    const key = item.variantKey;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, { variantKey: key, variantLabel: item.variantLabel, items: [item] });
    }
  }
  return [...groups.values()].map((g) => ({
    ...g,
    items: [...g.items].sort((a, b) => a.field.localeCompare(b.field)),
  }));
}

// ─── 受控子表单（导出以便独立测试禁用/校验门禁） ─────────────────────────

export function FactConfirmForm(props: {
  confirmationMethod: ConfirmationMethod | "";
  claimRefsText: string;
  documentRefsText: string;
  onConfirmationMethodChange: (m: ConfirmationMethod) => void;
  onClaimRefsTextChange: (v: string) => void;
  onDocumentRefsTextChange: (v: string) => void;
  onSubmit: (payload: { confirmationMethod: ConfirmationMethod; claimRefs: string[]; documentRefs: string[] }) => void;
  disabled?: boolean;
}) {
  const claimRefs = parseRefs(props.claimRefsText);
  const documentRefs = parseRefs(props.documentRefsText);
  const canSubmit = !props.disabled && canConfirmSubmit(props.confirmationMethod, claimRefs, documentRefs);
  return (
    <div className="space-y-2" data-testid="fact-confirm-form">
      <label className="block text-xs font-semibold text-slate-500">
        确认方法
        <select
          value={props.confirmationMethod}
          onChange={(e) => props.onConfirmationMethodChange(e.target.value as ConfirmationMethod)}
          disabled={props.disabled}
          data-testid="fact-confirm-method"
          className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-50"
        >
          <option value="" disabled>
            请选择确认方法
          </option>
          {CONFIRMATION_METHODS.map((m) => (
            <option key={m} value={m}>
              {CONFIRMATION_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-semibold text-slate-500">
        主张引用（claimRefs，逗号分隔）
        <input
          type="text"
          value={props.claimRefsText}
          onChange={(e) => props.onClaimRefsTextChange(e.target.value)}
          disabled={props.disabled}
          data-testid="fact-confirm-claimrefs"
          placeholder="如 claim-1, claim-2"
          className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-50"
        />
      </label>
      <label className="block text-xs font-semibold text-slate-500">
        文档引用（documentRefs，逗号分隔）
        <input
          type="text"
          value={props.documentRefsText}
          onChange={(e) => props.onDocumentRefsTextChange(e.target.value)}
          disabled={props.disabled}
          data-testid="fact-confirm-docrefs"
          placeholder="如 doc-1, sample-2"
          className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-50"
        />
      </label>
      <button
        type="button"
        disabled={!canSubmit}
        onClick={() =>
          props.onSubmit({
            confirmationMethod: props.confirmationMethod as ConfirmationMethod,
            claimRefs,
            documentRefs,
          })
        }
        data-testid="fact-confirm-submit"
        className="linear-button-primary inline-flex h-9 items-center gap-1.5 px-3 text-sm font-semibold disabled:opacity-50"
      >
        <CheckCircle2 className="size-4" />
        确认该事实
      </button>
      {props.confirmationMethod === "" && !props.disabled && (
        <p className="text-xs text-amber-600" data-testid="fact-confirm-hint">
          需先选择确认方法，并提供至少一个引用（主张或文档）才能确认。
        </p>
      )}
    </div>
  );
}

export function FactConflictForm(props: {
  otherValue: string;
  onOtherValueChange: (v: string) => void;
  onSubmit: (payload: { otherValue: string }) => void;
  disabled?: boolean;
}) {
  const canSubmit = !props.disabled && canConflictSubmit(props.otherValue);
  return (
    <div className="space-y-2" data-testid="fact-conflict-form">
      <label className="block text-xs font-semibold text-slate-500">
        对方值（otherValue）
        <input
          type="text"
          value={props.otherValue}
          onChange={(e) => props.onOtherValueChange(e.target.value)}
          disabled={props.disabled}
          data-testid="fact-conflict-othervalue"
          placeholder="如 304 不锈钢 / 1000ml / 2 件装"
          className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-50"
        />
      </label>
      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => props.onSubmit({ otherValue: props.otherValue.trim() })}
        data-testid="fact-conflict-submit"
        className="linear-button-primary inline-flex h-9 items-center gap-1.5 px-3 text-sm font-semibold disabled:opacity-50"
      >
        <AlertTriangle className="size-4" />
        记录冲突
      </button>
      {props.otherValue.trim() === "" && !props.disabled && (
        <p className="text-xs text-amber-600" data-testid="fact-conflict-hint">
          需填写与当前值冲突的另一方取值才能记录冲突。
        </p>
      )}
    </div>
  );
}

export function FactRevokeForm(props: {
  reason: string;
  onReasonChange: (v: string) => void;
  onSubmit: (payload: { reason: string }) => void;
  disabled?: boolean;
}) {
  const canSubmit = !props.disabled && canRevokeSubmit(props.reason);
  return (
    <div className="space-y-2" data-testid="fact-revoke-form">
      <label className="block text-xs font-semibold text-slate-500">
        撤销原因
        <input
          type="text"
          value={props.reason}
          onChange={(e) => props.onReasonChange(e.target.value)}
          disabled={props.disabled}
          data-testid="fact-revoke-reason-input"
          placeholder="如 页面为宣传 304，未获样品/文件证实"
          className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-50"
        />
      </label>
      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => props.onSubmit({ reason: props.reason.trim() })}
        data-testid="fact-revoke-submit"
        className="linear-button inline-flex h-9 items-center gap-1.5 px-3 text-sm font-semibold disabled:opacity-50"
      >
        <RotateCcw className="size-4" />
        撤销该事实
      </button>
      {props.reason.trim() === "" && !props.disabled && (
        <p className="text-xs text-amber-600" data-testid="fact-revoke-hint">
          撤销需填写原因，以便后续复盘。
        </p>
      )}
    </div>
  );
}

// ─── 内部子表单（驳回/未知，无需额外门禁） ───────────────────────────────

function FactRejectForm(props: { reason: string; onReasonChange: (v: string) => void; onSubmit: (reason?: string) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2" data-testid="fact-reject-form">
      <label className="block text-xs font-semibold text-slate-500">
        驳回原因（可选）
        <input
          type="text"
          value={props.reason}
          onChange={(e) => props.onReasonChange(e.target.value)}
          disabled={props.disabled}
          data-testid="fact-reject-reason"
          placeholder="如 与实物样品不符"
          className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-50"
        />
      </label>
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => props.onSubmit(props.reason.trim() || undefined)}
        data-testid="fact-reject-submit"
        className="linear-button inline-flex h-9 items-center gap-1.5 px-3 text-sm font-semibold disabled:opacity-50"
      >
        <XCircle className="size-4" />
        驳回该事实
      </button>
    </div>
  );
}

function FactUnknownForm(props: { onSubmit: () => void; disabled?: boolean }) {
  return (
    <div className="space-y-2" data-testid="fact-unknown-form">
      <p className="text-xs leading-5 text-slate-500">标记为未知：不采信该值，也不作为事实继续推进。</p>
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onSubmit}
        data-testid="fact-unknown-submit"
        className="linear-button inline-flex h-9 items-center gap-1.5 px-3 text-sm font-semibold disabled:opacity-50"
      >
        <HelpCircle className="size-4" />
        标记为未知
      </button>
    </div>
  );
}

// ─── 单项行（内部，持有该项的交互草稿状态） ───────────────────────────────

type Action = "confirm" | "reject" | "unknown" | "conflict" | "revoke";

const ACTION_ORDER: Action[] = ["confirm", "reject", "unknown", "conflict", "revoke"];

const ACTION_LABELS: Record<Action, string> = {
  confirm: "确认",
  reject: "驳回",
  unknown: "未知",
  conflict: "冲突",
  revoke: "撤销",
};

function FactItemRow(props: { item: FactGateItem; callbacks: FactGateCallbacks; disabled?: boolean }) {
  const { item, callbacks, disabled } = props;
  const isRevoked = item.status === "revoked";
  const [action, setAction] = useState<Action>("confirm");
  const [method, setMethod] = useState<ConfirmationMethod | "">("");
  const [claimRefsText, setClaimRefsText] = useState("");
  const [documentRefsText, setDocumentRefsText] = useState("");
  const [otherValue, setOtherValue] = useState("");
  const [reason, setReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  return (
    <li
      className={`rounded-xl border p-4 ${
        isRevoked ? "border-slate-200 bg-slate-50/60 opacity-60" : "border-slate-100 bg-white/85"
      }`}
      data-testid="fact-item"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">{factFieldLabel(item.field)}</span>
            {item.status && <FactStatusBadge status={item.status} />}
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-700" data-testid="fact-value">
            {item.value || "—"}
          </p>
          <p className="mt-1 text-xs text-slate-400" data-testid="fact-meta">
            修订 {item.revision ?? "—"}
            {item.actor ? ` · 操作者 ${item.actor}` : ""}
            {item.updatedAt ? ` · ${item.updatedAt}` : ""}
          </p>
          {item.confirmationMethod && (
            <p className="mt-0.5 text-xs text-slate-400" data-testid="fact-method">
              确认方法：{CONFIRMATION_METHOD_LABELS[item.confirmationMethod]}
            </p>
          )}
          {isRevoked && item.revocationReason && (
            <p className="mt-1 text-xs text-slate-500" data-testid="fact-revoke-reason">
              撤销原因：{item.revocationReason}
            </p>
          )}
        </div>
      </div>

      {isRevoked ? (
        <p className="mt-2 text-xs text-slate-400">该事实已被撤销，不再作为当前事实。</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {ACTION_ORDER.map((a) => (
              <button
                key={a}
                type="button"
                disabled={disabled}
                onClick={() => setAction(a)}
                data-testid={`fact-action-${a}`}
                className={`inline-flex h-9 items-center gap-1.5 px-3 text-sm font-semibold disabled:opacity-50 ${
                  action === a ? "linear-button-primary" : "linear-button-soft"
                }`}
              >
                {ACTION_LABELS[a]}
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
            {action === "confirm" && (
              <FactConfirmForm
                confirmationMethod={method}
                claimRefsText={claimRefsText}
                documentRefsText={documentRefsText}
                onConfirmationMethodChange={setMethod}
                onClaimRefsTextChange={setClaimRefsText}
                onDocumentRefsTextChange={setDocumentRefsText}
                onSubmit={(payload) => callbacks.onConfirm(item, payload)}
                disabled={disabled}
              />
            )}
            {action === "reject" && (
              <FactRejectForm
                reason={rejectReason}
                onReasonChange={setRejectReason}
                onSubmit={(r) => callbacks.onReject(item, { reason: r })}
                disabled={disabled}
              />
            )}
            {action === "unknown" && <FactUnknownForm onSubmit={() => callbacks.onUnknown(item)} disabled={disabled} />}
            {action === "conflict" && (
              <FactConflictForm
                otherValue={otherValue}
                onOtherValueChange={setOtherValue}
                onSubmit={(payload) => callbacks.onConflict(item, payload)}
                disabled={disabled}
              />
            )}
            {action === "revoke" && (
              <FactRevokeForm
                reason={reason}
                onReasonChange={setReason}
                onSubmit={(payload) => callbacks.onRevoke(item, payload)}
                disabled={disabled}
              />
            )}
          </div>
        </>
      )}
    </li>
  );
}

// ─── 主组件 ──────────────────────────────────────────────────────────────

export function FactGatePanel(props: FactGatePanelProps) {
  const { items, disabled, ...callbacks } = props;
  const groups = groupFactsByVariant(items);

  return (
    <section className="surface-card rounded-2xl p-4 sm:p-5" data-testid="fact-gate-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-950">产品事实确认（Product Fact Gate）</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            请逐项确认供应商主张是否成为产品事实。确认必须附带确认方法与引用；冲突需给出对方值；撤销需填写原因。
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="mt-4 rounded-xl border border-slate-100 bg-white/85 p-4 text-sm text-slate-500" data-testid="fact-empty">
          暂无可确认的产品事实。
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {groups.map((group) => (
            <div key={group.variantKey} data-testid="fact-group">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-lg bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700" data-testid="fact-variant">
                  Variant：{group.variantLabel ?? group.variantKey}
                </span>
                <span className="text-xs text-slate-400">{group.items.length} 项</span>
              </div>
              <ul className="space-y-3">
                {group.items.map((item) => (
                  <FactItemRow key={item.key} item={item} callbacks={callbacks} disabled={disabled} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-slate-400" data-testid="fact-no-confirm-all">
        关键属性需逐项人工确认，本页面不提供一键全选确认。
      </p>
    </section>
  );
}
