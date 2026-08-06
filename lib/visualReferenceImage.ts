import { createHash } from "node:crypto";

/**
 * Visual Reference Preview — 安全商品图片读取（Shared）。
 *
 * 为 Creative Handoff 视觉参考候选提供服务端图片字节解码：
 * 候选图片以 dataUrl（base64, ≤2MiB）内嵌于候选快照
 * （sourceMetaJson.productImageSnapshot / analysisJson.productImageSnapshot），
 * 本模块负责确定性解码 + 字节级校验 + contentHash 断言。
 *
 * 安全边界：
 *  - 只接受已被严格 Parser 验证通过的快照（parseProductImageSnapshot
 *    已重算 sha256、校验 magic bytes、限制 2MiB 上限），本模块不再信任原始 base64；
 *  - 只返回字节流（content-type/长度），绝不返回原始 URL / 文件路径 / dataUrl 本身；
 *  - 调用方（Route）负责鉴权、Task/Candidate 归属、Visitor 隔离与缓存头。
 */

export type VisualReferenceImage = {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  contentHash: string;
  productKey: string;
  candidateIdentityHash: string;
};

/** 拒绝解码：快照解析失败或 contentHash 断言不一致（fail-closed） */
export class VisualReferenceImageError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "VisualReferenceImageError";
  }
}

/** 与 visualReferenceCandidates 相同的哈希原语（域分隔，不含原始 URL） */
export function hash256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * 从快照 dataUrl 解码图片字节，并断言 contentHash 与解析结果一致。
 * 返回 null 表示「候选存在但无可用图片」——调用方按 404 处理（不泄露差异）。
 */
export function decodeVisualReferenceImage(
  snapshot: { dataUrl: string; mimeType: string; contentHash: string; productKey: string; candidateIdentityHash: string } | null,
  expectedContentHash?: string,
): VisualReferenceImage | null {
  if (!snapshot) return null;
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(snapshot.dataUrl);
  if (!match || match[1] !== snapshot.mimeType || match[2].length % 4 !== 0) return null;

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length <= 0
    || bytes.length > 2 * 1024 * 1024
    || bytes.toString("base64") !== match[2]) {
    return null;
  }

  const isJpeg = bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff;
  const isPng = bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
  if ((match[1] === "image/jpeg" && !isJpeg) || (match[1] === "image/png" && !isPng)) {
    return null;
  }

  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (expectedContentHash !== undefined && actualHash !== expectedContentHash) {
    throw new VisualReferenceImageError(
      "visual_reference_content_hash_mismatch",
      "视觉参考图片内容校验失败。",
    );
  }

  return {
    bytes: new Uint8Array(bytes),
    mimeType: match[1] as "image/jpeg" | "image/png",
    contentHash: actualHash,
    productKey: snapshot.productKey,
    candidateIdentityHash: snapshot.candidateIdentityHash,
  };
}
