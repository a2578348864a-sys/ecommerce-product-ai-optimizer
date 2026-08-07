/**
 * 商品名可比对工具。
 *
 * 研究运行端（product-analysis）会把 candidate.name 截断为 120 字符后再写入
 * workflowResult.input.productName；保存端（save-task）必须对 candidate.name
 * 施加相同的截断后再比对，否则 Amazon 长标题（>120 字符）会在保存时被
 * 误判为"候选商品在分析后已发生变化"。
 */
export const MAX_COMPARABLE_PRODUCT_NAME_LENGTH = 120;

function normalizeComparableProductName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function comparableCandidateProductName(value: string): string {
  return normalizeComparableProductName(
    value.trim().slice(0, MAX_COMPARABLE_PRODUCT_NAME_LENGTH),
  );
}
