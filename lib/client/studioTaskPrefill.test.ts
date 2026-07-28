import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractStudioTaskPrefill } from "./studioTaskPrefill";

describe("Studio task prefill", () => {
  it("projects existing task facts without requiring a task-shaped Studio", () => {
    expect(extractStudioTaskPrefill({
      id: "task-1",
      title: "Foldable Stand",
      materialText: "Aluminium stand with adjustable angle.",
      result: {
        category: "Home Office",
        sellingPoints: ["foldable", "adjustable"],
      },
    })).toEqual({
      taskId: "task-1",
      productName: "Foldable Stand",
      description: "Aluminium stand with adjustable angle.",
      category: "Home Office",
      sellingPoints: "foldable, adjustable",
    });
  });

  it("returns null for malformed task data", () => {
    expect(extractStudioTaskPrefill(null)).toBeNull();
    expect(extractStudioTaskPrefill({ id: "", title: "No id" })).toBeNull();
  });

  it("forwards the optional taskId into both independent Studio clients", () => {
    const listingPage = readFileSync(resolve(process.cwd(), "app/listing-studio/page.tsx"), "utf8");
    const imagePage = readFileSync(resolve(process.cwd(), "app/image-studio/page.tsx"), "utf8");
    const listingClient = readFileSync(resolve(process.cwd(), "components/listing-studio/ListingStudioClient.tsx"), "utf8");
    const imageClient = readFileSync(resolve(process.cwd(), "components/image-studio/ImageStudioClient.tsx"), "utf8");

    expect(listingPage).toMatch(/searchParams/);
    expect(listingPage).toMatch(/<ListingStudioClient taskId=\{taskId\}/);
    expect(imagePage).toMatch(/searchParams/);
    expect(imagePage).toMatch(/<ImageStudioClient taskId=\{taskId\}/);
    expect(listingClient).toMatch(/useStudioTaskPrefill\(taskId\)/);
    expect(imageClient).toMatch(/useStudioTaskPrefill\(taskId\)/);
  });
});
