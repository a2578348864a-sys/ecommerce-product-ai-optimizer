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
import { setNoAuthOwnerMode } from "@/lib/client/accessToken";
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
    const v4Group: SidebarNavItem[] = [
      { label: "V4 概览", href: "/", icon: LayoutDashboard },
      { label: "案例回放", href: "/replay", icon: History },
    ];
    return [
      { label: "V4 工作台", items: v4Group },
      { label: "内容工具", items: creativeItems },
      { label: "历史功能", items: researchItems },
    ];
  }
  return [
    { label: "工作台", items: [{ label: "工作台", href: "/", icon: LayoutDashboard }] },
    { label: "商品研究", items: researchItems },
    { label: "创作工具", items: creativeItems },
  ];
}

/** 模式 Badge 文案（unknown → 空，避免 hydration 漂移） */
export function modeBadgeLabel(runtime: SidebarRuntime): string {
  if (runtime.mode === "public_showcase") return "Public Replay · 只读脱敏案例";
  if (runtime.mode === "local_owner") {
    return runtime.v4Graph ? "Local Live · 可执行研究流程" : "本地模式 · V4 未启用";
  }
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

function isTaskActiveResearchHighlight(pathname: string, search: string) {
  if (pathname === "/research" || pathname.startsWith("/research/")) return true;
  if (pathname.startsWith("/tasks/") && search.includes("from=research")) return true;
  return false;
}

function isTasksHighlight(pathname: string, search: string) {
  if (!(pathname === "/tasks" || pathname.startsWith("/tasks/"))) return false;
  return !isTaskActiveResearchHighlight(pathname, search);
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
}: {
  item: SidebarNavItem;
  pathname: string;
  search?: string;
  compact?: boolean;
}) {
  const Icon = item.icon;
  const active = item.href === "/research"
    ? isTaskActiveResearchHighlight(pathname, search ?? "")
    : item.href === "/tasks"
      ? isTasksHighlight(pathname, search ?? "")
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
          (active ? "border-teal-200 text-teal-700" : "border-slate-200 text-slate-500")
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
        <div className="sticky top-4 flex flex-col gap-3">
          {sharedProduct.productName ? (
          <div className="surface-card rounded-2xl border-teal-200 bg-teal-50/60 p-3">
            <div className="flex items-center gap-2">
              <Package className="size-4 shrink-0 text-teal-600" />
              <p className="text-xs font-semibold text-teal-600">当前研究商品</p>
            </div>
            <p className="mt-1 truncate text-sm font-bold text-teal-900">{productLabel}</p>
            <p className="mt-0.5 text-xs text-teal-600">{productMeta}</p>
          </div>
        ) : null}

        <div className="surface-card p-3">
          <div className="flex items-start gap-3">
            <div className="linear-icon size-9 shrink-0 rounded-xl">
              <Sparkles className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-xs font-semibold text-teal-700">轻选工作台</p>
                <span className="rounded border border-teal-200 bg-teal-50 px-1 py-0.5 text-[10px] font-bold text-teal-700">V4</span>
              </div>
              <p className="mt-0.5 whitespace-nowrap text-sm font-semibold leading-5 text-slate-950">
                AI 跨境商品研究与上架准备工作台
              </p>
              <p className="muted-text mt-1 text-sm leading-6">辅助研究 · 人工决定</p>
              {badge ? (
                <p data-testid="sidebar-mode-badge" className="mt-1.5 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{badge}</p>
              ) : null}
            </div>
          </div>
        </div>

        <nav className="surface-card p-2" aria-label="工作台导航">
          {groups.map((group, index) => (
            <section key={group.label} className={index > 0 ? "mt-3 border-t border-slate-100 pt-3" : ""}>
              <p className="px-2 pb-1 text-xs font-semibold text-teal-700">{group.label}</p>
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} search={search} />
              ))}
            </section>
          ))}
        </nav>
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

  return (
    <nav className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="工作台移动导航">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActivePath(pathname, item.href);
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
