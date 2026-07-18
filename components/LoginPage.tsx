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

const accessMode = {
  owner: {
    title: "我的工作台",
    description: "管理候选、任务和分析记录。",
    label: "访问密码",
    placeholder: "输入访问密码",
    cta: "进入工作台",
    note: "正式数据仅供已授权使用者访问。",
  },
  guest: {
    title: "体验版",
    description: "在独立沙盒里走完整流程，不影响正式数据。",
    label: "访客码",
    placeholder: "输入访客码",
    cta: "开始体验",
    note: "首次进入后 24 小时有效，最多 5 次真实 AI 体验。",
  },
} as const;

export function LoginPage({ onSubmit, error, loading }: LoginPageProps) {
  const [ownerPassword, setOwnerPassword] = useState("");
  const [guestPassword, setGuestPassword] = useState("");
  const [activeTab, setActiveTab] = useState<LoginTab>("owner");

  const isOwner = activeTab === "owner";
  const mode = accessMode[activeTab];
  const password = isOwner ? ownerPassword : guestPassword;
  const setPassword = isOwner ? setOwnerPassword : setGuestPassword;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!password.trim() || loading) return;
    onSubmit(password.trim());
  }

  function switchTab(tab: LoginTab) {
    if (loading) return;
    setActiveTab(tab);
  }

  return (
    <main className="login-page-root">
      <div className="login-main">
        <header className="login-intro">
          <div className="login-brand-icon" aria-hidden="true">
            <Sparkles className="size-5" />
          </div>
          <p className="login-product-name">轻选 Agent</p>
          <h1>先找候选，再决定要不要继续。</h1>
          <p>系统整理证据和风险，你负责最后判断。</p>
        </header>

        <section className="login-access-card" data-testid="login-access-panel">
          <div className="login-access-tabs" role="tablist" aria-label="选择访问方式">
            <button
              type="button"
              role="tab"
              aria-selected={isOwner}
              onClick={() => switchTab("owner")}
              disabled={loading}
              className={isOwner ? "is-active" : ""}
            >
              <User className="size-4" />
              我的工作台
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isOwner}
              onClick={() => switchTab("guest")}
              disabled={loading}
              className={!isOwner ? "is-active" : ""}
            >
              <Eye className="size-4" />
              体验版
            </button>
          </div>

          <div className="login-access-copy">
            <p className="login-access-kicker">{mode.title}</p>
            <h2>{mode.description}</h2>
            <p>{mode.note}</p>
          </div>

          <form onSubmit={handleSubmit} className="login-access-form">
            <label htmlFor={`${activeTab}-password`}>{mode.label}</label>
            <div className="login-input-wrap">
              <Lock className="size-4" aria-hidden="true" />
              <input
                id={`${activeTab}-password`}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode.placeholder}
                disabled={loading}
                autoFocus={isOwner}
                autoComplete="current-password"
              />
            </div>

            <button type="submit" disabled={loading || !password.trim()} className="linear-button-primary login-submit">
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  验证中…
                </>
              ) : (
                <>
                  {mode.cta}
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

          <div className="login-feedback" aria-live="polite">
            {error ? <p className="login-error" role="alert">{error}</p> : null}
          </div>
        </section>

        <p className="login-privacy-note">
          <ShieldCheck className="size-4" aria-hidden="true" />
          密码只保存在当前会话；关键商业动作仍需人工确认。
        </p>
      </div>
    </main>
  );
}
