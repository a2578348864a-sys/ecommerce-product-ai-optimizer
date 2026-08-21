"use client";

/**
 * V4.1 — 访客独立演示沙盒：「亲自体验这个决策」面板（仅 UI + fetch，接口由服务端实现）。
 *
 * 契约（只做 UI 与 fetch，接口由根 Agent 在服务端实现）：
 *   - 读：GET   /api/replay/demo-choice?bundleId=...
 *   - 写：POST  /api/replay/demo-choice?bundleId=...   body: { gateA?, gateB?, note? }
 *   - 重置：DELETE /api/replay/demo-choice?bundleId=...
 *
 * 边界：
 *   - 仅影响当前访客的演示沙盒，绝不修改公开案例（页面上明确标注）。
 *   - 接口不可用（GET 失败/404/403）→ 显示「仅公开演示访客可用（本地模式不启用）」诚实空态。
 *   - 不写任何 Owner 正式数据；组件零路由/零权限逻辑。
 */
import { useEffect, useState } from "react";
import { GATE_DECISION_LABELS } from "./replay-resolvers";

export type ReplayDemoChoiceStatus = "loading" | "ready" | "unavailable";

export type ReplayDemoChoiceState = {
  gateA?: string;
  gateB?: string;
  note?: string;
};

const GATE_A_OPTIONS = ["continue_sourcing", "needs_information", "abandon"];
const GATE_B_OPTIONS = ["content_ready", "revise_product", "request_revision", "reject_asset"];

function gateLabel(decision: string): string {
  return GATE_DECISION_LABELS[decision] ?? decision;
}

export type ReplayDemoChoicePanelProps = {
  bundleId: string;
  /** 服务端 cookie 门控：访客身份已建立时才与沙盒接口交互（未建立不请求，避免 401 console error）。 */
  guested?: boolean;
  /** 仅测试用：跳过真实 fetch，直接以指定状态（loading/ready/unavailable）渲染。 */
  initialStatus?: ReplayDemoChoiceStatus;
  /** 仅测试用：注入初始选择。 */
  initialState?: ReplayDemoChoiceState;
};

export function ReplayDemoChoicePanel({
  bundleId,
  guested = false,
  initialStatus,
  initialState,
}: ReplayDemoChoicePanelProps) {
  const [status, setStatus] = useState<ReplayDemoChoiceStatus>(initialStatus ?? "loading");
  const [choice, setChoice] = useState<ReplayDemoChoiceState>(initialState ?? {});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (initialStatus && initialStatus !== "loading") return;
    if (!guested) {
      setStatus("unavailable");
      return;
    }
    let alive = true;
    // 仅公开演示访客（public_showcase）启用；本地等模式显示不可用（不发起 demo-choice 请求，避免 403 console error）。
    fetch("/api/runtime-mode", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!alive) return;
        if (!json?.ok || json.mode !== "public_showcase") {
          setStatus("unavailable");
          return;
        }
        const url = "/api/replay/demo-choice?bundleId=" + encodeURIComponent(bundleId);
        return fetch(url, { headers: { Accept: "application/json" } })
          .then(async (res) => {
            if (!alive) return;
            if (!res.ok) {
              setStatus("unavailable");
              return;
            }
            const data = (await res.json().catch(() => null)) as ReplayDemoChoiceState | null;
            setChoice(data ?? {});
            setStatus("ready");
          });
      })
      .catch(() => {
        if (alive) setStatus("unavailable");
      });
    return () => {
      alive = false;
    };
  }, [bundleId, initialStatus]);

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/replay/demo-choice?bundleId=" + encodeURIComponent(bundleId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gateA: choice.gateA, gateB: choice.gateB, note: choice.note }),
      });
      if (res.ok) {
        setMessage("已保存到我的访客演示沙盒");
        setStatus("ready");
      } else {
        setMessage("保存失败，请稍后再试");
      }
    } catch {
      setMessage("保存失败（接口不可用）");
      setStatus("unavailable");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/replay/demo-choice?bundleId=" + encodeURIComponent(bundleId), {
        method: "DELETE",
      });
      if (res.ok) {
        setMessage("已重置，恢复默认示例决策");
        setChoice({});
      } else {
        setMessage("重置失败，请稍后再试");
      }
    } catch {
      setMessage("重置失败（接口不可用）");
      setStatus("unavailable");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      data-testid="replay-demo-choice"
      aria-label="亲自体验这个决策"
      className="rounded-2xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-900">亲自体验这个决策</h2>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
          访客演示沙盒
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        仅影响我的访客演示沙盒，绝不修改公开案例。你的选择只保存在自己的演示会话中，不会改动上方脱敏案例。
      </p>

      {status === "unavailable" ? (
        <p data-testid="replay-demo-choice-unavailable" className="mt-3 text-sm text-slate-400">
          请先进入公开演示建立访客身份（返回首页点击体验入口），或当前模式未启用演示沙盒。
        </p>
      ) : status === "loading" ? (
        <p data-testid="replay-demo-choice-loading" className="mt-3 text-sm text-slate-400">
          正在连接演示沙盒…
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Gate A 决策</span>
            <select
              data-testid="replay-demo-gate-a"
              value={choice.gateA ?? ""}
              onChange={(e) => setChoice((c) => ({ ...c, gateA: e.target.value }))}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700"
            >
              <option value="">—— 选择 ——</option>
              {GATE_A_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {gateLabel(o)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Gate B 决策</span>
            <select
              data-testid="replay-demo-gate-b"
              value={choice.gateB ?? ""}
              onChange={(e) => setChoice((c) => ({ ...c, gateB: e.target.value }))}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700"
            >
              <option value="">—— 选择 ——</option>
              {GATE_B_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {gateLabel(o)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-700">备注</span>
            <textarea
              data-testid="replay-demo-note"
              value={choice.note ?? ""}
              onChange={(e) => setChoice((c) => ({ ...c, note: e.target.value }))}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
              placeholder="可选：记录你的判断依据"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="replay-demo-save"
              disabled={saving}
              onClick={save}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-teal-300 bg-teal-50 px-3 text-sm font-semibold text-teal-700 transition hover:bg-teal-100 disabled:opacity-40"
            >
              保存到沙盒
            </button>
            <button
              type="button"
              data-testid="replay-demo-reset"
              disabled={saving}
              onClick={reset}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              重置
            </button>
            <span className="text-xs text-slate-400">刷新页面后仍会保留（保存在我的访客沙盒）。</span>
          </div>
          {message ? (
            <p data-testid="replay-demo-message" className="text-xs text-slate-500">
              {message}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
