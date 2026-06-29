"use client";

import { useState } from "react";
import {
  ArrowRight,
  Eye,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";

export interface LoginPageProps {
  onSubmit: (password: string) => Promise<void>;
  error: string;
  loading: boolean;
}

type LoginTab = "owner" | "guest";

const OWNER_PLACEHOLDER = "输入 Owner 密码";
const GUEST_PLACEHOLDER = "输入访客码";

export function LoginPage({ onSubmit, error, loading }: LoginPageProps) {
  const [ownerPassword, setOwnerPassword] = useState("");
  const [guestPassword, setGuestPassword] = useState("");
  const [activeTab, setActiveTab] = useState<LoginTab>("owner");

  function handleOwnerSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ownerPassword.trim() || loading) return;
    onSubmit(ownerPassword.trim());
  }

  function handleGuestSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!guestPassword.trim() || loading) return;
    onSubmit(guestPassword.trim());
  }

  function switchTab(tab: LoginTab) {
    if (loading) return;
    setActiveTab(tab);
  }

  const isOwner = activeTab === "owner";

  return (
    <div className="login-page-root">
      {/* ── Dynamic background layers (unchanged) ── */}
      <div className="login-bg" />
      <div className="login-orb login-orb-1" />
      <div className="login-orb login-orb-2" />
      <div className="login-orb login-orb-3" />
      <div className="login-grid" />

      {/* Floating abstract elements */}
      <div className="login-floater login-floater-1">
        <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/70 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          商品分析完成
        </div>
      </div>
      <div className="login-floater login-floater-2">
        <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/70 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
          <span className="size-1.5 rounded-full bg-sky-400" />
          AI 复核通过
        </div>
      </div>
      <div className="login-floater login-floater-3">
        <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/70 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
          <Sparkles className="size-3 text-teal-500" />
          Listing 草稿就绪
        </div>
      </div>

      {/* Light particles */}
      <div className="login-particle login-particle-1" />
      <div className="login-particle login-particle-2" />
      <div className="login-particle login-particle-3" />

      {/* ── Main content ── */}
      <div className="login-main z-10 flex w-full max-w-[900px] flex-col items-center gap-6 px-4">
        {/* Product identity */}
        <div className="text-center">
          <div className="login-brand-icon mx-auto mb-3">
            <Sparkles className="size-8" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            轻选 Agent
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">
            跨境电商运营 Agent 工作台
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-400 sm:text-sm">
            从机会发现、商品分析、风险预筛到 Listing 草稿与任务推进，
            帮助运营把重复判断沉淀为可复用工作流。
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              Alpha
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
              受控自动化
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
              人工复核
            </span>
          </div>
        </div>

        {/* ── Tab switcher (mobile-first) ── */}
        <div className="flex w-full max-w-md rounded-xl border border-slate-200 bg-slate-100 p-1 sm:hidden">
          <button
            type="button"
            onClick={() => switchTab("owner")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              isOwner
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            <User className="mr-1 inline size-3.5" />
            Owner
          </button>
          <button
            type="button"
            onClick={() => switchTab("guest")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              !isOwner
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            <Eye className="mr-1 inline size-3.5" />
            访客
          </button>
        </div>

        {/* ── Dual cards (desktop: side-by-side, mobile: single active) ── */}
        <div className="login-cards-grid">
          {/* Owner card */}
          <div className={`login-card-dual ${!isOwner ? "hidden sm:flex" : "flex"}`}>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
                <User className="size-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Owner 工作台</p>
                <p className="text-[11px] text-slate-400">完整权限 · 仅本人使用</p>
              </div>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              用于正式维护候选池、任务记录和 AI 工作流。
            </p>

            <form onSubmit={handleOwnerSubmit} className="mt-4 flex flex-col gap-3">
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  placeholder={OWNER_PLACEHOLDER}
                  disabled={loading}
                  autoFocus
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white/80 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 backdrop-blur transition focus:border-teal-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !ownerPassword.trim()}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 px-4 text-sm font-semibold text-white shadow-sm shadow-teal-200 transition hover:from-teal-600 hover:to-emerald-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <><Loader2 className="size-4 animate-spin" />验证中…</>
                ) : (
                  <>进入 Owner 工作台<ArrowRight className="size-4" /></>
                )}
              </button>
            </form>
          </div>

          {/* Guest card */}
          <div className={`login-card-dual ${isOwner ? "hidden sm:flex" : "flex"}`}>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                <Eye className="size-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">HR 演示模式</p>
                <p className="text-[11px] text-slate-400">完整流程沙盒体验</p>
              </div>
            </div>

            {/* Guest rules */}
            <div className="mb-3 space-y-1.5 rounded-lg border border-sky-100 bg-sky-50/60 p-2.5 text-[11px] leading-5 text-sky-800">
              <p>· 输入访客码即可登录</p>
              <p>· 首次登录后 <strong>24 小时</strong> 有效</p>
              <p>· 最多 <strong>5 次</strong> 真实 AI 体验</p>
              <p>· 可体验完整主流程，新增和修改只保存到演示沙盒</p>
            </div>

            <form onSubmit={handleGuestSubmit} className="flex flex-col gap-3">
              <div className="relative">
                <Eye className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  value={guestPassword}
                  onChange={(e) => setGuestPassword(e.target.value)}
                  placeholder={GUEST_PLACEHOLDER}
                  disabled={loading}
                  className="h-11 w-full rounded-xl border border-sky-200 bg-white/80 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 backdrop-blur transition focus:border-sky-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-100 disabled:opacity-50"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !guestPassword.trim()}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 px-4 text-sm font-semibold text-white shadow-sm shadow-sky-200 transition hover:from-sky-600 hover:to-cyan-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <><Loader2 className="size-4 animate-spin" />验证中…</>
                ) : (
                  <>进入访客体验<ArrowRight className="size-4" /></>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Shared error */}
        {error && (
          <div className="w-full max-w-md rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm font-medium text-rose-600">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="size-3 text-teal-400" />
            <span>密码仅保存在当前会话 · 关闭网页后需重新输入</span>
          </div>
          <p className="text-[10px] text-slate-300">
            当前为 Alpha 阶段 · AI 结果仅作辅助判断 · 关键商业动作需人工复核
          </p>
          <p className="text-[10px] text-slate-300">访客码仅用于临时体验，请勿公开转发。</p>
        </div>
      </div>
    </div>
  );
}
