"use client";

/**
 * V3 Final Operability Correction — P1-A：统一用户层错误文案映射
 *
 * 原则：正式普通用户 UI 永不直接渲染服务端 error.message（message 可能含
 * 技术串：CDP 错误码 / V35_1688_CLI_PATH / pageKind / expectedStorageVersion 等）。
 * 按 error.code 查用户文案表；未命中 → 通用文案（不直出 message）。
 * 诊断细节保留在服务端日志 / 可选"技术详情"区（code + requestId）。
 */

export type ApiErrorShape = {
  code?: string;
  message?: string;
  requestId?: string;
} | null | undefined;

const CONFLICT_MESSAGE = "内容刚在其他位置更新，已为你保留输入，请刷新后重试。";

const GENERIC_FALLBACK = "操作未完成，请稍后重试。";

/** 全局 code → 用户文案表（覆盖各证据区与并发冲突；其余按区块扩展） */
const USER_ERROR_MESSAGES: Record<string, string> = {
  // 并发/版本冲突（统一安全文案，不泄漏字段名）
  task_result_conflict: CONFLICT_MESSAGE,
  research_record_conflict: CONFLICT_MESSAGE,
  handoff_stale: CONFLICT_MESSAGE,
  handoff_revision_changed: CONFLICT_MESSAGE,
  image_request_conflict: CONFLICT_MESSAGE,
  studio_request_stale: CONFLICT_MESSAGE,
  image_selection_stale: "该候选图不属于当前创作资料版本，请重新生成后选择。",
  storage_version_required: CONFLICT_MESSAGE,
  invalid_storage_version: CONFLICT_MESSAGE,
  // 认证/权限
  auth_required: "登录状态已失效，请重新登录后继续。",
  invalid_token: "登录状态已失效，请重新登录后继续。",
  forbidden: "当前身份无权执行该操作。",
  quota_exhausted: "本次体验额度已用完，请明天再试或联系管理员。",
  // 网络/服务
  network_error: "网络异常，请检查连接后重试。",
  timeout: "请求超时，请重试。",
  ai_provider_error: "AI 服务暂时不可用，请稍后重试。",
  ai_timeout: "AI 服务响应超时，请稍后重试。",
  no_evidence_available: "当前还没有已确认的 Evidence，请先收集至少一类资料后再生成总结。",
  // 浏览器采集（P1-A：杜绝 CDP/ReferenceError 直出）
  extraction_failed: "Amazon 商品信息采集失败，请确认商品页可正常打开后重试；若持续失败可稍后再试。",
  collect_failed: "Amazon 商品信息采集失败，请稍后重试；若持续失败请检查本机浏览器与网络。",
  page_blocked_captcha: "页面要求完成验证码。我们不自动绕过：请在本机浏览器手动打开该商品页并确认后重试。",
  page_blocked_login_wall: "页面要求登录。我们不自动登录：请确认该商品页可公开访问后重试。",
  page_error: "页面返回错误页（商品可能不存在、下架或访问受限）。请确认商品后重试。",
  page_unknown: "页面不是可识别的 Amazon 商品详情页。请确认商品与站点后重试。",
  navigation_not_allowed: "页面被重定向到白名单外地址，已停止采集。请在本机浏览器手动检查该商品页。",
  navigation_budget_exhausted: "本次采集导航次数用尽，已停止。",
  browser_session_fail_closed: "浏览器会话因安全门禁停止，已停止采集。",
  browser_unavailable: "本机未检测到可用的 Chrome/Edge 浏览器，无法进行页面采集。",
  task_asin_unbound: "当前任务缺少 Amazon 商品身份信息（productUrl / ASIN），无法确定采集目标。请返回候选商品补充 Amazon 商品来源后再重新开始研究。",
  // 1688（P1-B：用户语言，不泄漏 CLI/扩展技术串）
  acquisition_tool_not_available: "1688 获取工具尚未配置，请先完成 1688 登录与工具配置后重试。",
  tool_not_available: "1688 获取工具尚未就绪，请先完成 1688 登录后重试。",
  tool_version_unsupported: "1688 获取工具版本过旧，请更新后重试。",
  tool_error: "获取 1688 数据失败（工具执行异常），请稍后重试；若持续失败请重新登录 1688。",
  invalid_query: "请先输入搜索关键词。",
  invalid_offer_id: "1688 链接无效，请检查后重试。",
  entity_binding_failed: "1688 结果与候选商品无法确认对应关系，已停止保存。",
  risk_control_required: "1688 触发了验证。请在 1688 页面完成验证后重试（系统不会绕过验证）。",
  extension_not_installed: "图片找货需要启用轻选浏览器助手。请先安装助手后重试。",
  extension_disconnected: "1688 图片助手连接中断，请检查 Chrome 窗口与助手状态后重试。",
  extension_bridge_not_available: "1688 图片助手服务未就绪，请稍后重试。",
  extension_version_unsupported: "1688 图片助手版本过旧，请重新加载助手后重试。",
  page_identity_unknown: "1688 图搜页面未就绪，请确认已打开图搜页且助手已刷新后重试。",
  upload_not_confirmed: "图片上传未完成，请确认图搜页面状态后重试。",
  search_trigger_not_confirmed: "「搜索图片」未成功触发，请确认图搜页面后重试。",
  image_results_insufficient: "图搜结果不足，请换一张更清晰的图片后重试。",
  preview_expired: "预览已过期，请重新搜索后再确认。",
  // 创作交接
  decision_not_creative_ready: "当前研究决定尚未进入创作准备，暂不能创建创作交接。",
  handoff_required: "创建创作交接后才能生成内容。",
  research_gate_failed: "研究记录状态与创作交接不一致，请刷新后重试。",
  // 通用错误
  not_found: "内容不存在或已被删除。",
  bad_request: "请求参数有误，请检查后重试。",
  database_error: "服务暂时不可用，请稍后重试。",
  internal_error: "服务暂时异常，请稍后重试。",
};

/** 从 API 响应提取用户安全文案（永远不直接渲染 error.message） */
export function userMessageFor(json: ApiErrorShape, fallback = GENERIC_FALLBACK): string {
  if (!json) return fallback;
  const code = typeof json.code === "string" ? json.code : "";
  if (code && USER_ERROR_MESSAGES[code]) return USER_ERROR_MESSAGES[code];
  return fallback;
}

/** 可复用的诊断标识（供"技术详情"折叠区；不含原始 message/stack） */
export function diagnosticLabel(json: ApiErrorShape): string {
  if (!json) return "";
  const code = typeof json.code === "string" ? json.code : "unknown";
  const requestId = typeof json.requestId === "string" && json.requestId ? json.requestId : "";
  return requestId ? `${code} · ${requestId}` : code;
}
