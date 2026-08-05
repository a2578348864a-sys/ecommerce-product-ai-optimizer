import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx|mjs)$/.test(entry)) files.push(path);
  }
  return files;
}

function importers(fragment: string) {
  return [join(process.cwd(), "app"), join(process.cwd(), "lib"), join(process.cwd(), "scripts")]
    .flatMap(sourceFiles)
    .filter((path) => relative(process.cwd(), path).replaceAll("\\", "/") !== "lib/server/mutationBoundary.test.ts")
    .filter((path) => readFileSync(path, "utf8").includes(fragment))
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
    .sort();
}

describe("task and Visitor Store internal mutation boundaries", () => {
  it("keeps the Visitor Store I/O owner behind the two approved adapters", () => {
    expect(importers("@/lib/server/demoSandboxStore.internal")).toEqual([
      "lib/server/demoSandbox.ts",
      "lib/server/demoSandboxTaskMutation.internal.ts",
    ]);
    expect(importers("@/lib/server/demoSandboxTaskMutation.internal").filter((path) => !path.includes(".test."))).toEqual([
      "lib/server/taskResultJsonMutation.ts",
    ]);
  });

  it("keeps Owner low-level CAS and test support out of production callers", () => {
    expect(importers("@/lib/server/taskResultJsonMutation.owner.internal")).toEqual([
      "lib/server/taskResultJsonMutation.testSupport.ts",
      "lib/server/taskResultJsonMutation.ts",
    ]);
    // PR2-2 Final-Fix (P1-2): 并发 e2e 经公开 test-support 适配器访问 CAS（不再直接 import owner.internal）
    expect(importers("@/lib/server/taskResultJsonMutation.testSupport")).toEqual([
      "lib/listingHandoff/listingHandoffConcurrency.e2e.test.ts",
      "lib/server/taskResultJsonMutation.sqlite.test.ts",
    ]);
    const publicModule = readFileSync(join(process.cwd(), "lib/server/taskResultJsonMutation.ts"), "utf8");
    expect(publicModule).not.toContain("export async function loadOwnerTaskResultJsonSnapshot");
    expect(publicModule).not.toContain("export async function commitOwnerTaskResultJsonMutation");
    expect(publicModule).not.toContain("mutateOwnerTaskResultJsonForTest");
  });
});
