/**
 * V3.1 Phase 2 — Public Guest Capability Allow-list（§21-24）
 *
 * PUBLIC_GUEST_DEFAULT = DENY：anonymous guest 在 PUBLIC_SHOWCASE 下只允许
 * 显式注册的 capability；未知 route/action/mutation → 403 guest_scope_denied
 * （GUEST_SCOPE_FAILS_CLOSED）。
 */
import "server-only";
import type { AccessContext } from "@/lib/server/accessPassword";

export type GuestCapability =
  | "view_golden_demo"
  | "view_guest_task"
  | "view_evidence"
  | "view_confirmed_facts"
  | "view_market_observations"
  | "view_existing_listing"
  | "view_existing_images"
  | "human_demo_interaction"
  | "generate_guest_listing"
  | "generate_guest_image";

interface GuestCapabilityRoute {
  capability: GuestCapability;
  method: string;
  pattern: string;
}

/** 金标演示最小能力集（按现有 Golden Demo UI 实际端点枚举）。拥有权由 sandbox/demoAccessId 守卫二次强制。 */
export const GUEST_CAPABILITY_ROUTES: ReadonlyArray<GuestCapabilityRoute> = [
  { capability: "view_golden_demo", method: "GET", pattern: "/api/demo/golden" },
  { capability: "view_guest_task", method: "GET", pattern: "/api/tasks/:taskId" },
  { capability: "view_guest_task", method: "GET", pattern: "/api/tasks/:taskId/lifecycle" },
  { capability: "view_evidence", method: "GET", pattern: "/api/tasks/:taskId/fact-candidates" },
  { capability: "view_evidence", method: "GET", pattern: "/api/tasks/:taskId/review-evidence" },
  { capability: "view_evidence", method: "GET", pattern: "/api/tasks/:taskId/ai-evidence-summary" },
  { capability: "view_evidence", method: "GET", pattern: "/api/tasks/:taskId/sourcing" },
  { capability: "view_evidence", method: "GET", pattern: "/api/tasks/:taskId/keyword-evidence" },
  { capability: "view_market_observations", method: "GET", pattern: "/api/tasks/:taskId/competitor-evidence" },
  { capability: "view_evidence", method: "GET", pattern: "/api/tasks/:taskId/browser-evidence" },
  { capability: "view_evidence", method: "GET", pattern: "/api/tasks/:taskId/research-decision" },
  { capability: "view_existing_listing", method: "GET", pattern: "/api/tasks/:taskId/listing-handoff" },
  { capability: "view_existing_listing", method: "GET", pattern: "/api/tasks/:taskId/creative-handoff" },
  { capability: "view_existing_listing", method: "GET", pattern: "/api/tasks/:taskId/listing-pack" },
  { capability: "view_existing_images", method: "GET", pattern: "/api/tasks/:taskId/image-handoff" },
  { capability: "view_existing_images", method: "GET", pattern: "/api/tasks/:taskId/image-draft" },
  { capability: "view_existing_images", method: "GET", pattern: "/api/tasks/:taskId/image-draft/:imageId" },
  { capability: "view_existing_images", method: "GET", pattern: "/api/tasks/:taskId/visual-reference-import" },
  { capability: "human_demo_interaction", method: "POST", pattern: "/api/tasks/:taskId/fact-candidates" },
  { capability: "human_demo_interaction", method: "POST", pattern: "/api/tasks/:taskId/research-decision" },
  { capability: "human_demo_interaction", method: "POST", pattern: "/api/tasks/:taskId/creative-handoff" },
  { capability: "human_demo_interaction", method: "PATCH", pattern: "/api/tasks/:taskId/image-handoff" },
  { capability: "human_demo_interaction", method: "POST", pattern: "/api/tasks/:taskId/complete" },
  { capability: "generate_guest_listing", method: "POST", pattern: "/api/tasks/:taskId/listing-handoff" },
  { capability: "generate_guest_image", method: "POST", pattern: "/api/tasks/:taskId/image-handoff" },
];

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternToRegExp(pattern: string): RegExp {
  // :param 段先替换为 [^/]+，再转义其余字面字符（避免转义污染占位符）
  const parts = pattern.split("/").filter(Boolean);
  const regexSource = "^/" + parts.map((part) => {
    if (part.startsWith(":")) return "[^/]+";
    return escapeRegExpLiteral(part);
  }).join("/") + "$";
  return new RegExp(regexSource);
}

/** 解析 guest 请求命中的 capability；未注册 → null（默认 DENY，§23）。 */
export function resolveGuestCapability(method: string, pathname: string): GuestCapability | null {
  const normalizedMethod = (method || "GET").toUpperCase();
  for (const route of GUEST_CAPABILITY_ROUTES) {
    if (route.method !== normalizedMethod) continue;
    if (patternToRegExp(route.pattern).test(pathname)) return route.capability;
  }
  return null;
}

/** anonymous guest 判定（显式 credentialKind 判别，契约 02 / §9）。 */
export function isAnonymousGuest(ctx: AccessContext): boolean {
  return ctx.mode === "demo" && ctx.credentialKind === "anonymous";
}