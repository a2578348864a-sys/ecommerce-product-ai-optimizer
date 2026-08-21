/**
 * V4.1 — 首页（server 组件）。
 *
 * 服务端读取权威 runtime：getRuntimeMode() / isLocalOwnerNoAuthTrust()（@/lib/server/runtimeMode）
 * 与 isV4GraphEnabled()（@/lib/v4/featureFlag，server-only 可用），并把 { mode, noAuthOwner, v4Graph }
 * 作为 props 传给客户端分发网关 HomeGate；同时读取 Featured Replay 数据并注入。
 *
 * 原有的「模式感知分发 + 登录处理」已下沉到 client 组件 HomeGate
 * （依赖浏览器 sessionStorage 认证状态与登录表单，server 无法读取）。
 */
import { getRuntimeMode, isLocalOwnerNoAuthTrust } from "@/lib/server/runtimeMode";
import { isV4GraphEnabled } from "@/lib/v4/featureFlag";
import { loadFeaturedReplay } from "@/components/v4/replay-featured";
import { HomeGate } from "@/components/v4/home/HomeGate";
import type { HomeRuntime } from "@/components/v4/home/heroLogic";

export const dynamic = "force-dynamic";

export default async function Home() {
  const runtime: HomeRuntime = {
    mode: getRuntimeMode(),
    noAuthOwner: isLocalOwnerNoAuthTrust(),
    v4Graph: isV4GraphEnabled(),
  };
  const featured = await loadFeaturedReplay();

  return <HomeGate runtime={runtime} featured={featured} />;
}
