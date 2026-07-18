"use client";

import Link from "next/link";
import { Lock, ArrowRight } from "lucide-react";

type WorkspaceLockedPromptProps = {
  /** 可选：当前页面名称，用于提示文案 */
  pageName?: string;
  /** 可选：解锁后跳回的 URL，不传则默认回到首页 */
  returnUrl?: string;
};

/**
 * 统一锁定提示 — 用于所有非首页受保护页面。
 *
 * 当用户未在首页输入访问密码时，受保护页面不显示密码输入框，
 * 只显示此组件，引导用户回到首页解锁。
 */
export function WorkspaceLockedPrompt({ pageName, returnUrl }: WorkspaceLockedPromptProps) {
  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[70dvh] max-w-md items-center justify-center">
        <section className="surface-card-strong w-full p-6 text-left sm:p-8">
          <div className="linear-icon size-11 rounded-xl bg-slate-50 text-slate-600">
            <Lock className="size-5" />
          </div>

          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">
            先解锁工作台
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {pageName
              ? `${pageName}需要访问密码。返回首页输入密码，解锁后会自动回到这里。`
              : "这个页面需要访问密码。返回首页输入密码，解锁后会自动回到这里。"}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            密码只保存在当前会话。
          </p>

          <Link
            href={returnUrl ? `/?redirect=${encodeURIComponent(returnUrl)}` : "/"}
            className="linear-button-primary mt-6 inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold"
          >
            返回首页
            <ArrowRight className="size-4" />
          </Link>
        </section>
      </div>
    </main>
  );
}
