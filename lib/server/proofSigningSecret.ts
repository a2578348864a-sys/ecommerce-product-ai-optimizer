import "server-only";

import { createHmac } from "crypto";

export function getProofSigningKey(purpose: string): Buffer | null {
  const configured = (process.env.PROOF_SIGNING_SECRET || "").trim();
  if (configured) {
    return createHmac("sha256", configured).update(purpose).digest();
  }
  if (process.env.NODE_ENV === "production") return null;
  const password = (process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD || "").trim();
  if (!password && process.env.PROOF_SIGNING_SECRET !== undefined) {
    return null;
  }
  const fallback = password || "local-single-user-proof-secret";
  return createHmac("sha256", fallback).update(purpose).digest();
}
