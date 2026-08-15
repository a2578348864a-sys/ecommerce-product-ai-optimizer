/**
 * V3.5 — 1688 Image Acquisition 业务层（ImageAcquisitionDriver 门面）
 *
 * Contract §31/§37/§77：
 * - 图片只能来自：已知 Candidate image（服务端校验 URL）或用户明确选择的本地图片。
 * - 任意 Web 请求不能读取本机文件：图片 URL 必须 https + 公网解析（SSRF 守卫）+ 大小/类型限制。
 * - 下载到临时目录（有界），驱动完成后清理。
 * - 图搜结果 = Candidate Discovery（AcquisitionCandidate，matchState=unknown，sourceProductRole=similar），
 *   不自动成为 Evidence（Preview → Human Confirm 不变）。
 */

import "server-only";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidTargetUrl } from "@/lib/server/ssrfGuard";
import { SourcingAcquisitionError, type AcquisitionCandidate } from "@/lib/upstream/1688/contracts";
import {
  runNativeImageSearch,
  ImageSearchDriverError,
} from "@/tools/collectors/1688/image-search-driver";
import type { ImageAcquisitionRunTrace } from "@/tools/collectors/1688/image-search-contract";

export const IMAGE_ACQUISITION_DRIVER_VERSION = "local-1688-image-driver.v1";
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);

function fail(code: string, status: number, message: string): never {
  throw new SourcingAcquisitionError(code, status, message);
}

/** 下载候选图片到临时目录（SSRF 守卫 + 大小/类型限制）；返回绝对路径 + base64 长度 */
async function downloadCandidateImage(imageUrl: string): Promise<{ path: string; base64Length: number }> {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    fail("invalid_image_url", 400, "候选图片链接非法。");
  }
  if (url.protocol !== "https:") fail("invalid_image_url", 400, "候选图片仅支持 https 链接。");
  const safe = await isValidTargetUrl(url);
  if (!safe) fail("invalid_image_url", 400, "候选图片链接未通过安全校验（禁止内网/本地地址）。");

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
  if (!response.ok) fail("image_download_failed", 502, "候选图片下载失败。");
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    fail("invalid_image_url", 400, `候选图片类型不支持（${contentType || "unknown"}）。`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES) {
    fail("invalid_image_url", 400, "候选图片大小超出限制（≤30MB）。");
  }
  const dir = await mkdtemp(join(tmpdir(), "v35-1688-image-"));
  const path = join(dir, "candidate-image.bin");
  await writeFile(path, bytes);
  return { path, base64Length: Math.ceil(bytes.length / 3) * 4 };
}

/**
 * 图片找货：候选图片 URL → 1688 原生图搜 → AcquisitionCandidate[]（+ trace）
 * 运行期间浏览器会话为前台窗口（FULLY_AUTOMATED_IN_ACTIVE_FOREGROUND_BROWSER_SESSION）。
 */
export async function acquireByImage(input: {
  imageUrl: string;
  capturedAt?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): Promise<{ candidates: AcquisitionCandidate[]; trace: ImageAcquisitionRunTrace }> {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const { path, base64Length } = await downloadCandidateImage(input.imageUrl);
  const tempDir = path.split("candidate-image.bin")[0];
  try {
    const result = await runNativeImageSearch({
      imagePath: path,
      imageBase64Length: base64Length,
      env: input.env,
      signal: input.signal,
    });
    const candidates: AcquisitionCandidate[] = result.cards.map((card) => ({
      schema: "acquisition-candidate.v1",
      source: "1688",
      offerId: card.offerId,
      sourceUrl: card.detailUrl ?? `https://detail.1688.com/offer/${card.offerId}.html`,
      capturedAt,
      acquisitionMethod: "image",
      sourceProductRole: "similar",
      title: card.title,
      images: card.imageUrl ? [card.imageUrl] : [],
      displayedPrice: card.priceText ? { text: card.priceText, nature: "displayed_price" } : null,
      priceRange: null,
      priceTiers: [],
      displayedMoq: card.moqText ? { text: card.moqText, value: null, nature: "displayed_moq" } : null,
      skuSpecs: [],
      sellerClaims: [],
      platformMetadata: [],
      supplierDisplayName: card.supplierName ?? "",
      matchState: "unknown",
    }));
    return { candidates, trace: result.trace };
  } finally {
    // 清理本次下载的临时图片（有界 temp scope，§77）
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 错误归一化（browser driver → 业务错误分类 §53） */
export function normalizeImageAcquisitionError(error: unknown): { code: string; status: number; message: string } {
  if (error instanceof ImageSearchDriverError) {
    return { code: error.code, status: error.status, message: error.message };
  }
  if (error instanceof SourcingAcquisitionError) {
    return { code: error.code, status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "browser_not_ready", status: 503, message: `图片获取失败：${message.slice(0, 200)}` };
}
