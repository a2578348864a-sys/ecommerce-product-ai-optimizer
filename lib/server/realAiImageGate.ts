import "server-only";

let enabledForTests = false;

export function isRealAiImageEnabled(): boolean {
  return enabledForTests || process.env.OPENAI_IMAGE_GENERATION_ENABLED === "true";
}

export function setRealAiImageEnabledForTests(enabled: boolean): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_IMAGE_GATE");
  enabledForTests = enabled;
}
