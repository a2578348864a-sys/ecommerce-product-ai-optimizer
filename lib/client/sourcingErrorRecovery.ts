"use client";

/**
 * V3.5 / V4.1 — Sourcing Error Recovery & Safe Response Parser
 *
 * 核心职责：
 * 1. safe parse: 彻底杜绝 response.json() 抛 SyntaxError 导致被泛化 catch 包装成“网络异常”；
 * 2. 精准分层错误归类：把底层异常/HTTP状态/业务码精确映射到具体故障层级与可行动文案；
 * 3. 可行动恢复指示：标明当前错误是否可重试（canRetry）或需重新检测环境（canRecheck）。
 */

export type SourcingApiResponse<T = unknown> = {
  ok: boolean;
  error?: { code: string; message: string };
  data?: T;
};

export type SourcingErrorCategory =
  | "timeout"
  | "network_error"
  | "bridge_unavailable"
  | "browser_assistant_required"
  | "login_required"
  | "risk_control_required"
  | "tool_unavailable"
  | "server_error"
  | "invalid_response"
  | "preview_expired"
  | "conflict_retry"
  | "conflict_stop"
  | "client_validation"
  | "generic";

export type SourcingErrorDetail = {
  category: SourcingErrorCategory;
  layer: string;
  message: string;
  canRetry: boolean;
  canRecheck: boolean;
  code?: string;
  status?: number;
};

/**
 * 安全解析 1688 Sourcing API 响应：
 * 杜绝 response.json() 遇到 500/502/504 HTML 或空响应时抛出 SyntaxError。
 */
export async function parseSourcingResponse<T = unknown>(response: Response): Promise<{
  status: number;
  data: SourcingApiResponse<T>;
}> {
  const status = response.status;
  if (status === 204) {
    return { status, data: { ok: true } };
  }

  let text = "";
  try {
    if (typeof response.text === "function") {
      text = await response.text();
    } else if (typeof response.json === "function") {
      const body = (await response.json()) as SourcingApiResponse<T>;
      return { status, data: body };
    }
  } catch {
    return {
      status,
      data: {
        ok: false,
        error: {
          code: "network_error",
          message: "网络连接中断，无法读取服务器响应。",
        },
      },
    };
  }

  if (!text || !text.trim()) {
    return {
      status,
      data: {
        ok: false,
        error: {
          code: status >= 500 ? "server_error" : "invalid_response",
          message: status >= 500 ? "本地服务未返回有效内容，请重试。" : "服务器返回空响应。",
        },
      },
    };
  }

  try {
    const parsed = JSON.parse(text) as SourcingApiResponse<T>;
    return { status, data: parsed };
  } catch {
    // 非 JSON 响应（常见于 Next.js 500 页面、502/504 网关错误页等）
    if (status >= 500) {
      return {
        status,
        data: {
          ok: false,
          error: {
            code: "server_error",
            message: "本地服务执行异常（返回非 JSON 响应），请检查服务状态或稍后重试。",
          },
        },
      };
    }
    if (status === 404) {
      return {
        status,
        data: {
          ok: false,
          error: {
            code: "not_found",
            message: "请求的接口不存在或任务未找到。",
          },
        },
      };
    }
    return {
      status,
      data: {
        ok: false,
        error: {
          code: "invalid_response",
          message: `服务返回了无法识别的数据格式（HTTP ${status}）。`,
        },
      },
    };
  }
}

/**
 * 错误分层归类判定器：
 * 绝不笼统掩盖为“网络异常”，向用户明确报告是哪一层出问题，并指引恢复路径。
 */
export function classifySourcingRequestError(input: {
  error?: unknown;
  status?: number;
  code?: string;
  message?: string;
  method?: "keyword" | "image" | "url" | "save" | "check";
}): SourcingErrorDetail {
  const { error, status, method } = input;
  const rawCode = input.code || (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "");
  const rawMsg = input.message || (error instanceof Error ? error.message : "");

  // 1. 超时检测（AbortSignal.timeout、DOMException TimeoutError、或者 504 timeout）
  const isTimeout =
    rawCode === "timeout" ||
    status === 504 ||
    (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) ||
    /timeout|timed out|aborted/i.test(rawMsg);

  if (isTimeout) {
    return {
      category: "timeout",
      layer: "请求超时",
      message: method === "keyword"
        ? "1688 关键词获取超时（外部响应耗时较长），请点击重试。"
        : method === "image"
          ? "1688 图搜响应超时，请确认 Chrome 窗口在前台且助手正常运行后重试。"
          : "请求超时，外部服务暂未在时限内完成响应，请重试。",
      canRetry: true,
      canRecheck: true,
      code: "timeout",
      status: status ?? 504,
    };
  }

  // 2. 纯网络异常（fetch 抛出 TypeError，如 ECONNREFUSED、端口未开放、断网）
  const isNetwork =
    rawCode === "network_error" ||
    error instanceof TypeError ||
    /failed to fetch|networkerror|connection refused|econnrefused|network error/i.test(rawMsg);

  if (isNetwork && (!status || status === 0)) {
    return {
      category: "network_error",
      layer: "网络连接",
      message: "网络连接失败，请检查网络连接与本地服务后重试。",
      canRetry: true,
      canRecheck: true,
      code: "network_error",
      status: 0,
    };
  }

  // 3. 1688 助手本地桥接服务不可用
  if (
    rawCode === "extension_bridge_not_available" ||
    rawCode === "bridge_unavailable" ||
    /bridge/i.test(rawMsg)
  ) {
    return {
      category: "bridge_unavailable",
      layer: "扩展桥接服务",
      message: "1688 图片助手本地桥接服务未就绪，请点击「重新检测」或稍后重试。",
      canRetry: true,
      canRecheck: true,
      code: rawCode || "extension_bridge_not_available",
      status: status ?? 503,
    };
  }

  // 4. 浏览器助手未就绪 / 版本不匹配 / 连接中断
  if (
    rawCode === "extension_not_installed" ||
    rawCode === "extension_disconnected" ||
    rawCode === "extension_version_mismatch" ||
    rawCode === "extension_version_unsupported"
  ) {
    const isMismatch = rawCode === "extension_version_mismatch" || rawCode === "extension_version_unsupported";
    return {
      category: "browser_assistant_required",
      layer: "浏览器助手",
      message: isMismatch
        ? "浏览器助手版本需要更新，请在 Chrome 扩展管理页重新加载助手后点击「重新检测」。"
        : "图片找货需要浏览器助手扩展。请确认 Chrome 已加载助手后，点击「重新检测」。",
      canRetry: false,
      canRecheck: true,
      code: rawCode,
      status: status ?? 503,
    };
  }

  // 5. 1688 登录态缺失
  if (rawCode === "auth_required" || rawCode === "not_logged_in") {
    return {
      category: "login_required",
      layer: "1688 登录",
      message: method === "image"
        ? "图片找货需要在普通 Chrome 中登录 1688（与关键词找货的登录相互独立）。请在 Chrome 完成 1688 登录后重试。"
        : "需要先完成 1688 登录才能使用该功能，请打开 1688 登录窗口完成扫码后点击重新检测。",
      canRetry: false,
      canRecheck: true,
      code: "auth_required",
      status: status ?? 401,
    };
  }

  // 6. 1688 平台风控（滑块、验证码、安全阻断）
  if (
    rawCode === "risk_control_required" ||
    rawCode === "page_blocked_captcha" ||
    rawCode === "daemon_paused"
  ) {
    return {
      category: "risk_control_required",
      layer: "1688 平台风控",
      message: rawMsg || "1688 触发了验证（滑块/验证码）。请在 1688 页面完成验证后重试（系统不会自动绕过）。",
      canRetry: true,
      canRecheck: true,
      code: rawCode,
      status: status ?? 403,
    };
  }

  // 7. 本地采集工具未就绪
  if (
    rawCode === "acquisition_tool_not_available" ||
    rawCode === "tool_not_available" ||
    rawCode === "tool_version_unsupported"
  ) {
    return {
      category: "tool_unavailable",
      layer: "1688 工具",
      message: rawMsg || "未检测到本机 1688 采集工具或版本不匹配，请检查工具配置后重试。",
      canRetry: false,
      canRecheck: true,
      code: rawCode,
      status: status ?? 503,
    };
  }

  // 8. 预览过期
  if (rawCode === "preview_expired" || status === 410) {
    return {
      category: "preview_expired",
      layer: "搜索预览",
      message: rawMsg || "预览已过期或不属于当前任务，请重新搜索后再确认。",
      canRetry: true,
      canRecheck: false,
      code: "preview_expired",
      status: 410,
    };
  }

  // 9. 输入校验
  if (
    rawCode === "invalid_query" ||
    rawCode === "invalid_url" ||
    rawCode === "invalid_image_url" ||
    rawCode === "invalid_selection" ||
    rawCode === "too_many_selected" ||
    rawCode === "bad_request" ||
    (status === 400 && rawCode)
  ) {
    return {
      category: "client_validation",
      layer: "输入参数",
      message: rawMsg || "输入内容有误，请检查后重试。",
      canRetry: false,
      canRecheck: false,
      code: rawCode,
      status: 400,
    };
  }

  // 10. 服务端内部错误（500、502、503）
  if ((status && status >= 500) || rawCode === "server_error" || rawCode === "tool_error") {
    return {
      category: "server_error",
      layer: "本地服务端",
      message: rawMsg || "本地服务执行异常，请检查后台日志或稍后重试。",
      canRetry: true,
      canRecheck: true,
      code: rawCode || "server_error",
      status: status ?? 500,
    };
  }

  // 11. 数据格式异常
  if (rawCode === "invalid_response" || rawCode === "schema_unsupported") {
    return {
      category: "invalid_response",
      layer: "数据解析",
      message: rawMsg || "1688 返回的数据结构无法解析，已安全拒绝。",
      canRetry: true,
      canRecheck: false,
      code: rawCode,
      status: status ?? 422,
    };
  }

  // 默认兜底
  return {
    category: "generic",
    layer: "操作失败",
    message: rawMsg || "获取 1688 供应线索失败，请重试。",
    canRetry: true,
    canRecheck: true,
    code: rawCode || "unknown_error",
    status: status ?? 500,
  };
}
