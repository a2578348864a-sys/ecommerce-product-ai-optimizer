import type { ListingV5Context, ListingV5Strategy, ListingV5ValidationResult, ListingV5WriterDraft } from "./types";
import { callAiJson } from "@/lib/server/aiClient";
import { buildStageTrace, classifyAiErrorReason, type ListingV5StageTrace } from "./trace";

const MAX_REPAIR_TARGETS = 3;
const MAX_REPAIR_VIOLATIONS = 4;
const MAX_OFFENDING_SPANS = 6;
/**
 * Wrapper fields the provider may put the payload under. These are shape
 * variants of the same answer, not a failed repair.
 */
const REPAIR_CONTAINER_KEYS = ["repairs", "repair", "results", "items", "edits", "output", "result", "data"];
const BULLET_PATH = /^bullets\[(\d+)\]$/;
const strategyRiskWords = /\b(best|premium|perfect|guaranteed|waterproof|rustproof|durable|durability|leakproof|leak[- ]?resistant|spillproof|spill[- ]?proof|portable|insulated|insulation|heavy[- ]?duty|break[- ]?resistant|unbreakable|shatterproof)\b/gi;
const sanitizeStrategyForRepair = (strategy: ListingV5Strategy): ListingV5Strategy => {
  const scrub = (value: string) => value.replace(strategyRiskWords, "").replace(/\s{2,}/g, " ").trim();
  const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(scrub) : [];
  const keywordIntent = strategy.keywordIntent ?? { primary: [], secondary: [], backendOnly: [] };
  return {
    ...strategy,
    targetAudience: list(strategy.targetAudience),
    purchaseMotivations: list(strategy.purchaseMotivations),
    painPoints: list(strategy.painPoints),
    useCases: list(strategy.useCases),
    primaryAngle: scrub(typeof strategy.primaryAngle === "string" ? strategy.primaryAngle : ""),
    secondaryAngles: list(strategy.secondaryAngles),
    tone: list(strategy.tone),
    bulletAngles: Array.isArray(strategy.bulletAngles) ? strategy.bulletAngles.map((item) => ({ ...item, shopperValue: scrub(typeof item.shopperValue === "string" ? item.shopperValue : "") })) : [],
    avoidClaims: list(strategy.avoidClaims),
    keywordIntent,
  };
};

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
 * The repair request and the repair answer must not share field names, or the
 * model mirrors the request schema back and the answer never carries `text`
 * (observed twice against the real Provider). Input: `targets[].original`.
 * Output: `repairs[].text`. The two vocabularies are deliberately unrelated.
 */
const REPAIR_SYSTEM_PROMPT = [
  "Return JSON only. Return exactly this shape and nothing else:",
  '{"repairs":[{"path":"<one requested path>","text":"<replacement text>"}]}',
  'Every object in "repairs" has exactly two keys: "path" and "text".',
  '"path" must be copied from the requested targets; "text" must be the complete replacement text for that field.',
  "Do not return: original, source, currentText, factIds, strategyRole, issues, analysis, reason, explanation.",
  "Rewrite only the requested field.",
  "Each requested target lists violations. Every violating sentence carries offendingSpans: the exact words that no Confirmed Fact supports.",
  "Remove or rewrite every offending span.",
  "Do not preserve an offending span unless a Confirmed Fact supports it.",
  "Do not replace it with another unsupported hard claim (no new performance, certification, duration, temperature or absolute wording).",
  "offendingSpans explain why the text failed. They are not facts and are never a source of product facts; Confirmed Facts are the only factual authority.",
  "Preserve the supported product facts and the useful marketing meaning while dropping the unsupported wording.",
  "Repair exactly the requested listing text fields and nothing else. Preserve every other field verbatim.",
  "Keep the shopper benefit. Strategy is framing only.",
].join(" ");

type RepairViolation = { issueCode: string; sentence: string; offendingSpans: string[] };
type RepairRequestTarget = { path: string; original: string; issues: { structuralIssues: string[]; violations: RepairViolation[] } };

/**
 * The Validator reports the exact rejected words per sentence; the repair step
 * forwards them verbatim. When a caller supplies a validation object without
 * that evidence, the sentence is still forwarded with no span, so the model
 * learns the sentence is the problem instead of being told nothing.
 */
function violationsFor(validation: ListingV5ValidationResult, currentText: string): RepairViolation[] {
  const details = validation.claims?.unsupportedDetails;
  if (Array.isArray(details) && details.length > 0) {
    return details
      .filter((detail) => currentText.includes(detail.text))
      .slice(0, MAX_REPAIR_VIOLATIONS)
      .map((detail) => ({
        issueCode: detail.issueCode,
        sentence: detail.text,
        offendingSpans: Array.isArray(detail.offendingSpans) ? detail.offendingSpans.slice(0, MAX_OFFENDING_SPANS) : [],
      }));
  }
  return (validation.claims?.unsupportedClaims ?? [])
    .filter((claim) => currentText.includes(claim))
    .slice(0, MAX_REPAIR_VIOLATIONS)
    .map((claim) => ({ issueCode: "unsupported_claim", sentence: claim, offendingSpans: [] as string[] }));
}

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
}): Promise<{ draft: ListingV5WriterDraft; attempted: boolean; succeeded: boolean; appliedPaths: string[]; diagnostics?: unknown; responseShape?: string; trace: ListingV5StageTrace }> {
  const targets = collectRepairTargets(input.validation, input.draft);
  const notAttempted = (failureReason: Parameters<typeof buildStageTrace>[0]["failureReason"], attempted = false) =>
    ({ draft: input.draft, attempted, succeeded: false, appliedPaths: [] as string[], trace: buildStageTrace({ attempted, success: false, failureReason }) });
  if (!input.useProvider) return notAttempted("provider_disabled");
  if (!input.validation.repair.allowed) return notAttempted("repair_not_allowed");
  if (targets.length === 0) return notAttempted("repair_target_missing");

  const requested: RepairRequestTarget[] = targets.map((path) => {
    const original = currentTextFor(input.draft, path);
    const bulletIndex = Number(path.match(BULLET_PATH)?.[1] ?? -1);
    const structuralIssues = path === "description"
      ? input.validation.description?.issues ?? []
      : path === "title"
        ? input.validation.title?.issues ?? []
        : input.validation.bullets?.[bulletIndex]?.issues ?? [];
    const prohibitedClaims = (input.validation.claims?.prohibitedClaims ?? []).filter((claim) => original.includes(claim));
    return {
      path,
      original,
      issues: {
        structuralIssues,
        violations: [
          ...violationsFor(input.validation, original),
          ...prohibitedClaims.slice(0, MAX_REPAIR_VIOLATIONS).map((claim) => ({ issueCode: "prohibited_claim", sentence: claim, offendingSpans: [] as string[] })),
        ],
      },
    };
  });

  const response = await callAiJson<unknown>({
    messages: [
      { role: "system", content: REPAIR_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ targets: requested, confirmedFacts: input.context.confirmedFacts, strategy: sanitizeStrategyForRepair(input.strategy) }) },
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

  // ── response normalization ────────────────────────────────────────────────
  // A provider answer is the same answer whether it arrives as
  // {"repairs":[{...}]}, as a bare single-field object, or wrapped one level
  // deep. All three are unwrapped here. Nothing about the permissions changes:
  // every item must still name a requested target and carry non-empty text, and
  // `applyOne` still replaces text only.
  function isRepairItem(value: unknown): value is RepairItem {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /** Returns the accepted items plus the bounded path that produced them. */
  function collectRepairItems(payload: unknown): { items: RepairItem[]; wrapper: string } {
    const items: RepairItem[] = [];
    let wrapper = "none";
    const queue: Array<{ node: unknown; via: string }> = [{ node: payload, via: "root" }];
    const visited = new Set<unknown>();
    const limit = MAX_REPAIR_TARGETS * 4;
    while (queue.length > 0 && items.length < limit) {
      const entry = queue.shift()!;
      const current = entry.node;
      if (!isRepairItem(current) || visited.has(current)) continue;
      visited.add(current);
      const record = current as Record<string, unknown>;
      if (typeof record.path === "string" && typeof record.text === "string") {
        if (items.length === 0) wrapper = entry.via;
        items.push(record as RepairItem);
        continue;
      }
      for (const key of REPAIR_CONTAINER_KEYS) {
        const nested = record[key];
        if (Array.isArray(nested)) { nested.forEach((child, index) => queue.push({ node: child, via: `${entry.via}.${key}[${index}]` })); }
        else if (isRepairItem(nested)) queue.push({ node: nested, via: `${entry.via}.${key}` });
      }
    }
    return { items, wrapper };
  }

  /** Only a requested target is ever accepted; formatting differences are normalized. */
  function normalizeRepairPath(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const raw = value.trim();
    if (targets.includes(raw)) return raw;
    const loose = raw.toLowerCase().replace(/\s+/g, "");
    const exact = targets.find((target) => target.toLowerCase().replace(/\s+/g, "") === loose);
    if (exact) return exact;
    // Bounded tolerance for the bullet index syntax only.
    const bullet = /^bullets?(?:\[|\.)(\d+)\]?$/.exec(loose);
    if (bullet) {
      const canonical = `bullets[${bullet[1]}]`;
      if (targets.includes(canonical)) return canonical;
    }
    return null;
  }

  /**
   * Bounded, secret-free description of what came back, for diagnosis. It
   * records which container produced the items (`wrapper`) so a rejected
   * response can be told apart from a response that never carried one.
   */
  function describeShape(payload: unknown, items: RepairItem[], wrapper: string): string {
    const keys = isRepairItem(payload) ? Object.keys(payload as Record<string, unknown>).slice(0, 8).join(",") : typeof payload;
    const wrapperLabel = (wrapper.startsWith("root.") ? wrapper.slice("root.".length) : wrapper).slice(0, 60);
    const paths = items.map((item) => (typeof item.path === "string" ? item.path.slice(0, 40) : "?")).slice(0, 6).join("|");
    const present = items.map((item) => (typeof item.text === "string" && item.text.trim() ? "y" : "n")).slice(0, 6).join("|");
    const lengths = items.map((item) => (typeof item.text === "string" ? item.text.trim().length : -1)).slice(0, 6).join("|");
    return `keys=${keys};wrapper=${wrapperLabel};items=${items.length};paths=${paths};textPresent=${present};textLengths=${lengths}`;
  }

  const { items: rawItems, wrapper } = collectRepairItems(data);
  const responseShape = describeShape(data, rawItems, wrapper);
  if (rawItems.length === 0) {
    return { draft: input.draft, attempted: true, succeeded: false, appliedPaths: [], diagnostics: response.diagnostics, responseShape, trace: buildStageTrace({ attempted: true, success: false, failureReason: "repair_response_shape_invalid", response }) };
  }

  let draft = input.draft;
  const appliedPaths: string[] = [];
  for (const item of rawItems) {
    const path = normalizeRepairPath(item.path);
    // Only requested, not-yet-applied, in-range paths are accepted.
    if (!path || appliedPaths.includes(path)) continue;
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
    responseShape,
    trace: buildStageTrace({ attempted: true, success: succeeded, failureReason: succeeded ? "none" : "repair_response_shape_invalid", response }),
  };
}
