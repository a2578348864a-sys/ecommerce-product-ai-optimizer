import type { NextRequest } from "next/server";

/**
 * 服务端统一访问密码校验工具
 *
 * 复用项目现有 ACCESS_PASSWORD / APP_ACCESS_PASSWORD 环境变量。
 * 不做登录系统、不引入新依赖。
 *
 * 兼容两种传递方式：
 * - x-access-password header（GET / DELETE 推荐）
 * - body.accessPassword（POST 兼容现有前端）
 */

export function getAccessPassword(): string {
  return (process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD || "").trim();
}

/**
 * 校验访问密码。
 *
 * @param request - Next.js 请求对象
 * @param body - 可选，POST 已解析的 body。如果提供，优先验证 body.accessPassword
 * @returns null 表示密码校验通过；否则返回 NextResponse 格式的 { status, body }
 */
export function checkAccessPassword(
  request: NextRequest,
  body?: Record<string, unknown>,
): { status: number; body: Record<string, unknown> } | null {
  const configured = getAccessPassword();

  if (!configured) {
    return {
      status: 500,
      body: { error: "服务端未配置访问密码，请在环境变量中添加 ACCESS_PASSWORD。" },
    };
  }

  // 1) 尝试从 body.accessPassword 读取（POST 场景）
  if (body) {
    const bodyPassword = typeof body.accessPassword === "string" ? body.accessPassword.trim() : "";
    if (bodyPassword === configured) return null; // 通过
  }

  // 2) 尝试从 x-access-password header 读取（GET / DELETE 场景）
  const headerPassword = (request.headers.get("x-access-password") || "").trim();
  if (headerPassword === configured) return null; // 通过

  return {
    status: 401,
    body: { error: "访问密码错误，请检查后重试。" },
  };
}
