import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("task product-name display wiring", () => {
  it("uses the shared display projection in task detail and history", () => {
    const detailSource = readFileSync(
      resolve(process.cwd(), "components/TaskRecordDetail.tsx"),
      "utf8",
    );
    const summarySource = readFileSync(
      resolve(process.cwd(), "lib/taskWorkflowSummary.ts"),
      "utf8",
    );

    expect(detailSource).toContain("resolveTaskProductDisplayName");
    expect(summarySource).toContain("resolveTaskProductDisplayName");
  });

  it("keeps the persisted task-title contract unchanged", () => {
    const saveRouteSource = readFileSync(
      resolve(process.cwd(), "app/api/workflows/product-analysis/save-task/route.ts"),
      "utf8",
    );

    expect(saveRouteSource).toContain("title: `${productName} 一键分析`");
  });
});
