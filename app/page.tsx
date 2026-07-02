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

        if (code === "demo_access_expired") {
          setLoginError("该演示访问已超过 24 小时有效期，请联系项目作者获取新的演示密码。");
        } else if (code === "demo_access_inactive") {
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
            maxAiCalls: json.demoAccess.maxAiCalls,
            usedAiCalls: json.demoAccess.usedAiCalls,
            remainingAiCalls: json.demoAccess.remainingAiCalls,
          }
        : undefined;

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
