import { createHmac, createHash, timingSafeEqual } from "node:crypto";

function toBase64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function getSigningKey(): Buffer | null {
  const raw = (process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD || "").trim();
  if (!raw) return null;
  return createHmac("sha256", "qx-agent-signing-key-v1")
    .update(raw)
    .digest();
}

export const SELLERSPRITE_PREVIEW_IMPORT_PURPOSE = "qingxuan:sellersprite-preview-import:v1";

export function sellerSpritePreviewImportSubjectScopeHash(subjectScope: string): string {
  return createHmac("sha256", SELLERSPRITE_PREVIEW_IMPORT_PURPOSE)
    .update(subjectScope)
    .digest("hex")
    .toLowerCase();
}

export type SellerSpritePreviewImportTokenPayload = {
  version: string;
  subjectScopeHash: string;
  sourceFileSha256: string;
  acceptedRowsDigest: string;
  acceptedRowCount: number;
  warningDigest: string;
  warningCount: number;
  parserContractVersion: string;
  issuedAt: number;
  expiresAt: number;
};

export function generateSellerSpritePreviewImportToken(
  subjectScope: string,
  sourceFileSha256: string,
  acceptedRowsDigest: string,
  acceptedRowCount: number,
  warningDigest: string,
  warningCount: number,
  parserContractVersion: string
): string {
  const key = getSigningKey();
  if (!key) {
    throw new Error("SIGNING_KEY_MISSING");
  }

  const now = Date.now();
  const expiresAt = now + 300 * 1000; // 5 minutes

  const subjectScopeHash = sellerSpritePreviewImportSubjectScopeHash(subjectScope);

  const payload = {
    version: "sellersprite_preview_import_v1",
    subjectScopeHash,
    sourceFileSha256,
    acceptedRowsDigest,
    acceptedRowCount,
    warningDigest,
    warningCount,
    parserContractVersion,
    issuedAt: now,
    expiresAt
  };

  const payloadJson = JSON.stringify(payload);
  const signature = createHmac("sha256", key)
    .update(payloadJson)
    .digest();

  const b64Payload = toBase64url(Buffer.from(payloadJson, "utf-8"));
  const b64Sig = toBase64url(signature);

  return `preview-import-v1.${b64Payload}.${b64Sig}`;
}

export function verifySellerSpritePreviewImportToken(token: string): {
  ok: true;
  payload: SellerSpritePreviewImportTokenPayload;
} | {
  ok: false;
  reason: string;
} {
  const key = getSigningKey();
  if (!key) {
    return { ok: false, reason: "invalid_preview_token_signature" };
  }

  if (typeof token !== "string" || !token.startsWith("preview-import-v1.")) {
    return { ok: false, reason: "malformed_preview_token" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed_preview_token" };
  }

  const b64Payload = parts[1];
  const b64Sig = parts[2];
  const payloadJson = Buffer.from(b64Payload, "base64url").toString("utf-8");
  const payload = JSON.parse(payloadJson) as SellerSpritePreviewImportTokenPayload;

  // Signature verification
  const computedSig = createHmac("sha256", key).update(payloadJson).digest();
  if (!timingSafeEqual(Buffer.from(b64Sig, "base64url"), computedSig)) {
    return { ok: false, reason: "invalid_preview_token_signature" };
  }

  const now = Date.now();
  const issued = Number(payload.issuedAt);
  const expires = Number(payload.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) {
    return { ok: false, reason: "malformed_preview_token" };
  }
  if (now > expires + 30000) {
    return { ok: false, reason: "preview_token_expired" };
  }
  if (now < issued - 30000) {
    return { ok: false, reason: "preview_token_not_yet_valid" };
  }

  if (payload.version !== "sellersprite_preview_import_v1" || payload.parserContractVersion !== "sellersprite_preview_import_v1") {
    return { ok: false, reason: "preview_token_contract_mismatch" };
  }

  return { ok: true, payload };
}
