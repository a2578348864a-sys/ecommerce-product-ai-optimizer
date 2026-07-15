import { resolve } from "node:path";

export function parseHumanAssistedCliArguments(argv, cwd = process.cwd()) {
  const outputFlag = argv.indexOf("--output");
  if (outputFlag < 0 || !argv[outputFlag + 1]) {
    throw new Error("HUMAN_ASSISTED_OUTPUT_REQUIRED");
  }
  const maxSamplesFlag = argv.indexOf("--max-samples");
  if (maxSamplesFlag < 0 || !argv[maxSamplesFlag + 1]) {
    throw new Error("HUMAN_ASSISTED_MAX_SAMPLES_REQUIRED");
  }
  const maxSamples = Number(argv[maxSamplesFlag + 1]);
  if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 20) {
    throw new Error("HUMAN_ASSISTED_MAX_SAMPLES_INVALID");
  }
  return {
    outputFile: resolve(cwd, argv[outputFlag + 1]),
    maxSamples,
  };
}

export function buildHumanAssistedRuntimeCommand(
  cwd = process.cwd(),
  nodeExecutable = process.execPath,
) {
  return {
    executable: nodeExecutable,
    args: [
      resolve(cwd, "node_modules/vitest/vitest.mjs"),
      "run",
      "tools/collectors/amazon/human-assisted.runtime.test.ts",
    ],
  };
}
