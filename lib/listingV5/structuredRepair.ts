import type { ListingV5Context, ListingV5Strategy, ListingV5ValidationResult, ListingV5WriterDraft } from "./types";
import { callAiJson } from "@/lib/server/aiClient";

function firstRepairPath(validation: ListingV5ValidationResult):
  | { kind: "title" }
  | { kind: "description" }
  | { kind: "bullet"; index: number }
  | null {
  const bulletIndex = validation.bullets.findIndex((item) => !item.valid);
  if (bulletIndex >= 0) return { kind: "bullet", index: bulletIndex };
  if (!validation.title.valid) return { kind: "title" };
  if (!validation.description.valid) return { kind: "description" };
  return null;
}

function applyRepair(draft: ListingV5WriterDraft, target: ReturnType<typeof firstRepairPath>, text: string): ListingV5WriterDraft | null {
  if (!target || !text.trim()) return null;
  if (target.kind === "title") return { ...draft, title: { ...draft.title, text: text.trim() } };
  if (target.kind === "description") return { ...draft, description: { ...draft.description, text: text.trim() } };
  if (!draft.bullets[target.index]) return null;
  const bullets = draft.bullets.slice();
  bullets[target.index] = { ...bullets[target.index]!, text: text.trim() };
  return { ...draft, bullets };
}

/** One bounded repair only. It never receives raw research and changes only the invalid text field. */
export async function repairListingV5Draft(input: {
  context: ListingV5Context;
  strategy: ListingV5Strategy;
  validation: ListingV5ValidationResult;
  draft: ListingV5WriterDraft;
  useProvider?: boolean;
  onProviderCallStart?: () => void | Promise<void>;
}): Promise<{ draft: ListingV5WriterDraft; attempted: boolean; succeeded: boolean; diagnostics?: unknown }> {
  const target = firstRepairPath(input.validation);
  if (!input.validation.repair.allowed || !target || !input.useProvider) {
    return { draft: input.draft, attempted: false, succeeded: false };
  }
  const targetLabel = target.kind === "bullet" ? `bullets[${target.index}]` : target.kind;
  const currentText = target.kind === "title"
    ? input.draft.title.text
    : target.kind === "description"
      ? input.draft.description.text
      : input.draft.bullets[target.index]?.text ?? "";
  const response = await callAiJson<unknown>({
    messages: [
      { role: "system", content: "Return JSON only as {path,text}. Repair exactly one listing text field. Preserve every other field verbatim. Use only confirmed fact IDs and values. Strategy is framing only. Never add unsupported, prohibited, performance, certification, or competitor claims." },
      { role: "user", content: JSON.stringify({ path: targetLabel, currentText, issues: input.validation, confirmedFacts: input.context.confirmedFacts, strategy: input.strategy }) },
    ],
    temperature: 0.2,
    maxTokens: 900,
    onProviderCallStart: input.onProviderCallStart,
  });
  if (!response.ok || !response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return { draft: input.draft, attempted: response.providerCallStarted === true, succeeded: false, diagnostics: response.diagnostics };
  }
  const value = response.data as { path?: unknown; text?: unknown };
  if (value.path !== targetLabel || typeof value.text !== "string") {
    return { draft: input.draft, attempted: true, succeeded: false, diagnostics: response.diagnostics };
  }
  const repaired = applyRepair(input.draft, target, value.text);
  return repaired
    ? { draft: repaired, attempted: true, succeeded: true, diagnostics: response.diagnostics }
    : { draft: input.draft, attempted: true, succeeded: false, diagnostics: response.diagnostics };
}
