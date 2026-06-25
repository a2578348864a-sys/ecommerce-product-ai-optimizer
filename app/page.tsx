"use client";

import { useEffect, useState } from "react";
import { HomeDashboardClient } from "@/components/HomeDashboardClient";
import { LoginPage } from "@/components/LoginPage";
import {
  getValidAccessPassword,
  saveAccessPassword,
} from "@/lib/client/accessPassword";

export default function Home() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Hydrate from sessionStorage on mount
  useEffect(() => {
    const pwd = getValidAccessPassword();
    setAuthenticated(!!pwd);
    setReady(true);
  }, []);

  async function handleLogin(password: string) {
    setLoginError("");
    setLoginLoading(true);

    try {
      const res = await fetch("/api/tasks?limit=1", {
        headers: { "x-access-password": password },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setLoginError("访问密码错误，请重新输入。");
        } else if (res.status === 502 || res.status === 503 || res.status === 504) {
          setLoginError("服务正在重启或暂时不可用，请稍后再试。");
        } else if (res.status >= 500) {
          setLoginError("服务异常，请稍后再试。");
        } else {
          setLoginError("验证失败，请稍后重试。");
        }
        setLoginLoading(false);
        return;
      }

      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setLoginError("服务返回异常，请稍后重试。");
        setLoginLoading(false);
        return;
      }

      // Password validated — save to sessionStorage
      saveAccessPassword(password);
      setAuthenticated(true);
    } catch {
      setLoginError("网络连接失败，请检查网络后重试。");
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
