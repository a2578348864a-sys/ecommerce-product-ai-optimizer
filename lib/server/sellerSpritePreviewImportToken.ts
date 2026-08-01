import { createHmac, timingSafeEqual } from "node:crypto";

const SELLERSPRITE_PREVIEW_IMPORT_MAX_TOKEN_UTF8_BYTES = 2048;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function toBase64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromBase64urlStrict(value: string): Buffer | null {
  if (!value || !BASE64URL_PATTERN.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.length === 0 || decoded.toString("base64url") !== value) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
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

function isSellerSpritePreviewImportTokenPayload(
  value: unknown,
): value is SellerSpritePreviewImportTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.version === "string" && payload.version.length > 0 &&
    typeof payload.subjectScopeHash === "string" && payload.subjectScopeHash.length > 0 &&
    typeof payload.sourceFileSha256 === "string" && payload.sourceFileSha256.length > 0 &&
    typeof payload.acceptedRowsDigest === "string" && payload.acceptedRowsDigest.length > 0 &&
    Number.isInteger(payload.acceptedRowCount) && Number(payload.acceptedRowCount) >= 0 &&
    typeof payload.warningDigest === "string" && payload.warningDigest.length > 0 &&
    Number.isInteger(payload.warningCount) && Number(payload.warningCount) >= 0 &&
    typeof payload.parserContractVersion === "string" && payload.parserContractVersion.length > 0 &&
    typeof payload.issuedAt === "number" && Number.isFinite(payload.issuedAt) &&
    typeof payload.expiresAt === "number" && Number.isFinite(payload.expiresAt)
  );
}

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
  if (Buffer.byteLength(token, "utf-8") > SELLERSPRITE_PREVIEW_IMPORT_MAX_TOKEN_UTF8_BYTES) {
    return { ok: false, reason: "malformed_preview_token" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "malformed_preview_token" };
  }

  const b64Payload = parts[1];
  const b64Sig = parts[2];
  const payloadBytes = fromBase64urlStrict(b64Payload);
  if (!payloadBytes) {
    return { ok: false, reason: "malformed_preview_token" };
  }

  let payloadJson: string;
  let parsedPayload: unknown;
  try {
    payloadJson = new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes);
    parsedPayload = JSON.parse(payloadJson) as unknown;
  } catch {
    return { ok: false, reason: "malformed_preview_token" };
  }
  if (!parsedPayload || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) {
    return { ok: false, reason: "malformed_preview_token" };
  }

  // Signature verification
  const computedSig = createHmac("sha256", key).update(payloadJson).digest();
  const providedSig = fromBase64urlStrict(b64Sig);
  if (!providedSig || providedSig.length !== computedSig.length) {
    return { ok: false, reason: "invalid_preview_token_signature" };
  }
  if (!timingSafeEqual(providedSig, computedSig)) {
    return { ok: false, reason: "invalid_preview_token_signature" };
  }

  if (!isSellerSpritePreviewImportTokenPayload(parsedPayload)) {
    return { ok: false, reason: "malformed_preview_token" };
  }
  const payload = parsedPayload;

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
