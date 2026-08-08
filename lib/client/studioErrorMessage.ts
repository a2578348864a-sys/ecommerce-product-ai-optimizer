const STUDIO_ERROR_MESSAGES: Record<string, string> = {
  invalid_access: "登录状态已失效，请重新登录后再试。",
  studio_brief_confirmation_required: "请先确认本次商品资料与人工复核要求。",
  reference_image_confirmation_required: "请确认你有权使用参考图，并批准其用于本次草稿。",
  invalid_reference_image: "参考图无效，请重新上传 10MB 以内的 PNG、JPEG 或 WebP 图片。",
  real_ai_disabled: "真实 AI 服务暂未开启，本次没有消耗额度。",
  visitor_listing_generation_disabled: "Listing 真实 AI 暂未对访客开放。",
  visitor_image_generation_disabled: "图片真实 AI 暂未对访客开放。",
  visitor_ai_quota_exceeded: "本次真实 AI 体验额度已用完。",
  visitor_listing_quota_exceeded: "本次 Listing 真实 AI 体验额度已用完。",
  provider_auth_failed: "AI 服务认证失败，请联系管理员检查服务配置。",
  provider_quota: "AI 服务额度不足，请补充额度后重试。",
  provider_timeout: "AI 服务响应超时，请稍后重试。",
  provider_unavailable: "AI 服务暂时不可用，请稍后重试。",
  network_error: "网络连接异常，请稍后重试。",
  image_request_in_progress: "同一图片请求正在处理中，请稍候。",
  image_request_conflict: "请求参数已变化，请重新发起。",
  image_response_invalid: "图片服务返回的候选结果无效，请使用新的请求重新生成。",
};

export function studioApiErrorCode(json: unknown): string | null {
  if (!json || typeof json !== "object" || !("error" in json)) return null;
  const error = (json as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return String((error as Record<string, unknown>).code);
}

export function studioErrorMessage(json: unknown, fallback: string) {
  const code = studioApiErrorCode(json);
  return (code && STUDIO_ERROR_MESSAGES[code]) || fallback;
}
