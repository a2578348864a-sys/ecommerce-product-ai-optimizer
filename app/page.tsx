"use client";

/**
 * V3.1 Phase 1 — 首页（模式感知渲染，契约 01 / §6 / §12 / §40）
 *   public_showcase → 已认证（guest/遗留）→ 工作台；否则 → GuestLanding（一键进入演示）
 *   local_owner（显式）→ 无认证回环信任 → 直接工作台（§6：NO AUTH）
 *   缺省（未显式设置 QX_RUNTIME_MODE）= v3.0.1 现状语义 → 保持现有登录流程（安全默认）
 * GET / 不创建 guest / sandbox / quota（只有点击按钮才 POST /api/auth/guest，§12）。
 */
import { useEffect, useState } from "react";
import { HomeDashboardClient } from "@/components/HomeDashboardClient";
import { LoginPage } from "@/components/LoginPage";
import { GuestLanding } from "@/components/GuestLanding";
import {
  saveAccessToken,
  getAccessToken,
  isAuthenticated,
  setNoAuthOwnerMode,
  type DemoAccessInfo,
} from "@/lib/client/accessToken";
import { getSafeLoginRedirect } from "@/lib/client/loginRedirect";
import { clearAllSessionDrafts } from "@/lib/client/useSessionDraft";

interface RuntimeInfo {
  mode: "local_owner" | "public_showcase";
  noAuthOwner: boolean;
}

export default function Home() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Hydrate from sessionStorage + query runtime mode (server authority, contract 01)
  useEffect(() => {
    setAuthenticated(isAuthenticated());
    fetch("/api/runtime-mode", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.ok && (json.mode === "local_owner" || json.mode === "public_showcase")) {
          setRuntime({ mode: json.mode, noAuthOwner: json.noAuthOwner === true });
          if (json.mode === "local_owner" && json.noAuthOwner === true) {
            setNoAuthOwnerMode();
          }
        }
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
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
            standaloneListingLimit: json.demoAccess.standaloneListingLimit,
            standaloneListingUsed: json.demoAccess.standaloneListingUsed,
            standaloneListingReserved: json.demoAccess.standaloneListingReserved,
            standaloneListingRemaining: json.demoAccess.standaloneListingRemaining,
            standaloneImageUnitLimit: json.demoAccess.standaloneImageUnitLimit,
            standaloneImageUnitsUsed: json.demoAccess.standaloneImageUnitsUsed,
            standaloneImageUnitsReserved: json.demoAccess.standaloneImageUnitsReserved,
            standaloneImageUnitsRemaining: json.demoAccess.standaloneImageUnitsRemaining,
            credentialKind: json.demoAccess.credentialKind,
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

  // PUBLIC_SHOWCASE：已认证（guest 或遗留会话）→ 工作台；否则 → 一键进入演示（§40）
  if (runtime?.mode === "public_showcase") {
    return authenticated ? <HomeDashboardClient /> : <GuestLanding />;
  }

  // LOCAL_OWNER 显式配置：无认证回环信任 → 直接工作台（§6）
  if (runtime?.mode === "local_owner" && runtime.noAuthOwner) {
    return <HomeDashboardClient />;
  }

  // 缺省（v3.0.1 现状语义）或 mode 读取失败 → 保持现有登录流程
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
