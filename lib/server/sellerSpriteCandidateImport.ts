/**
 * SellerSprite Candidate Import Authority — single public service.
 *
 * Dispatches on the server-side authentication context:
 * - Owner  → Prisma OpportunityCandidate store
 * - Visitor → demo-sandbox Candidate store
 *
 * Both paths return the exact same result DTO and never receive client
 * candidate data — they only trust server re-parsed rows.
 */
import type { AccessContext } from "@/lib/server/accessContext";
import { importOwnerSellerSpriteCandidates } from "@/lib/server/opportunityCandidateService";
import type {
  SellerSpriteImportRow,
  SellerSpriteImportSummary,
} from "@/lib/server/sellerSpriteImportContract";

export type SellerSpriteCandidateImportInput = {
  context: AccessContext;
  rows: SellerSpriteImportRow[];
  sourceFileSha256: string;
  importedAt: string;
};

export async function importSellerSpriteCandidates(
  input: SellerSpriteCandidateImportInput,
): Promise<SellerSpriteImportSummary> {
  const { rows, sourceFileSha256, importedAt } = input;
  return importOwnerSellerSpriteCandidates({ rows, sourceFileSha256, importedAt });
}
