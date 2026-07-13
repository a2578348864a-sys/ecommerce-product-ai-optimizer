import "server-only";

import { createHmac } from "crypto";
import { getAccessPassword } from "@/lib/server/accessPassword";

export function getProofSigningKey(purpose: string): Buffer | null {
  const configured = (process.env.PROOF_SIGNING_SECRET || "").trim();
  const secret = configured || (process.env.NODE_ENV === "production" ? "" : getAccessPassword());
  if (!secret) return null;
  return createHmac("sha256", secret).update(purpose).digest();
}
