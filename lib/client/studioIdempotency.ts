export type StudioAttempt = {
  signature: string;
  idempotencyKey: string;
};

const CLEAR_ATTEMPT_ERROR_CODES = new Set([
  "invalid_json",
  "unsupported_request_field",
  "missing_product_name",
  "invalid_mode",
  "real_ai_confirmation_required",
  "real_ai_disabled",
  "visitor_listing_generation_disabled",
  "visitor_image_generation_disabled",
  "visitor_image_count_limited",
  "visitor_ai_quota_exceeded",
  "studio_request_conflict",
  "image_request_conflict",
  "studio_request_already_failed",
  "image_request_already_failed",
  "ai_timeout",
  "image_provider_timeout",
]);

export function getOrCreateStudioAttempt(
  current: StudioAttempt | null,
  signature: string,
  createKey: () => string,
): StudioAttempt {
  if (current?.signature === signature) return current;
  return { signature, idempotencyKey: createKey() };
}

export function shouldRetainStudioAttempt(errorCode: string | null): boolean {
  return errorCode === null || !CLEAR_ATTEMPT_ERROR_CODES.has(errorCode);
}
