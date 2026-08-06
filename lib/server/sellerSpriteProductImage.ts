import "server-only";

/**
 * SellerSprite 商品主图资产化（V2 最后两项 P1 修复 — P1-1）
 *
 * 目标：真实 SellerSprite 候选导入时，把报表中的商品主图 URL 下载为
 * 任务自有、可追溯的图片资产（productImageSnapshot），使视觉参考候选
 * （visualReferenceCandidates）从 context.productImage 可达，用户批准后
 * 进入 Handoff visualReferences。
 *
 * 安全边界（与既有 product-batch 图片获取完全一致的安全模式）：
 *   1. 域名白名单：仅 m.media-amazon.com / images-na.ssl-images-amazon.com
 *      （Amazon 商品主图权威 CDN）。
 *   2. 强制 HTTPS；拒绝 IP 字面量 / 凭据 / 非 443 端口 / fragment / punycode
 *      混淆 / 尾点域名。
 *   3. DNS 解析结果必须为公网地址（拒绝内网 / loopback / link-local / CGNAT /
 *      IPv4-mapped IPv6），并 pinned HTTPS 请求（servername SNI 固定、不跟随
 *      系统解析）。
 *   4. 字节级 magic 校验 + sharp 解码（尺寸 / 像素上限）+ MIME 归一。
 *   5. 大小上限：与 product-batch 一致 2 MiB（PRODUCT_BATCH_MAX_IMAGE_BYTES）。
 *
 * 降级策略（不破坏导入）：
 *   任何下载 / 校验失败 → 返回 null（不写入快照，候选其余字段不变，
 *   视觉参考候选不可达时按既有 composition_concept 降级路径处理）。
 *   禁止把失败当作阻塞导入的理由；禁止把 AI 生成图反向当作真实商品参考。
 */

import { createHash } from "node:crypto";
import {
  downloadImageFromUrl,
  ImageUrlFetchError,
  type ImageUrlFetchResult,
} from "@/lib/server/aiImageUrlFetcher";
import { PRODUCT_BATCH_MAX_IMAGE_BYTES } from "@/lib/productBatchContract";
import type { ProductResearchImageSnapshot } from "@/lib/productResearchImage";

export const SELLERSPRITE_IMAGE_HOSTS = new Set([
  "m.media-amazon.com",
  "images-na.ssl-images-amazon.com",
]);

export type SellerSpriteFetchedProductImage = {
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png";
  sha256: string;
};

export class SellerSpriteProductImageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SellerSpriteProductImageError";
  }
}

/** 从既有预览行的商品主图 URL 安全下载（Amazon 主机白名单 + 公网 DNS + pinned HTTPS） */
export async function fetchSellerSpriteProductImage(
  imageUrl: string | null,
): Promise<SellerSpriteFetchedProductImage | null> {
  if (!imageUrl || !imageUrl.trim()) return null;
  let result: ImageUrlFetchResult;
  try {
    result = await downloadImageFromUrl(imageUrl.trim(), SELLERSPRITE_IMAGE_HOSTS);
  } catch (error) {
    // 降级：任何失败不中断导入，仅返回 null
    return null;
  }
  if (result.mimeType !== "image/jpeg" && result.mimeType !== "image/png") return null;
  if (result.bytes.length > PRODUCT_BATCH_MAX_IMAGE_BYTES) return null;
  return {
    bytes: result.bytes,
    mimeType: result.mimeType,
    sha256: result.sha256,
  };
}

export type SellerSpriteProductImageSnapshotInput = {
  fetched: SellerSpriteFetchedProductImage;
  asin: string;
  capturedAt: string;
};

/**
 * 构造任务自有商品图片快照（product-batch 兼容格式 v1）。
 * productKey 与 candidateIdentityHash 均从 ASIN 确定性派生 —
 * 与既有 SellerSprite sourceMeta 的身份键（Amazon US + ASIN）一致，
 * 保证 parseProductImageSnapshot 严格验证通过。
 */
export function buildSellerSpriteProductImageSnapshot(
  input: SellerSpriteProductImageSnapshotInput,
): ProductResearchImageSnapshot {
  const { fetched, asin, capturedAt } = input;
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    throw new SellerSpriteProductImageError("invalid_asin", "商品 ASIN 无效，无法构造图片快照。");
  }
  const productKey = `amazon:US:${asin}`;
  const candidateIdentityHash = createHash("sha256")
    .update(`sellersprite-candidate-identity:v1:${productKey}`)
    .digest("hex");
  const dataUrl = `data:${fetched.mimeType};base64,${fetched.bytes.toString("base64")}`;
  if (dataUrl.length > 2_800_000) {
    throw new SellerSpriteProductImageError("image_data_url_too_large", "商品图片超过内嵌存储上限。");
  }
  return {
    version: "product-batch-product-image.v1",
    source: "sellersprite_product_batch",
    status: "available",
    productKey,
    candidateIdentityHash,
    mimeType: fetched.mimeType,
    bytes: fetched.bytes.length,
    contentHash: fetched.sha256,
    dataUrl,
    capturedAt,
  };
}

export { ImageUrlFetchError };
