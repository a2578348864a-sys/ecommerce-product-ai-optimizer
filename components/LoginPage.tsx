"use client";

import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  FileText,
  Image,
  Loader2,
  Lock,
  Search,
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

const productJourney = [
  { number: "01", label: "发现商品", description: "查看候选与市场信号", icon: Search },
  { number: "02", label: "商品研究", description: "理解商品、市场与风险", icon: Sparkles },
  { number: "03", label: "Listing 准备", description: "整理可审核的文案草稿", icon: FileText },
  { number: "04", label: "图片创作", description: "准备可比较的图片方案", icon: Image },
  { number: "05", label: "人工决定", description: "确认是否继续下一步", icon: CheckCircle2 },
] as const;

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
      <div className="login-bg" />
      <div className="login-grid" />

      <main className="login-main">
        <section className="login-product-intro" aria-labelledby="login-title">
          <div className="flex items-center gap-3">
            <div className="login-brand-icon">
              <Sparkles className="size-7" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">轻选 Agent</p>
              <p className="mt-1 text-xs text-slate-500">辅助研究 · 人工确认</p>
            </div>
          </div>

          <h1
            id="login-title"
            aria-label="AI 跨境商品研究助手"
            className="mt-7 max-w-2xl break-words text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-slate-950 sm:text-5xl"
          >
            <span className="block lg:inline">AI 跨境商品</span>{" "}
            <span className="block lg:inline">研究助手</span>
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
            <span className="block xl:inline">把分散的选品信息整理成</span>{" "}
            <span className="block xl:inline">一条清晰的研究流程。</span>{" "}
            <span className="block xl:inline">AI 帮你理解和创作，</span>{" "}
            <span className="block xl:inline">商业决定始终由你确认。</span>
          </p>

          <ol className="login-product-journey" data-testid="login-product-journey" aria-label="商品研究流程">
            {productJourney.map((step, index) => {
              const Icon = step.icon;
              return (
                <li key={step.number} className="login-journey-step">
                  <div className="login-journey-marker" aria-hidden="true">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-950">
                      {step.number} {step.label}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{step.description}</p>
                  </div>
                  {index < productJourney.length - 1 ? <span className="login-journey-line" aria-hidden="true" /> : null}
                </li>
              );
            })}
          </ol>

          <div className="mt-6 flex items-start gap-2 rounded-2xl border border-teal-100 bg-white/70 p-3 text-xs leading-5 text-slate-600">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-600" aria-hidden="true" />
            <p>
              <span className="block">不会自动采购、上架或投放广告；</span>
              <span className="block">所有关键动作都需要人工确认。</span>
            </p>
          </div>
        </section>

        <section className="login-access-panel" aria-label="进入方式">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">继续使用</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">选择你的进入方式</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">验证后进入同一条商品研究流程。</p>
          </div>

          <div className="mt-5 grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-100 p-1" role="tablist" aria-label="身份类型">
            <button
              type="button"
              role="tab"
              aria-selected={isOwner}
              onClick={() => switchTab("owner")}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                isOwner ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
              }`}
            >
              <User className="size-4" aria-hidden="true" />
              Owner
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isOwner}
              onClick={() => switchTab("guest")}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                !isOwner ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
              }`}
            >
              <Eye className="size-4" aria-hidden="true" />
              访客体验
            </button>
          </div>

          {isOwner ? (
            <form onSubmit={handleOwnerSubmit} className="mt-4 flex flex-col gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Owner 使用</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">维护候选商品、研究记录与创作内容。</p>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <label className="sr-only" htmlFor="owner-password">Owner 密码</label>
                <input
                  id="owner-password"
                  name="ownerPassword"
                  type="password"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  placeholder={OWNER_PLACEHOLDER}
                  disabled={loading}
                  autoComplete="current-password"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
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
                  <>进入商品研究助手<ArrowRight className="size-4" aria-hidden="true" /></>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleGuestSubmit} className="mt-4 flex flex-col gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">访客体验</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">24 小时隔离沙盒，新增和修改不会进入正式数据。</p>
              </div>
              <div className="relative">
                <Eye className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <label className="sr-only" htmlFor="guest-password">访客码</label>
                <input
                  id="guest-password"
                  name="guestPassword"
                  type="password"
                  value={guestPassword}
                  onChange={(e) => setGuestPassword(e.target.value)}
                  placeholder={GUEST_PLACEHOLDER}
                  disabled={loading}
                  autoComplete="current-password"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:opacity-50"
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
                  <>进入访客体验<ArrowRight className="size-4" aria-hidden="true" /></>
                )}
              </button>
            </form>
          )}

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700" role="alert" aria-live="polite">
              {error}
            </div>
          ) : null}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="flex items-start gap-2 text-xs leading-5 text-slate-500">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-500" aria-hidden="true" />
              <span>密码仅保存在当前会话；关闭网页后需重新输入。</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              当前为 Alpha 阶段，AI 结果仅作辅助判断。
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
