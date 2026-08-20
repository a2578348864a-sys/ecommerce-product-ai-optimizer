/**
 * V3.1 Phase 1 — Public Runtime Mode（契约 01 / 05 / 10，冻结）
 *
 * QX_RUNTIME_MODE 是唯一正式配置名。合法值只有两个：
 *   local_owner      — 本地/回环信任：NO AUTH / NO PASSWORD / NO QUOTA / FULL OWNER CAPABILITY（§6）
 *   public_showcase  — 公开访客：NO PASSWORD / NO REGISTRATION / NO VISITOR CODE（§7）
 *
 * 安全规则（契约 01-2 / 05 / §29 / §30）：
 *   - 模式只来自 trusted server deployment configuration（env）；
 *   - 禁止根据 Host / X-Forwarded-Host / Origin / Referer / URL / Client IP 推断模式；
 *   - 缺省/非法值 → local_owner（契约 01：缺省 = 现状，安全默认）。
 *
 * 缺省语义（契约 01「缺省 = 现状」）：未显式设置 QX_RUNTIME_MODE 时，行为与 v3.0.1 完全一致
 * （密码门 + 现有认证语义）——任何意外部署都不会打开无认证口子；
 * 显式 QX_RUNTIME_MODE=local_owner 才启用「无认证回环信任」（§6）。
 */
import "server-only";

export const RUNTIME_MODE_ENV = "QX_RUNTIME_MODE";

export type RuntimeMode = "local_owner" | "public_showcase";

export function getRuntimeMode(): RuntimeMode {
  const raw = (process.env[RUNTIME_MODE_ENV] || "").trim().toLowerCase();
  if (raw === "public_showcase") return "public_showcase";
  return "local_owner";
}

export function isPublicShowcase(): boolean {
  return getRuntimeMode() === "public_showcase";
}

/** 仅当显式配置 QX_RUNTIME_MODE=local_owner 时启用无认证回环信任（§6）。 */
export function isLocalOwnerNoAuthTrust(): boolean {
  const raw = (process.env[RUNTIME_MODE_ENV] || "").trim().toLowerCase();
  return raw === "local_owner";
}
