import { isAbsolute, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { generateStage15SourceNativeResult } from "./generate-stage15-source-native-result";

const keys = ["RUN_STAGE15_SOURCE_NATIVE_RESULT", "STAGE15_SOURCE_NATIVE_RESULT_PREPARATION_DIR", "STAGE15_SOURCE_NATIVE_RESULT_OPERATOR", "STAGE15_SOURCE_NATIVE_RESULT_ASSESSOR_A", "STAGE15_SOURCE_NATIVE_RESULT_ASSESSOR_B", "STAGE15_SOURCE_NATIVE_RESULT_OUTPUT_ROOT", "STAGE15_SOURCE_NATIVE_RESULT_TIMESTAMP", "STAGE15_SOURCE_NATIVE_RESULT_SCREENING_INDEPENDENT", "STAGE15_SOURCE_NATIVE_RESULT_ASSESSORS_INDEPENDENT"] as const;
const saved = new Map(keys.map((key) => [key, process.env[key]]));
afterEach(() => { for (const key of keys) { const value = saved.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const run = process.env.RUN_STAGE15_SOURCE_NATIVE_RESULT === "1" ? it : it.skip;

describe("source-native result runtime gate", () => {
  run("accepts only explicit absolute preparation, three result files, output root, and timestamp", () => {
    const preparationDirectory = process.env.STAGE15_SOURCE_NATIVE_RESULT_PREPARATION_DIR; const operatorResultPath = process.env.STAGE15_SOURCE_NATIVE_RESULT_OPERATOR; const outcomeAssessorAResultPath = process.env.STAGE15_SOURCE_NATIVE_RESULT_ASSESSOR_A; const outcomeAssessorBResultPath = process.env.STAGE15_SOURCE_NATIVE_RESULT_ASSESSOR_B; const outputRoot = process.env.STAGE15_SOURCE_NATIVE_RESULT_OUTPUT_ROOT; const timestamp = process.env.STAGE15_SOURCE_NATIVE_RESULT_TIMESTAMP;
    if (!preparationDirectory || !operatorResultPath || !outcomeAssessorAResultPath || !outcomeAssessorBResultPath || !outputRoot || !timestamp
      || !isAbsolute(preparationDirectory) || !isAbsolute(operatorResultPath) || !isAbsolute(outcomeAssessorAResultPath) || !isAbsolute(outcomeAssessorBResultPath) || !isAbsolute(outputRoot) || Number.isNaN(Date.parse(timestamp))) throw new Error("SOURCE_NATIVE_RESULT_RUNTIME_INPUT_MISSING");
    if (resolve(preparationDirectory, "..") !== resolve(outputRoot)) throw new Error("SOURCE_NATIVE_RESULT_RUNTIME_OUTPUT_INVALID");
    const screeningIndependent = process.env.STAGE15_SOURCE_NATIVE_RESULT_SCREENING_INDEPENDENT; const assessorsIndependent = process.env.STAGE15_SOURCE_NATIVE_RESULT_ASSESSORS_INDEPENDENT;
    if (!["true", "false"].includes(screeningIndependent ?? "") || !["true", "false"].includes(assessorsIndependent ?? "")) throw new Error("SOURCE_NATIVE_RESULT_RUNTIME_INPUT_MISSING");
    expect(generateStage15SourceNativeResult({ preparationDirectory, outputRoot, createdAt: timestamp, roleAttestations: { screeningOperatorDistinctFromOutcomeAssessors: screeningIndependent === "true", outcomeAssessorsDistinctFromEachOther: assessorsIndependent === "true" }, operatorResultPath, outcomeAssessorAResultPath, outcomeAssessorBResultPath }).directory).toMatch(/^.+execution-[a-f0-9]{12}$/u);
  });
});
