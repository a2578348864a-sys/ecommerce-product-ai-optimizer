import { describe, expect, it } from "vitest";
import { homeWorkflowSteps } from "@/components/HomeDashboardClient";

describe("home dashboard workflow identity", () => {
  it("uses a unique business id even when several steps open the same page", () => {
    expect(homeWorkflowSteps.filter((step) => step.href === "/tasks")).toHaveLength(3);
    expect(new Set(homeWorkflowSteps.map((step) => step.id)).size).toBe(homeWorkflowSteps.length);
  });
});
