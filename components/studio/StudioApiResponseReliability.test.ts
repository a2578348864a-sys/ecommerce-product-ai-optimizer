import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const listingSource = readFileSync(
  new URL("../listing-studio/ListingStudioClient.tsx", import.meta.url),
  "utf8",
);
const imageSource = readFileSync(
  new URL("../image-studio/ImageStudioClient.tsx", import.meta.url),
  "utf8",
);

describe("independent Studio API response reliability", () => {
  it.each([
    ["Listing Studio", listingSource],
    ["Image Studio", imageSource],
  ])("%s validates the response before parsing JSON", (_name, source) => {
    expect(source).toContain("readJsonApiResponse(response)");
    expect(source).toContain("studioErrorMessage");
    expect(source).not.toContain("await response.json().catch(() => null)");
  });
});
