import "server-only";

let enabledForTests = false;

export function isRealAiListingEnabled() {
  return enabledForTests;
}

export function setRealAiListingEnabledForTests(enabled: boolean) {
  enabledForTests = enabled;
}
