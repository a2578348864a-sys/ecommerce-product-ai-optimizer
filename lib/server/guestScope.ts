/**
 * V3.1 Phase 1 — Public Guest Scope Deny-list（契约 01-5 / 04-5 / §20）
 *
 * PUBLIC_SHOWCASE 下 anonymous guest 禁止的动作（服务器端 403 guest_scope_denied，不靠隐藏 UI）：
 * 新建商品研究、SellerSprite XLSX 导入 / Plugin 运行时、实时 Amazon/1688 采集、
 * 自定义外部 URL 研究、Browser Use 运行时。
 * owner/admin 路径由 requireOwnerOnly 天然拒绝；AI 文本/图片动作由 maxAiCalls=0 配额 fail-closed 兜底（契约 04-2）。
 * Listing/Image 交接链与金标演示交互不在本名单（PUBLIC_GUEST_SCOPE = GOLDEN_DEMO_INTERACTIVE_ONLY，配额治理属 Phase 2/D1）。
 */
import "server-only";
import type { AccessContext } from "@/lib/server/accessPassword";

export interface PublicGuestDenyRule {
  method: string;
  pathPrefix: string;
  /** 可选：路径后缀约束（例如 /api/tasks/.../browser-evidence 形态的 Browser Use 运行时端点）。 */
  pathEndsWith?: string;
}

export const PUBLIC_GUEST_DENIED_ROUTES: ReadonlyArray<PublicGuestDenyRule> = [
  // 新建商品研究（PUBLIC_GUEST_NEW_PRODUCT_RESEARCH = OFF）
  { method: "POST", pathPrefix: "/api/workflows/product-analysis" },
  // 实时采集 / SellerSprite 导入（外部获取一律 OFF）
  { method: "POST", pathPrefix: "/api/opportunities/crawl" },
  { method: "POST", pathPrefix: "/api/opportunities/source-import" },
  { method: "POST", pathPrefix: "/api/opportunities/sellersprite-import" },
  { method: "POST", pathPrefix: "/api/opportunities/sellersprite-plugin-import" },
  { method: "POST", pathPrefix: "/api/opportunities/sellersprite-preview" },
  { method: "POST", pathPrefix: "/api/opportunities" },
  // 候选创建 / 研究启动 / 研究上下文（guest 无消费路径）
  { method: "POST", pathPrefix: "/api/opportunity-candidates" },
  { method: "PATCH", pathPrefix: "/api/opportunity-candidates" },
  { method: "GET", pathPrefix: "/api/opportunity-candidates/research-context" },
  // Browser Use 运行时
  { method: "POST", pathPrefix: "/api/tasks", pathEndsWith: "/browser-evidence" },
  { method: "PATCH", pathPrefix: "/api/tasks", pathEndsWith: "/browser-evidence" },
];

/** 命中返回 deny code（guest_scope_denied），否则 null。 */
export function isPublicGuestRouteDenied(method: string, pathname: string): string | null {
  const normalizedMethod = (method || "GET").toUpperCase();
  for (const rule of PUBLIC_GUEST_DENIED_ROUTES) {
    if (rule.method !== normalizedMethod) continue;
    if (!pathname.startsWith(rule.pathPrefix)) continue;
    if (rule.pathEndsWith && !pathname.endsWith(rule.pathEndsWith)) continue;
    return "guest_scope_denied";
  }
  return null;
}

/** anonymous guest 判定（credentialKind 显式判别，契约 02 / §9）。 */
export function isAnonymousGuest(ctx: AccessContext): boolean {
  return ctx.mode === "demo" && ctx.credentialKind === "anonymous";
}
