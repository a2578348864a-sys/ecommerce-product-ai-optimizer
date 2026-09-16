"use client";

/**
 * V4.1 — 首页客户端分发网关。
 *
 * page.tsx 已是 server 组件，只负责读取服务端权威 runtime + Featured Replay 数据；
 * 本组件承担原有的「模式感知分发」与登录处理（依赖浏览器 sessionStorage 认证状态）。
 *
 * 分发语义（契约 §12 / 首页 §13，保持与 v3.0.1 一致）：
 *   public_showcase → PublicShowcaseHome（匿名与访客一致，HR 演示收口）
 *   local_owner + noAuthOwner → HomeDashboardClient
 *   缺省 / 未认证 → LoginPage；否则 → HomeDashboardClient
 */
import { useEffect, useState } from "react";
import { HomeDashboardClient } from "@/components/HomeDashboardClient";
import { LoginPage } from "@/components/LoginPage";
import {
  saveAccessToken,
  isAuthenticated,
  setNoAuthOwnerMode,
} from "@/lib/client/accessToken";
import { getSafeLoginRedirect } from "@/lib/client/loginRedirect";
import { clearAllSessionDrafts } from "@/lib/client/useSessionDraft";
import type { HomeRuntime } from "./heroLogic";

export function HomeGate({ runtime }: { runtime: HomeRuntime }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Hydrate auth from sessionStorage + apply no-auth-owner session marker.
  useEffect(() => {
    setAuthenticated(isAuthenticated());
    if (runtime.mode === "local_owner" && runtime.noAuthOwner) {
      setNoAuthOwnerMode();
    }
    setReady(true);
  }, [runtime.mode, runtime.noAuthOwner]);

  async function handleLogin(password: string) {
    setLoginError("");
    setLoginLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        const message = json?.error?.message || "验证失败，请稍后重试。";
        setLoginError(message);
        setLoginLoading(false);
        return;
      }

      // 重新登录 → 清除全部会话草稿（身份边界）。
      clearAllSessionDrafts();
      saveAccessToken(json.accessToken, json.mode);
      const redirectTarget = getSafeLoginRedirect(window.location.search);
      if (redirectTarget) {
        window.location.assign(redirectTarget);
        return;
      }
      setAuthenticated(true);
    } catch (err) {
      console.error("登录 API 请求异常", err);
      setLoginError("登录请求失败，请检查网络连接后重试。");
    } finally {
      setLoginLoading(false);
    }
  }

  if (!ready) return null;

  if (runtime.mode === "local_owner" && runtime.noAuthOwner) {
    return <HomeDashboardClient runtime={runtime} />;
  }

  if (!authenticated) {
    return <LoginPage onSubmit={handleLogin} error={loginError} loading={loginLoading} />;
  }

  return <HomeDashboardClient runtime={runtime} />;
}
