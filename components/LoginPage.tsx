"use client";

import { useState } from "react";
import {
  ArrowRight,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export interface LoginPageProps {
  onSubmit: (password: string) => Promise<void>;
  error: string;
  loading: boolean;
}

export function LoginPage({ onSubmit, error, loading }: LoginPageProps) {
  const [password, setPassword] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || loading) return;
    onSubmit(password.trim());
  }

  return (
    <div className="login-page-root">
      {/* ── Dynamic background layers ── */}
      <div className="login-bg" />

      {/* Animated gradient orbs */}
      <div className="login-orb login-orb-1" />
      <div className="login-orb login-orb-2" />
      <div className="login-orb login-orb-3" />

      {/* Subtle grid overlay */}
      <div className="login-grid" />

      {/* Floating abstract elements */}
      <div className="login-floater login-floater-1">
        <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/70 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          订单已确认
        </div>
      </div>
      <div className="login-floater login-floater-2">
        <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/70 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
          <span className="size-1.5 rounded-full bg-sky-400" />
          选品分析中…
        </div>
      </div>
      <div className="login-floater login-floater-3">
        <div className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/70 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
          <Sparkles className="size-3 text-teal-500" />
          AI 复核完成
        </div>
      </div>

      {/* Light particles */}
      <div className="login-particle login-particle-1" />
      <div className="login-particle login-particle-2" />
      <div className="login-particle login-particle-3" />
      <div className="login-particle login-particle-4" />
      <div className="login-particle login-particle-5" />
      <div className="login-particle login-particle-6" />

      {/* ── Login card ── */}
      <div className="login-card-wrapper">
        <div className="login-card">
          {/* Icon */}
          <div className="mb-2 flex justify-center">
            <div className="login-brand-icon">
              <Sparkles className="size-8" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            轻选 Agent
          </h1>
          <p className="mt-1.5 text-center text-sm text-slate-500">
            跨境电商运营工作台
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入访问密码"
                disabled={loading}
                autoFocus
                className="h-12 w-full rounded-xl border border-slate-200 bg-white/80 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 backdrop-blur transition focus:border-teal-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 px-4 text-sm font-semibold text-white shadow-sm shadow-teal-200 transition hover:from-teal-600 hover:to-emerald-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  验证中…
                </>
              ) : (
                <>
                  进入工作台
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

          {/* Footer hints */}
          <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
            <div className="flex items-start gap-2 text-xs text-slate-400">
              <ShieldCheck className="mt-0.5 size-3 shrink-0 text-teal-400" />
              <span>访问保护 · 密码仅保存在当前会话 · 关闭网页后需重新输入</span>
            </div>
            <p className="text-center text-[10px] text-slate-300">
              AI 给建议和风险提醒 · 关键动作由你确认
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
