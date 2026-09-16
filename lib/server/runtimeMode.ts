/**
 * Core Product Runtime Mode — Local Single User
 *
 * The application runs as a local single-user workbench on loopback (127.0.0.1).
 * No owner/guest distinctions, no access passwords, no login required.
 */
import "server-only";

export const RUNTIME_MODE_ENV = "QX_RUNTIME_MODE";

export type RuntimeMode = "local_single_user" | "local_owner";

export function getRuntimeMode(): RuntimeMode {
  return "local_single_user";
}

export function isLocalSingleUser(): boolean {
  return true;
}

export function isPublicShowcase(): boolean {
  return false;
}

/** 兼容旧调用：单用户本地模式恒定信任回环环境。 */
export function isLocalOwnerNoAuthTrust(): boolean {
  return true;
}

