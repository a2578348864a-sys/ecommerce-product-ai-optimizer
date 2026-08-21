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

type SidebarNavItem = { label: string; href: string; icon: LucideIcon };

export const workspaceNavGroups: ReadonlyArray<{
  label: string;
  items: ReadonlyArray<SidebarNavItem>;
}> = [
  {
    label: "工作台",
    items: [{ label: "工作台", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "商品研究",
    items: [
      { label: "发现商品", href: "/opportunities", icon: Search },
      { label: "待研究商品", href: "/opportunity-candidates", icon: Sparkles },
      { label: "商品研究", href: "/research", icon: Package },
      { label: "研究记录", href: "/tasks", icon: History },
    ],
  },
  {
    label: "创作工具",
    items: [
      { label: "Listing Studio", href: "/listing-studio", icon: FileText },
      { label: "Image Studio", href: "/image-studio", icon: Images },
    ],
  },
  ...(process.env.NEXT_PUBLIC_QX_V4_GRAPH_ENABLED === "1" || process.env.NEXT_PUBLIC_QX_V4_GRAPH_ENABLED === "true"
    ? [{
        label: "V4 研究图",
        items: [{ label: "运行控制台", href: "/v4/runs", icon: Sparkles }],
      }]
    : []),
] as const;

export const workspaceNavItems: ReadonlyArray<SidebarNavItem> = workspaceNavGroups.flatMap((group) => group.items);

const mobileNavItems = workspaceNavItems;

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * R5：导航高亮——任务详情页根据来源区分"商品研究 / 研究记录"。
 * - /research 及 /research/* → 商品研究
 * - /tasks/[id]?from=research（从商品研究进入的 active 任务）→ 商品研究
 * - /tasks 及 /tasks/[id]（默认/历史）→ 研究记录
 */
function isTaskActiveResearchHighlight(pathname: string, search: string) {
  if (pathname === "/research" || pathname.startsWith("/research/")) return true;
  if (pathname.startsWith("/tasks/") && search.includes("from=research")) return true;
  return false;
}

/** /tasks 及其详情页归属：active 任务（from=research）归"商品研究"，其余归"研究记录" */
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
  // R5：从 URL 读取 from=research（useSearchParams 会触发 CSR bailout；用客户端 location 惰性读取）
  const [fromResearch, setFromResearch] = useState(false);
  useEffect(() => {
    setFromResearch(typeof window !== "undefined" && window.location.search.includes("from=research"));
  }, [pathname]);
  const search = fromResearch ? "from=research" : "";
  const [sharedProduct] = useSharedProduct();
  // V3.1 local_owner（显式）：无认证回环信任 → 设置客户端解锁标记（覆盖全部工作台页/深链）
  useEffect(() => {
    let cancelled = false;
    fetch("/api/runtime-mode", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.ok && json.mode === "local_owner" && json.noAuthOwner === true) {
          setNoAuthOwnerMode();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const productLabel = currentProductLabel(sharedProduct.productName);
  const productMeta = sharedProduct.category ? `品类：${sharedProduct.category}` : "商品资料已载入";

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
              <p className="text-xs font-semibold text-teal-700">轻选工作台</p>
              <p className="mt-0.5 whitespace-nowrap text-sm font-semibold leading-5 text-slate-950">
                AI 跨境商品研究工作台
              </p>
              <p className="muted-text mt-1 text-sm leading-6">辅助研究 · 人工决定</p>
            </div>
          </div>
        </div>

        <nav className="surface-card p-2" aria-label="工作台导航">
          {workspaceNavGroups.map((group, index) => (
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

  return (
    <nav className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="工作台移动导航">
      {mobileNavItems.map((item) => {
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
