import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  buildHumanAssistedRuntimeCommand,
  parseHumanAssistedCliArguments,
} from "./human-assisted-cli-options.mjs";

describe("human-assisted CLI options", () => {
  it("requires an explicit sample cap between 1 and 20", () => {
    expect(() => parseHumanAssistedCliArguments([
      "node",
      "human-assisted-cli.mjs",
      "--output",
      "run.json",
    ], "C:\\safe" )).toThrow("HUMAN_ASSISTED_MAX_SAMPLES_REQUIRED");

    expect(() => parseHumanAssistedCliArguments([
      "node",
      "human-assisted-cli.mjs",
      "--output",
      "run.json",
      "--max-samples",
      "21",
    ], "C:\\safe" )).toThrow("HUMAN_ASSISTED_MAX_SAMPLES_INVALID");
  });

  it("parses the authorized five-sample run without changing the output directory", () => {
    const cwd = resolve(process.cwd(), "evidence-root");
    const options = parseHumanAssistedCliArguments([
      "node",
      "human-assisted-cli.mjs",
      "--output",
      "evidence\\run.json",
      "--max-samples",
      "5",
    ], cwd);

    expect(options).toEqual({
      outputFile: resolve(cwd, "evidence", "run.json"),
      maxSamples: 5,
    });
  });

  it("launches the runtime through Node instead of spawning a Windows cmd shim", () => {
    const cwd = resolve(process.cwd(), "safe-runtime");
    const nodeExe = resolve(process.cwd(), "node.exe");
    expect(buildHumanAssistedRuntimeCommand(cwd, nodeExe)).toEqual({
      executable: nodeExe,
      args: [
        resolve(cwd, "node_modules/vitest/vitest.mjs"),
        "run",
        "tools/collectors/amazon/human-assisted.runtime.test.ts",
      ],
    });
  });
});
