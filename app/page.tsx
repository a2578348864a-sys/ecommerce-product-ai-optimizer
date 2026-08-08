"use client";

import { useEffect, useState } from "react";
import { HomeDashboardClient } from "@/components/HomeDashboardClient";
import { LoginPage } from "@/components/LoginPage";
import {
  saveAccessToken,
  getAccessToken,
  isAuthenticated,
  type DemoAccessInfo,
} from "@/lib/client/accessToken";
import { getSafeLoginRedirect } from "@/lib/client/loginRedirect";
import { clearAllSessionDrafts } from "@/lib/client/useSessionDraft";

export default function Home() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Hydrate from sessionStorage on mount
  useEffect(() => {
    setAuthenticated(isAuthenticated());
    setReady(true);
  }, []);

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
        const code = json?.error?.code;
        const message = json?.error?.message || "验证失败，请稍后重试。";

        if (code === "demo_access_inactive") {
          setLoginError("该演示访问已被停用。");
        } else if (res.status === 401 || res.status === 403) {
          setLoginError(message);
        } else {
          setLoginError(message);
        }
        setLoginLoading(false);
        return;
      }

      // Login success — save token + mode + optional demoAccess
      const demoAccess: DemoAccessInfo | undefined = json.demoAccess
        ? {
            id: json.demoAccess.id,
            label: json.demoAccess.label,
            expiresAt: json.demoAccess.expiresAt,
            isActive: json.demoAccess.isActive,
            quotaMetric: "product_journeys_v1",
            maxProducts: json.demoAccess.maxProducts,
            usedProducts: json.demoAccess.usedProducts,
            reservedProducts: json.demoAccess.reservedProducts,
            remainingProducts: json.demoAccess.remainingProducts,
            migrationStatus: "migrated",
          }
        : undefined;

      // 重新登录（退出后再登录 / 切换身份）→ 清除全部会话草稿。
      // 登录是一个身份边界：无论旧草稿属于哪个 subject，都不能被新登录会话恢复。
      clearAllSessionDrafts();
      saveAccessToken(json.accessToken, json.mode, demoAccess);
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

  if (!authenticated) {
    return (
      <LoginPage
        onSubmit={handleLogin}
        error={loginError}
        loading={loginLoading}
      />
    );
  }

  return <HomeDashboardClient />;
}
