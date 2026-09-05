"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FileText,
  History,
  Images,
  LayoutDashboard,
  Package,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useSharedProduct } from "@/hooks/useSharedProduct";
import { DemoAccessBanner } from "@/components/DemoAccessBanner";
import { buildAccessHeaders, setNoAuthOwnerMode } from "@/lib/client/accessToken";
import { classifyResearchLifecycle } from "@/lib/researchLifecycle";
import type { DecisionStatus } from "@/lib/tasks/decisionStatus";
import type { RuntimeMode } from "@/lib/server/runtimeMode";

type SidebarNavItem = { label: string; href: string; icon: LucideIcon };

export type SidebarRuntime = { mode: RuntimeMode | null; v4Graph: boolean };
/** V4.1 运行模式感知导航分组（纯函数，SSR 与客户端一致） */
export function buildV4NavGroups(runtime: SidebarRuntime): ReadonlyArray<{
  label: string;
  items: ReadonlyArray<SidebarNavItem>;
}> {
  // 本地（local_owner / SSR 初始）：普通卖家工作台——7 项主导航；
  // V4 研究任务/案例回放不在本地导航（案例回放仅公网 Public Replay 保留；V4 runs 经首页“开始商品研究”进入）。
  const researchItems: SidebarNavItem[] = [
    { label: "发现商品", href: "/opportunities", icon: Search },
    { label: "待研究商品", href: "/opportunity-candidates", icon: Sparkles },
    { label: "商品研究", href: "/research", icon: Package },
    { label: "研究记录", href: "/tasks", icon: History },
  ];
  const creativeItems: SidebarNavItem[] = [
    { label: "Listing Studio", href: "/listing-studio", icon: FileText },
    { label: "Image Studio", href: "/image-studio", icon: Images },
  ];
  if (runtime.mode === "public_showcase") {
    // 公网 HR 演示收口：侧栏只显示「首页」与「完整商品案例」（不出现密码锁/旧工作台入口）。
    const showcaseGroup: SidebarNavItem[] = [
      { label: "首页", href: "/", icon: LayoutDashboard },
      { label: "完整商品案例", href: "/replay", icon: History },
    ];
    return [{ label: "演示门户", items: showcaseGroup }];
  }
  return [
    { label: "工作台", items: [{ label: "工作台", href: "/", icon: LayoutDashboard }] },
    { label: "商品研究", items: researchItems },
    { label: "创作工具", items: creativeItems },
  ];
}

/** 模式 Badge 文案（unknown → 空，避免 hydration 漂移） */
export function modeBadgeLabel(runtime: SidebarRuntime): string {
  if (runtime.mode === "public_showcase") return "演示门户 · 只读案例";
  // §4.5：普通本地页面不显示 V4 / Local Live 等技术模式文案（保留公网展示）
  return "";
}

/** 供外部读取的默认/静态分组 */
export const workspaceNavGroups: ReadonlyArray<{
  label: string;
  items: ReadonlyArray<SidebarNavItem>;
}> = buildV4NavGroups({ mode: "local_owner", v4Graph: false });

export const workspaceNavItems: ReadonlyArray<SidebarNavItem> = workspaceNavGroups.flatMap((group) => group.items);

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function isTaskActiveResearchHighlight(pathname: string, search: string, hasActiveDetail: boolean | null) {
  if (pathname === "/research" || pathname.startsWith("/research/")) return true;
  // §4.1/§4.3：活动研究详情高亮"商品研究"——由真实记录生命周期决定，不依赖 from=research 临时参数；
  // 直接打开/刷新详情 URL 后仍一致；null=尚在读取 → 不抢高亮（回退"研究记录"）。
  if (pathname.startsWith("/tasks/")) {
    if (hasActiveDetail === null) return search.includes("from=research");
    return hasActiveDetail;
  }
  return false;
}

function isTasksHighlight(pathname: string, search: string, hasActiveDetail: boolean | null) {
  if (!(pathname === "/tasks" || pathname.startsWith("/tasks/"))) return false;
  return !isTaskActiveResearchHighlight(pathname, search, hasActiveDetail);
}

/** §4.1/§4.3：任务详情研究高亮（数据驱动，侧栏与移动导航共用；读取中返回 null 不抢高亮）。 */
function useTaskDetailResearchHighlight(pathname: string): boolean | null {
  const taskId = pathname.match(/^\/tasks\/([^/?#]+)/)?.[1] ?? null;
  const [state, setState] = useState<boolean | null>(null);
  useEffect(() => {
    if (!taskId) {
      setState(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
          cache: "no-store",
          headers: { ...buildAccessHeaders() },
        });
        const json = await response.json().catch(() => null) as { ok?: boolean; data?: { decisionStatus?: string; type?: string; result?: unknown } } | null;
        if (cancelled) return;
        if (!response.ok || !json?.ok || !json.data) {
          setState(false);
          return;
        }
        const lifecycle = classifyResearchLifecycle({
          decisionStatus: (json.data.decisionStatus ?? "pending") as DecisionStatus,
          result: (json.data.result ?? null) as Record<string, unknown> | null,
          type: json.data.type ?? "workflow",
        });
        setState(lifecycle.lifecycle === "active");
      } catch {
        if (!cancelled) setState(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);
  return state;
}

function currentProductLabel(productName: string) {
  try {
    const url = new URL(productName);
    if (url.protocol === "http:" || url.protocol === "https:") return "已选择商品链接";
  } catch {
    // Ordinary product titles are not URLs and should remain visible.
  }
  return productName;
}
function NavLink({
  item,
  pathname,
  search,
  compact = false,
  hasActiveDetail = null,
}: {
  item: SidebarNavItem;
  pathname: string;
  search?: string;
  compact?: boolean;
  hasActiveDetail?: boolean | null;
}) {
  const Icon = item.icon;
  const active = item.href === "/research"
    ? isTaskActiveResearchHighlight(pathname, search ?? "", hasActiveDetail)
    : item.href === "/tasks"
      ? isTasksHighlight(pathname, search ?? "", hasActiveDetail)
      : isActivePath(pathname, item.href);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={
        (compact
          ? "mb-1 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium transition last:mb-0 "
          : "mb-1 flex h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-sm font-medium transition last:mb-0 ") +
        (active ? "linear-nav-active" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950")
      }
    >
      <span
        className={
          "flex items-center justify-center rounded-lg border bg-white " +
          (compact ? "size-6 " : "size-7 ") +
          (active ? "border-emerald-200 text-emerald-700 shadow-xs" : "border-slate-200/80 text-slate-500")
        }
      >
        <Icon className={compact ? "size-3.5" : "size-4"} />
      </span>
      {item.label}
    </Link>
  );
}

export function WorkspaceSidebar() {
  const pathname = usePathname() || "/";
  const [fromResearch, setFromResearch] = useState(false);
  useEffect(() => {
    setFromResearch(typeof window !== "undefined" && window.location.search.includes("from=research"));
  }, [pathname]);
  const search = fromResearch ? "from=research" : "";
  const hasActiveDetail = useTaskDetailResearchHighlight(pathname);
  const [sharedProduct] = useSharedProduct();
  // V4.1：runtime-mode 服务端权威（模式 + V4 Graph flag）；SSR 初始 unknown → 保守（不泄露 Live 入口）
  const [runtime, setRuntime] = useState<SidebarRuntime>({ mode: null, v4Graph: false });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/runtime-mode", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.ok) return;
        const mode = json.mode === "public_showcase" || json.mode === "local_owner" ? json.mode : null;
        setRuntime({ mode, v4Graph: json.v4GraphEnabled === true });
        if (mode === "local_owner" && json.noAuthOwner === true) {
          setNoAuthOwnerMode();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const productLabel = currentProductLabel(sharedProduct.productName);
  const productMeta = sharedProduct.category ? "品类：" + sharedProduct.category : "商品资料已载入";
  const badge = modeBadgeLabel(runtime);
  const groups = buildV4NavGroups(runtime);

  return (
    <>
      <DemoAccessBanner />
      <aside className="hidden lg:block">
        <div className="sticky top-4 flex flex-col gap-2.5">
          <div className="surface-card flex flex-col p-3.5 shadow-sm">
            {/* 顶部品牌与模式 */}
            <div className="flex items-start gap-3 pb-3 border-b border-slate-100">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100">
                <Sparkles className="size-4.5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-emerald-800 tracking-tight">轻选工作台</span>
                  {runtime.mode === "public_showcase" ? (
                    <span className="rounded border border-emerald-200 bg-emerald-50 px-1 py-0.2 text-[10px] font-bold text-emerald-700">演示</span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs font-semibold text-slate-800 leading-snug">
                  AI 跨境商品研究
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">辅助研究 · 人工决定</p>
                {badge ? (
                  <p data-testid="sidebar-mode-badge" className="mt-1 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.2 text-[10px] font-semibold text-slate-600">{badge}</p>
                ) : null}
              </div>
            </div>

            {/* 中部主导航 */}
            <nav className="pt-2.5" aria-label="工作台导航">
              {groups.map((group, index) => (
                <section key={group.label} className={index > 0 ? "mt-3 border-t border-slate-100/80 pt-2.5" : ""}>
                  <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</p>
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} pathname={pathname} search={search} hasActiveDetail={hasActiveDetail} />
                  ))}
                </section>
              ))}
            </nav>

            {/* 底部当前研究商品常驻卡（复用既有 useSharedProduct） */}
            {sharedProduct.productName ? (
              <div className="mt-3.5 pt-3 border-t border-slate-100">
                <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-2.5 transition hover:bg-emerald-50">
                  <div className="flex items-center gap-1.5 text-emerald-700">
                    <Package className="size-3.5 shrink-0" />
                    <span className="text-[11px] font-semibold">当前研究商品</span>
                  </div>
                  <p className="mt-1 truncate text-xs font-bold text-slate-800" title={productLabel}>{productLabel}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{productMeta}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}
export function WorkspaceMobileNav() {
  const pathname = usePathname() || "/";
  const [runtime, setRuntime] = useState<SidebarRuntime>({ mode: null, v4Graph: false });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/runtime-mode", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.ok) return;
        const mode = json.mode === "public_showcase" || json.mode === "local_owner" ? json.mode : null;
        setRuntime({ mode, v4Graph: json.v4GraphEnabled === true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const items = buildV4NavGroups(runtime).flatMap((group) => group.items);
  const researchHighlight = useTaskDetailResearchHighlight(pathname);

  return (
    <nav className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="工作台移动导航">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.href === "/research"
          ? isTaskActiveResearchHighlight(pathname, "", researchHighlight)
          : item.href === "/tasks"
            ? isTasksHighlight(pathname, "", researchHighlight)
            : isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              "inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition " +
              (active ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600")
            }
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
