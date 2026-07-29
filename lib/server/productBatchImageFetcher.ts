import "server-only";

import { createHash } from "node:crypto";

import {
  requestPinnedHttpsResponse,
  validateImageResultDns,
  validateImageResultUrl,
  type PinnedImageRequest,
  type ValidatedImageAddress,
} from "@/lib/server/aiImageUrlFetcher";
import { PRODUCT_BATCH_MAX_IMAGE_BYTES } from "@/lib/productBatchContract";

const AMAZON_IMAGE_HOSTS = new Set([
  "m.media-amazon.com",
  "images-na.ssl-images-amazon.com",
]);
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 1;

export type ProductBatchFetchedImage = {
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png";
  sha256: string;
};

export class ProductBatchImageFetchError extends Error {
  constructor(
    readonly code:
      | "image_url_rejected"
      | "image_dns_rejected"
      | "image_redirect_rejected"
      | "image_download_failed"
      | "image_download_timeout"
      | "image_too_large"
      | "image_type_rejected",
    message: string,
  ) {
    super(message);
    this.name = "ProductBatchImageFetchError";
  }
}

type AddressResolver = (hostname: string) => Promise<ValidatedImageAddress[]>;

export type ProductBatchImageFetchDependencies = {
  request?: PinnedImageRequest;
  resolveAddresses?: AddressResolver;
  timeoutMs?: number;
};

function fail(
  code: ProductBatchImageFetchError["code"],
  message: string,
): never {
  throw new ProductBatchImageFetchError(code, message);
}

function imageMime(bytes: Buffer): ProductBatchFetchedImage["mimeType"] | null {
  const jpeg = bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff;
  if (jpeg) return "image/jpeg";
  const png = bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
  return png ? "image/png" : null;
}

function headerMime(response: Response): string {
  const raw = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return raw === "image/jpg" ? "image/jpeg" : raw || "missing";
}

function allowedHeaderMime(value: string): boolean {
  return value === "missing"
    || value === "image/jpeg"
    || value === "image/png"
    || value === "application/octet-stream"
    || value === "binary/octet-stream";
}

async function requestFromAddresses(
  url: URL,
  addresses: ValidatedImageAddress[],
  signal: AbortSignal,
  request: PinnedImageRequest,
): Promise<Response> {
  let lastError: unknown;
  for (const address of addresses) {
    try {
      return await request(url, address, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error("PRODUCT_BATCH_IMAGE_CONNECTION_FAILED");
}

async function readBoundedBody(response: Response): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (Number.isFinite(parsed) && parsed > PRODUCT_BATCH_MAX_IMAGE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      fail("image_too_large", "商品图片超过 2 MiB 限制。");
    }
  }
  const reader = response.body?.getReader();
  if (!reader) fail("image_download_failed", "商品图片响应没有可读取内容。");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PRODUCT_BATCH_MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        fail("image_too_large", "商品图片超过 2 MiB 限制。");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProductBatchImageFetchError) throw error;
    fail("image_download_failed", "商品图片下载中断。");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may already be cancelled; no state is retained.
    }
  }
  return Buffer.concat(chunks);
}

export async function fetchSellerSpriteMainImage(
  rawUrl: string,
  dependencies: ProductBatchImageFetchDependencies = {},
): Promise<ProductBatchFetchedImage> {
  const request = dependencies.request ?? requestPinnedHttpsResponse;
  const resolveAddresses = dependencies.resolveAddresses ?? validateImageResultDns;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    dependencies.timeoutMs ?? DOWNLOAD_TIMEOUT_MS,
  );
  let currentUrl = rawUrl;
  let redirects = 0;
  try {
    for (;;) {
      let parsed: URL;
      try {
        parsed = validateImageResultUrl(currentUrl, AMAZON_IMAGE_HOSTS);
      } catch {
        fail("image_url_rejected", "商品主图地址不在允许范围内。");
      }
      let addresses: ValidatedImageAddress[];
      try {
        addresses = await resolveAddresses(parsed.hostname);
      } catch {
        fail("image_dns_rejected", "商品主图域名未通过公网地址校验。");
      }
      if (controller.signal.aborted) {
        fail("image_download_timeout", "商品图片下载超时。");
      }

      let response: Response;
      try {
        response = await requestFromAddresses(
          parsed,
          addresses,
          controller.signal,
          request,
        );
      } catch {
        if (controller.signal.aborted) {
          fail("image_download_timeout", "商品图片下载超时。");
        }
        fail("image_download_failed", "商品图片下载失败。");
      }

      if (response.status >= 300 && response.status < 400) {
        if (redirects >= MAX_REDIRECTS) {
          await response.body?.cancel().catch(() => undefined);
          fail("image_redirect_rejected", "商品图片重定向次数过多。");
        }
        const location = response.headers.get("location");
        if (!location) {
          await response.body?.cancel().catch(() => undefined);
          fail("image_redirect_rejected", "商品图片重定向地址无效。");
        }
        try {
          currentUrl = new URL(location, parsed).toString();
        } catch {
          await response.body?.cancel().catch(() => undefined);
          fail("image_redirect_rejected", "商品图片重定向地址无效。");
        }
        await response.body?.cancel().catch(() => undefined);
        redirects += 1;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        fail("image_download_failed", "商品图片下载失败。");
      }
      if (!allowedHeaderMime(headerMime(response))) {
        await response.body?.cancel().catch(() => undefined);
        fail("image_type_rejected", "商品图片响应类型不受支持。");
      }
      const bytes = await readBoundedBody(response);
      const mimeType = imageMime(bytes);
      if (!mimeType) fail("image_type_rejected", "商品图片字节不是 JPEG 或 PNG。");
      return {
        bytes,
        mimeType,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}
