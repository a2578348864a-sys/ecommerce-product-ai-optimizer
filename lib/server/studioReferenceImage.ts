import "server-only";

import {
  decodeAiImageBase64,
  validateAiImageBytes,
} from "@/lib/server/aiImageDraftStorage";

export class StudioReferenceImageError extends Error {
  readonly code = "invalid_reference_image";
  readonly status = 400;

  constructor(message = "参考图无效，请上传单张 10MB 以内的 PNG、JPEG 或 WebP 图片。") {
    super(message);
    this.name = "StudioReferenceImageError";
  }
}

/**
 * Manual Image Studio 参考图门禁。
 *
 * JSON 层的正则只负责限制 data URL 形状；这里复用正式图片存储的大小、magic bytes、
 * 完整解码、尺寸、像素数和单帧校验，避免把文件扩展名或浏览器 MIME 当成事实。
 */
export async function validateStudioReferenceImageDataUrl(dataUrl: string | undefined) {
  if (!dataUrl) return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
  if (!match) throw new StudioReferenceImageError();

  try {
    const bytes = decodeAiImageBase64(match[2]);
    const validated = await validateAiImageBytes(bytes);
    if (validated.mimeType !== match[1]) throw new StudioReferenceImageError();
    return {
      bytes,
      mimeType: validated.mimeType,
      width: validated.width,
      height: validated.height,
      fileSizeBytes: bytes.length,
    };
  } catch (error) {
    if (error instanceof StudioReferenceImageError) throw error;
    throw new StudioReferenceImageError();
  }
}
