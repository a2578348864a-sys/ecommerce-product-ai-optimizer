import "server-only";

let enabledForTests = false;
let visitorEnabledForTests: boolean | null = null;

export function isRealAiImageEnabled(): boolean {
  return enabledForTests || process.env.OPENAI_IMAGE_GENERATION_ENABLED === "true";
}

export function isRealAiVisitorImageEnabled(): boolean {
  if (visitorEnabledForTests !== null) return visitorEnabledForTests;
  return process.env.OPENAI_IMAGE_VISITOR_ENABLED === "true";
}

export function setRealAiImageEnabledForTests(enabled: boolean): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_IMAGE_GATE");
  enabledForTests = enabled;
}

export function setRealAiVisitorImageEnabledForTests(enabled: boolean | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_IMAGE_GATE");
  visitorEnabledForTests = enabled;
}
