import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Stage15SourceNativeBatch } from "./stage15-source-native-batch";
import { generateStage15SourceNativePreparation } from "./generate-stage15-source-native-preparation";

const keys = ["RUN_STAGE15_SOURCE_NATIVE_PREPARATION", "STAGE15_SOURCE_NATIVE_PREPARATION_BATCH_INPUT", "STAGE15_SOURCE_NATIVE_PREPARATION_OUTPUT_ROOT", "STAGE15_SOURCE_NATIVE_PREPARATION_TIMESTAMP"] as const;
const saved = new Map(keys.map((key) => [key, process.env[key]]));
afterEach(() => { for (const key of keys) { const value = saved.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const run = process.env.RUN_STAGE15_SOURCE_NATIVE_PREPARATION === "1" ? it : it.skip;

describe("source-native preparation runtime gate", () => {
  run("accepts only explicit absolute batch input, output root, and frozen timestamp", () => {
    const input = process.env.STAGE15_SOURCE_NATIVE_PREPARATION_BATCH_INPUT; const outputRoot = process.env.STAGE15_SOURCE_NATIVE_PREPARATION_OUTPUT_ROOT; const timestamp = process.env.STAGE15_SOURCE_NATIVE_PREPARATION_TIMESTAMP;
    if (!input || !outputRoot || !timestamp || !isAbsolute(input) || !isAbsolute(outputRoot) || Number.isNaN(Date.parse(timestamp))) throw new Error("SOURCE_NATIVE_PREPARATION_RUNTIME_INPUT_MISSING");
    const batch = JSON.parse(readFileSync(resolve(input), "utf8")) as Stage15SourceNativeBatch;
    if (batch.createdAt !== timestamp) throw new Error("SOURCE_NATIVE_PREPARATION_RUNTIME_TIMESTAMP_INVALID");
    expect(generateStage15SourceNativePreparation({ batch, outputRoot: resolve(outputRoot), createdAt: timestamp }).directory).toBe(resolve(outputRoot, "preparation"));
  });
});
