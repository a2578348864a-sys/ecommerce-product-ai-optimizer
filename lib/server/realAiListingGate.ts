import "server-only";

let enabledForTests = false;
let visitorEnabledForTests: boolean | null = null;

export function isRealAiListingEnabled() {
  return enabledForTests || process.env.OPENAI_LISTING_ENABLED === "true";
}

export function isRealAiVisitorListingEnabled() {
  if (visitorEnabledForTests !== null) return visitorEnabledForTests;
  return process.env.OPENAI_LISTING_VISITOR_ENABLED === "true";
}

export function setRealAiListingEnabledForTests(enabled: boolean) {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_LISTING_GATE");
  enabledForTests = enabled;
}

export function setRealAiVisitorListingEnabledForTests(enabled: boolean | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_LISTING_GATE");
  visitorEnabledForTests = enabled;
}
