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
      <div className="mx-auto flex max-w-lg flex-col items-center gap-6 py-16 text-center">
        {/* Icon */}
        <div className="linear-icon size-16 rounded-2xl bg-slate-100 text-slate-400">
          <Lock className="size-8" />
        </div>

        {/* Message */}
        <div>
          <h1 className="text-xl font-semibold text-slate-800 sm:text-2xl">
            当前工作台未解锁
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {pageName
              ? `「${pageName}」需要访问密码才能使用。请先回到首页输入访问密码。`
              : "请先回到首页输入访问密码后再使用此功能。"}
          </p>
        </div>

        {/* CTA */}
        <Link
          href={returnUrl ? `/?redirect=${encodeURIComponent(returnUrl)}` : "/"}
          className="linear-button-primary inline-flex h-11 items-center justify-center gap-2 px-6 text-sm font-semibold"
        >
          返回首页解锁
          <ArrowRight className="size-4" />
        </Link>

        {/* Footer note */}
        <p className="text-xs text-slate-400">
          轻选 Agent · Alpha MVP · 受控自动化 + 人工复核
        </p>
      </div>
    </main>
  );
}
