import type { ListingV5Context, ListingV5Strategy, ListingV5ValidationResult, ListingV5WriterDraft } from "./types";
import { callAiJson } from "@/lib/server/aiClient";
import { buildStageTrace, classifyAiErrorReason, type ListingV5StageTrace } from "./trace";

const MAX_REPAIR_TARGETS = 3;
const BULLET_PATH = /^bullets\[(\d+)\]$/;

/**
 * Bounded repair targets come from the validator: it already decided which
 * fields are repairable (structural problems first, then the fields that carry
 * a locally repairable claim). Only these paths may ever be rewritten.
 */
export function collectRepairTargets(validation: ListingV5ValidationResult, draft: ListingV5WriterDraft): string[] {
  const declared = Array.isArray(validation.repair.targets) ? validation.repair.targets : [];
  const usable = declared.filter((path) => {
    if (path === "title" || path === "description") return true;
    const match = path.match(BULLET_PATH);
    return match !== null && Number(match[1]) < draft.bullets.length;
  });
  if (usable.length > 0) return [...new Set(usable)].slice(0, MAX_REPAIR_TARGETS);
  // Backward-compatible derivation when a caller supplies a validation object
  // without explicit targets.
  const derived: string[] = [];
  validation.bullets.forEach((bullet, index) => { if (!bullet.valid) derived.push(`bullets[${index}]`); });
  if (!validation.title.valid) derived.push("title");
  if (!validation.description.valid) derived.push("description");
  return [...new Set(derived)].slice(0, MAX_REPAIR_TARGETS);
}

function currentTextFor(draft: ListingV5WriterDraft, path: string): string {
  if (path === "title") return draft.title.text;
  if (path === "description") return draft.description.text;
  const match = path.match(BULLET_PATH);
  return match ? draft.bullets[Number(match[1])]?.text ?? "" : "";
}

function applyOne(draft: ListingV5WriterDraft, path: string, text: string): ListingV5WriterDraft | null {
  if (!text.trim()) return null;
  if (path === "title") return { ...draft, title: { ...draft.title, text: text.trim() } };
  if (path === "description") return { ...draft, description: { ...draft.description, text: text.trim() } };
  const match = path.match(BULLET_PATH);
  if (!match) return null;
  const index = Number(match[1]);
  if (!draft.bullets[index]) return null;
  const bullets = draft.bullets.slice();
  bullets[index] = { ...bullets[index]!, text: text.trim() };
  return { ...draft, bullets };
}

type RepairItem = { path?: unknown; text?: unknown };

/**
 * One bounded repair pass over up to three text fields. The repair request
 * never receives raw research and can only rewrite the whitelisted paths; every
 * other field (fact ids, strategy roles, title, search terms) is preserved.
 */
export async function repairListingV5Draft(input: {
  context: ListingV5Context;
  strategy: ListingV5Strategy;
  validation: ListingV5ValidationResult;
  draft: ListingV5WriterDraft;
  useProvider?: boolean;
  onProviderCallStart?: () => void | Promise<void>;
}): Promise<{ draft: ListingV5WriterDraft; attempted: boolean; succeeded: boolean; appliedPaths: string[]; diagnostics?: unknown; trace: ListingV5StageTrace }> {
  const targets = collectRepairTargets(input.validation, input.draft);
  const notAttempted = (failureReason: Parameters<typeof buildStageTrace>[0]["failureReason"], attempted = false) =>
    ({ draft: input.draft, attempted, succeeded: false, appliedPaths: [] as string[], trace: buildStageTrace({ attempted, success: false, failureReason }) });
  if (!input.useProvider) return notAttempted("provider_disabled");
  if (!input.validation.repair.allowed) return notAttempted("repair_not_allowed");
  if (targets.length === 0) return notAttempted("repair_target_missing");

  const requested = targets.map((path) => {
    const currentText = currentTextFor(input.draft, path);
    const bulletIndex = Number(path.match(BULLET_PATH)?.[1] ?? -1);
    return {
      path,
      currentText,
      issues: {
        unsupportedClaims: (input.validation.claims?.unsupportedClaims ?? []).filter((claim) => currentText.includes(claim)),
        prohibitedClaims: (input.validation.claims?.prohibitedClaims ?? []).filter((claim) => currentText.includes(claim)),
        structuralIssues: path === "description"
          ? input.validation.description?.issues ?? []
          : path === "title"
            ? input.validation.title?.issues ?? []
            : input.validation.bullets?.[bulletIndex]?.issues ?? [],
      },
    };
  });

  const response = await callAiJson<unknown>({
    messages: [
      { role: "system", content: "Return JSON only as {repairs:[{path,text}]}. Repair exactly the requested listing text fields and nothing else. Preserve every other field verbatim. A repaired field must not introduce any unsupported, prohibited, performance, certification, duration, numeric, or competitor claim; remove the offending wording instead of restating it. Use only confirmed fact IDs and values for product facts. Strategy is framing only." },
      { role: "user", content: JSON.stringify({ repairs: requested, confirmedFacts: input.context.confirmedFacts, strategy: input.strategy }) },
    ],
    temperature: 0.2,
    maxTokens: 2000,
    thinkingMode: "disabled",
    onProviderCallStart: input.onProviderCallStart,
  });
  if (!response.ok) {
    const attempted = response.providerCallStarted === true;
    return {
      draft: input.draft,
      attempted,
      succeeded: false,
      appliedPaths: [],
      diagnostics: response.diagnostics,
      trace: buildStageTrace({
        attempted,
        success: false,
        failureReason: attempted ? classifyAiErrorReason(response.error) : "provider_not_started",
        response,
      }),
    };
  }
  const data = response.data;
  const rawItems: RepairItem[] = (() => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.repairs)) return record.repairs.filter((item): item is RepairItem => typeof item === "object" && item !== null && !Array.isArray(item));
    // Tolerate the legacy single-field shape.
    if (typeof record.path === "string" && typeof record.text === "string") return [record as RepairItem];
    return [];
  })();
  if (rawItems.length === 0) {
    return { draft: input.draft, attempted: true, succeeded: false, appliedPaths: [], diagnostics: response.diagnostics, trace: buildStageTrace({ attempted: true, success: false, failureReason: "repair_response_shape_invalid", response }) };
  }

  let draft = input.draft;
  const appliedPaths: string[] = [];
  for (const item of rawItems) {
    const path = typeof item.path === "string" ? item.path : "";
    // Only requested, not-yet-applied, in-range paths are accepted.
    if (!targets.includes(path) || appliedPaths.includes(path)) continue;
    if (typeof item.text !== "string" || !item.text.trim()) continue;
    const next = applyOne(draft, path, item.text);
    if (!next) continue;
    draft = next;
    appliedPaths.push(path);
  }

  const succeeded = appliedPaths.length === targets.length && appliedPaths.length > 0;
  return {
    draft,
    attempted: true,
    succeeded,
    appliedPaths,
    diagnostics: response.diagnostics,
    trace: buildStageTrace({ attempted: true, success: succeeded, failureReason: succeeded ? "none" : "repair_response_shape_invalid", response }),
  };
}
