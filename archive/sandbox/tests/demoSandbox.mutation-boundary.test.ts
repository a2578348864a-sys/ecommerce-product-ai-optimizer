import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SandboxTaskPatch } from "@/lib/server/demoSandbox";

const sandboxSource = readFileSync(resolve(process.cwd(), "lib/server/demoSandbox.ts"), "utf8");
const mutationSource = readFileSync(resolve(process.cwd(), "lib/server/taskResultJsonMutation.ts"), "utf8");

describe("sandbox task mutation export boundary", () => {
  function productionTypeScriptFiles(root: string): string[] {
    const output: string[] = [];
    for (const name of readdirSync(root)) {
      const path = resolve(root, name);
      if (statSync(path).isDirectory()) output.push(...productionTypeScriptFiles(path));
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) output.push(path);
    }
    return output;
  }

  it("does not export the superseded full-document writers", () => {
    expect(sandboxSource).not.toMatch(/export function updateSandboxTaskResearchRecordCas/);
    expect(sandboxSource).not.toMatch(/export function updateSandboxTaskLifecycle/);
    expect(sandboxSource).not.toMatch(/export function saveDemoSandboxStore/);
    expect(sandboxSource).not.toMatch(/export function mutateSandboxTaskAtomic/);
  });

  it("keeps the generic task patch metadata-only at the type boundary", () => {
    const allowed: SandboxTaskPatch = {
      title: "Synthetic",
      score: 1,
      level: "low",
      oneLineSummary: "Synthetic",
    };
    expect(allowed).toBeDefined();
    expect(sandboxSource).not.toMatch(/interface SandboxTaskPatch\s*{[\s\S]*?resultJson\?:/);
    expect(sandboxSource).not.toMatch(/interface SandboxTaskPatch\s*{[\s\S]*?decisionStatus\?:/);
    expect(sandboxSource).not.toMatch(/interface SandboxTaskPatch\s*{[\s\S]*?productLifecycle\?:/);
  });

  it("exposes only a narrow Legacy decision updater", () => {
    expect(mutationSource).toContain("updateLegacySandboxTaskDecisionStatusAtomic");
  });

  it("allows only the shared mutation adapter to import the low-level full-task CAS", () => {
    const offenders = ["app", "lib", "components"]
      .flatMap((folder) => productionTypeScriptFiles(resolve(process.cwd(), folder)))
      .filter((path) => readFileSync(path, "utf8").includes("demoSandboxTaskMutation.internal"))
      .map((path) => path.replaceAll("\\", "/").replace(`${process.cwd().replaceAll("\\", "/")}/`, ""));
    expect(offenders).toEqual(["lib/server/taskResultJsonMutation.ts"]);
  });
});
