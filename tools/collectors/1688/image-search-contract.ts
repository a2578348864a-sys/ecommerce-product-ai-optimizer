/**
 * V3.5 — 1688 Native Image Search 驱动契约（image-acquisition-contract.v1）
 *
 * Contract §31/§32/§33/§34/§35/§37/§38/§39/§40：
 * - 正式能力：FULLY_AUTOMATED_IN_ACTIVE_FOREGROUND_BROWSER_SESSION（不宣称后台无人值守）。
 * - Upload 语义：FOCUSED_FILE_INPUT + CDP_KEYBOARD_INPUT → NATIVE_BROWSER_FILE_CHOOSER →
 *   CDP_FILE_INPUT_HANDOFF → REAL_1688_UPLOAD_STATE_CONFIRMED。
 * - 版本化 Resolver：upload target / submit target / result extraction 均为可版本化纯函数，
 *   选择器不硬编码进业务层；DOM 语义 + elementFromPoint proof 优先，Accessibility Tree 兜底。
 * - Fallback Recommendation ≠ Native Image Search Result：必须通过 URL state / 结果标记区分。
 * - 任何 target 无法证明 → fail-closed（UPLOAD_TARGET_NOT_FOUND / SEARCH_TRIGGER_NOT_CONFIRMED / ...）。
 */

/** Upload 目标 resolver 版本（结合当前真实页面重确认 invariant 后 bump） */
export const IMAGE_UPLOAD_RESOLVER_VERSION = "native-image-upload-resolver.v1" as const;
/** 搜索触发 resolver 版本 */
export const IMAGE_SUBMIT_RESOLVER_VERSION = "native-image-submit-resolver.v1" as const;
/** 结果提取 resolver 版本 */
export const IMAGE_RESULT_EXTRACTOR_VERSION = "native-image-result-extractor.v1" as const;

/** 页面状态（驱动内部状态机，映射到 §53 错误分类） */
export type ImageSearchPageState =
  | "idle"
  | "upload_target_found"
  | "upload_confirmed"
  | "search_triggered"
  | "results_ready"
  | "fallback_recommendation"
  | "captcha"
  | "login_wall"
  | "unknown_page";

/** 上传目标证明（§34：correct page / unique target / visible / enabled / current / candidate bound） */
export type UploadTargetProof = {
  found: boolean;
  unique: boolean;
  visible: boolean;
  enabled: boolean;
  tagName: string | null;
  accept: string | null;
  pageUrlAllowed: boolean;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  reasonCodes: string[];
};

/** 搜索触发证明（§37 Wrong Click = 0：live target geometry + 点击前重证明） */
export type SubmitTargetProof = {
  found: boolean;
  unique: boolean;
  visible: boolean;
  enabled: boolean;
  tagName: string | null;
  text: string | null;
  pageUrlAllowed: boolean;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  reasonCodes: string[];
};

/** 上传状态证明（§33 UPLOAD_RESULT = REAL_1688_UPLOAD_STATE_CONFIRMED） */
export type UploadStateProof = {
  confirmed: boolean;
  previewImageCount: number;
  previewImageSrc: string | null;
  selectedFileName: string | null;
  pageUrl: string;
  reasonCodes: string[];
};

/** 搜索结果卡片（单卡片内实体绑定；跨卡片拼字段禁止） */
export type ImageSearchResultCard = {
  offerId: string;
  title: string;
  priceText: string | null;
  moqText: string | null;
  supplierName: string | null;
  imageUrl: string | null;
  detailUrl: string | null;
  /** 卡片内绑定标记：所有字段来自同一卡片 DOM 节点 */
  entityBound: boolean;
};

/** 结果页证明（§38：区分 Fallback Recommendation vs Native Image Search Result） */
export type ResultPageProof = {
  resultsReady: boolean;
  isFallbackRecommendation: boolean;
  imageIdInUrl: boolean;
  resultCount: number;
  pageUrl: string;
  reasonCodes: string[];
};

/** 图搜运行轨迹（§52；不记录 Cookie/Token/图片内容） */
export type ImageAcquisitionRunTrace = {
  source: "1688";
  method: "image";
  query: string;
  timestamp: string;
  driverVersion: string;
  resolverVersion: string;
  success: boolean;
  failClosedReason: string | null;
  pageState: ImageSearchPageState | null;
  durationMs: number;
  candidateImageBound: boolean;
};
