import { describe, expect, it, vi } from "vitest";

import {
  fetchSellerSpriteMainImage,
} from "@/lib/server/productBatchImageFetcher";
import type { PinnedImageRequest } from "@/lib/server/aiImageUrlFetcher";

const PUBLIC_ADDRESSES = async () => [{ address: "203.0.113.10", family: 4 as const }];
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

function response(
  body: BodyInit | null,
  init: ResponseInit = {},
): PinnedImageRequest {
  return vi.fn(async () => new Response(body, init));
}

describe("SellerSprite Amazon main-image fallback", () => {
  it.each([
    "https://m.media-amazon.com/images/I/example.jpg",
    "https://images-na.ssl-images-amazon.com/images/I/example.png",
  ])("allows only the fixed Amazon image hosts: %s", async (url) => {
    const result = await fetchSellerSpriteMainImage(url, {
      resolveAddresses: PUBLIC_ADDRESSES,
      request: response(JPEG_BYTES, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    });

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.bytes).toEqual(JPEG_BYTES);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    "https://example.com/image.jpg",
    "https://127.0.0.1/image.jpg",
    "https://localhost/image.jpg",
    "http://m.media-amazon.com/image.jpg",
    "file:///tmp/image.jpg",
    "data:image/png;base64,AA==",
    "javascript:alert(1)",
    "https://user:password@m.media-amazon.com/image.jpg",
  ])("rejects an untrusted URL before any request: %s", async (url) => {
    const request = response(JPEG_BYTES);
    await expect(fetchSellerSpriteMainImage(url, {
      resolveAddresses: PUBLIC_ADDRESSES,
      request,
    })).rejects.toMatchObject({ code: "image_url_rejected" });
    expect(request).not.toHaveBeenCalled();
  });

  it("revalidates every redirect and rejects a non-whitelisted target", async () => {
    const request = response(null, {
      status: 302,
      headers: { location: "https://example.com/escaped.jpg" },
    });
    await expect(fetchSellerSpriteMainImage(
      "https://m.media-amazon.com/images/I/redirect.jpg",
      { resolveAddresses: PUBLIC_ADDRESSES, request },
    )).rejects.toMatchObject({ code: "image_url_rejected" });
    expect(request).toHaveBeenCalledOnce();
  });

  it("enforces both Content-Length and streaming 2 MiB bounds", async () => {
    await expect(fetchSellerSpriteMainImage(
      "https://m.media-amazon.com/images/I/large.jpg",
      {
        resolveAddresses: PUBLIC_ADDRESSES,
        request: response(null, {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": String(2 * 1024 * 1024 + 1),
          },
        }),
      },
    )).rejects.toMatchObject({ code: "image_too_large" });

    const oversized = Buffer.concat([JPEG_BYTES, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(fetchSellerSpriteMainImage(
      "https://m.media-amazon.com/images/I/stream-large.jpg",
      {
        resolveAddresses: PUBLIC_ADDRESSES,
        request: response(oversized, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      },
    )).rejects.toMatchObject({ code: "image_too_large" });
  });

  it("uses magic bytes as authority and rejects SVG or damaged content", async () => {
    const png = await fetchSellerSpriteMainImage(
      "https://m.media-amazon.com/images/I/claimed-jpeg.jpg",
      {
        resolveAddresses: PUBLIC_ADDRESSES,
        request: response(PNG_BYTES, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      },
    );
    expect(png.mimeType).toBe("image/png");

    await expect(fetchSellerSpriteMainImage(
      "https://m.media-amazon.com/images/I/image.svg",
      {
        resolveAddresses: PUBLIC_ADDRESSES,
        request: response("<svg/>", {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
        }),
      },
    )).rejects.toMatchObject({ code: "image_type_rejected" });
  });

  it("stops a request at the total timeout", async () => {
    const request: PinnedImageRequest = vi.fn((_url, _address, signal) => (
      new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      })
    ));
    await expect(fetchSellerSpriteMainImage(
      "https://m.media-amazon.com/images/I/slow.jpg",
      {
        resolveAddresses: PUBLIC_ADDRESSES,
        request,
        timeoutMs: 5,
      },
    )).rejects.toMatchObject({ code: "image_download_timeout" });
  });
});
