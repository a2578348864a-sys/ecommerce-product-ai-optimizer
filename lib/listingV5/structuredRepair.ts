import type { ListingV5Context, ListingV5Strategy, ListingV5ValidationResult, ListingV5WriterDraft } from "./types";
import { generateListingV5Draft } from "./generation";

/** One bounded repair only. It never receives raw research and never changes facts. */
export async function repairListingV5Draft(input: {
  context: ListingV5Context;
  strategy: ListingV5Strategy;
  validation: ListingV5ValidationResult;
  useProvider?: boolean;
  onProviderCallStart?: () => void | Promise<void>;
}): Promise<{ draft: ListingV5WriterDraft; attempted: boolean; succeeded: boolean; diagnostics?: unknown }> {
  if (!input.validation.repair.allowed) return { ...(await generateListingV5Draft(input.context, input.strategy)), attempted: false, succeeded: false };
  const result = await generateListingV5Draft(input.context, input.strategy, { useProvider: input.useProvider, onProviderCallStart: input.onProviderCallStart });
  return { draft: result.draft, attempted: true, succeeded: result.providerSucceeded, diagnostics: result.diagnostics };
}
