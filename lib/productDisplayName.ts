function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normalizes a persisted system task title for display.
 *
 * The save-task route currently appends exactly " 一键分析". Keep this allowlist
 * narrow so ordinary product names containing "分析" are not rewritten.
 */
export function normalizeProductDisplayName(value: unknown) {
  const title = text(value);
  if (!title) return "";

  const normalized = title.replace(/\s+一键分析$/u, "").trim();
  return normalized || title;
}

export function resolveTaskProductDisplayName(input: {
  resultProductName?: unknown;
  taskTitle?: unknown;
  materialText?: unknown;
  fallback?: string;
}) {
  const resultProductName = text(input.resultProductName);
  if (resultProductName) return resultProductName;

  return normalizeProductDisplayName(input.taskTitle)
    || text(input.materialText)
    || input.fallback
    || "";
}
