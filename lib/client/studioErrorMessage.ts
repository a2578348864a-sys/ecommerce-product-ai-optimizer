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
  configuration_error: "AI 服务配置异常，请联系管理员检查服务配置。",
  provider_config_invalid: "AI 服务配置异常，请联系管理员检查服务配置。",
  image_provider_error: "AI 服务配置异常，请联系管理员检查服务配置。",
  provider_quota: "AI 服务额度不足，请补充额度后重试。",
  provider_timeout: "AI 服务响应超时，请稍后重试。",
  image_provider_timeout: "AI 服务响应超时，请稍后重试。",
  provider_unavailable: "AI 服务暂时不可用，请稍后重试。",
  image_provider_unavailable: "AI 服务暂时不可用，请稍后重试。",
  network_error: "网络连接异常，请稍后重试。",
  image_request_in_progress: "同一图片请求正在处理中，请稍候。",
  image_request_conflict: "请求参数已变化，请重新发起。",
  image_response_invalid: "图片服务返回的候选结果无效，请使用新的请求重新生成。",
  image_schema_invalid: "图片服务返回的候选结果无效，请使用新的请求重新生成。",
  image_validation_failed: "生成图片未通过格式或内容校验，请重新生成。",
  image_provider_result_download_failed: "生成图片未通过格式或内容校验，请重新生成。",
  image_storage_failed: "图片保存失败，请稍后重试。",
  image_snapshot_save_failed: "图片保存失败，请稍后重试。",
};

export function studioApiErrorCode(json: unknown): string | null {
  if (!json || typeof json !== "object" || !("error" in json)) return null;
  const error = (json as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return String((error as Record<string, unknown>).code);
}

export function studioErrorMessage(json: unknown, fallback: string) {
  const code = studioApiErrorCode(json);
  if (code === "unexpected_non_json_response") {
    const status = typeof json === "object" && json !== null && "error" in json
      && typeof (json as { error?: unknown }).error === "object"
      && (json as { error?: { status?: unknown } }).error !== null
      ? (json as { error: { status?: unknown } }).error.status
      : null;
    return status === 504
      ? "AI 服务响应超时，请稍后重试。"
      : "AI 服务响应异常，请稍后重试。";
  }
  return (code && STUDIO_ERROR_MESSAGES[code]) || fallback;
}
