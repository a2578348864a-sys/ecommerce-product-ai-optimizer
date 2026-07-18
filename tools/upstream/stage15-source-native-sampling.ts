import { stableHash } from "../../lib/upstream/pipeline";
import {
  assertSourceNativeProductRecordSetIntegrity,
  assertSourceNativeQualificationIntegrity,
  assertSourceNativeSampleIntegrity,
  type SourceNativeProductRecord,
  type SourceNativeSample,
  type SourceNativeSourceQualification,
} from "./stage15-source-native-contract";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SAMPLE_SIZE = 20;

export type SourceNativeSamplingFrame = {
  schemaVersion: "stage15-source-native-sampling-frame.v1";
  qualificationHash: string;
  sourceId: string;
  records: SourceNativeProductRecord[];
  frameHash: string;
};

export type SourceNativeSamplingFrameInput = {
  qualification: SourceNativeSourceQualification;
  eligibleRecords: ReadonlyArray<SourceNativeProductRecord>;
};

export type SourceNativeSampleLock = {
  schemaVersion: "stage15-source-native-sample-lock.v1";
  seed: string;
  qualificationHash: string;
  sourceId: string;
  frame: SourceNativeSamplingFrame;
  samples: SourceNativeSample[];
  lockHash: string;
};

export type SourceNativeSampleLockInput = {
  seed: string;
  frame: SourceNativeSamplingFrame;
};

function fail(code: string): never {
  throw new Error(code);
}

function selfHash<T extends Record<string, unknown>, K extends string>(body: T, field: K): T & Record<K, string> {
  return { ...body, [field]: stableHash(body) } as T & Record<K, string>;
}

function isSelfHashed(value: unknown, field: string): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!HASH_PATTERN.test(String(record[field]))) return false;
  const { [field]: _hash, ...body } = record;
  return stableHash(body) === record[field];
}

function copyRecord(record: SourceNativeProductRecord): SourceNativeProductRecord {
  return structuredClone(record);
}

function copyFrame(frame: SourceNativeSamplingFrame): SourceNativeSamplingFrame {
  return {
    ...frame,
    records: frame.records.map(copyRecord),
  };
}

function canonicalFrame(frame: Omit<SourceNativeSamplingFrame, "frameHash">): SourceNativeSamplingFrame {
  return selfHash({
    ...frame,
    records: frame.records
      .map(copyRecord)
      .sort((left, right) => left.sourceProductId.localeCompare(right.sourceProductId)
        || left.variantSignature.localeCompare(right.variantSignature)),
  }, "frameHash");
}

function assertFrameIntegrity(frame: unknown): asserts frame is SourceNativeSamplingFrame {
  if (!isSelfHashed(frame, "frameHash")
    || frame.schemaVersion !== "stage15-source-native-sampling-frame.v1"
    || !HASH_PATTERN.test(String(frame.qualificationHash))
    || typeof frame.sourceId !== "string" || frame.sourceId.length === 0
    || !Array.isArray(frame.records)) {
    fail("SOURCE_NATIVE_SAMPLING_FRAME_INVALID");
  }
  if (frame.records.length < SAMPLE_SIZE) {
    fail(`SOURCE_NATIVE_SAMPLE_EXACT_COUNT_REQUIRED:${frame.records.length}`);
  }
  try {
    assertSourceNativeProductRecordSetIntegrity(frame.records);
  } catch {
    fail("SOURCE_NATIVE_PRODUCT_RECORD_INVALID");
  }
  if (frame.records.some((record) => record.sourceId !== frame.sourceId)) {
    fail("SOURCE_NATIVE_SAMPLE_SINGLE_SOURCE_REQUIRED");
  }
}

function sampleFromRecord(record: SourceNativeProductRecord): SourceNativeSample {
  const sample = selfHash({
    productKey: `source:${record.sourceId}:${record.sourceProductId}:${stableHash(record.variantSignature).slice(0, 16)}`,
    sourceId: record.sourceId,
    sourceProductId: record.sourceProductId,
    variantSignature: record.variantSignature,
    recordHash: record.recordHash,
  }, "sampleHash");
  assertSourceNativeSampleIntegrity(sample);
  return sample;
}

export function buildSourceNativeSamplingFrame(
  input: SourceNativeSamplingFrameInput,
): SourceNativeSamplingFrame {
  try {
    assertSourceNativeQualificationIntegrity(input?.qualification);
  } catch {
    fail("SOURCE_NATIVE_QUALIFICATION_INVALID");
  }
  if (!Array.isArray(input?.eligibleRecords)) fail("SOURCE_NATIVE_PRODUCT_RECORD_INVALID");
  if (input.eligibleRecords.length < SAMPLE_SIZE) {
    fail(`SOURCE_NATIVE_SAMPLE_EXACT_COUNT_REQUIRED:${input.eligibleRecords.length}`);
  }
  try {
    assertSourceNativeProductRecordSetIntegrity(input.eligibleRecords);
  } catch {
    fail("SOURCE_NATIVE_PRODUCT_RECORD_INVALID");
  }
  if (input.eligibleRecords.some((record) => record.sourceId !== input.qualification.sourceId)) {
    fail("SOURCE_NATIVE_SAMPLE_SINGLE_SOURCE_REQUIRED");
  }

  const frame = canonicalFrame({
    schemaVersion: "stage15-source-native-sampling-frame.v1" as const,
    qualificationHash: input.qualification.qualificationHash,
    sourceId: input.qualification.sourceId,
    records: input.eligibleRecords,
  });
  assertFrameIntegrity(frame);
  return copyFrame(frame);
}

export function lockSourceNativeSample(input: SourceNativeSampleLockInput): SourceNativeSampleLock {
  if (typeof input?.seed !== "string" || input.seed.trim().length === 0) {
    fail("SOURCE_NATIVE_SAMPLE_SEED_INVALID");
  }
  assertFrameIntegrity(input.frame);
  const { frameHash: _frameHash, ...frameBody } = input.frame;
  const frame = canonicalFrame(frameBody);
  const ordered = frame.records
    .slice()
    .sort((left, right) => left.sourceProductId.localeCompare(right.sourceProductId))
    .map((record) => ({
      record,
      orderKey: stableHash(`${input.seed}${record.sourceProductId}${record.variantSignature}`),
    }))
    .sort((left, right) => left.orderKey.localeCompare(right.orderKey)
      || left.record.sourceProductId.localeCompare(right.record.sourceProductId));
  const samples = ordered.slice(0, SAMPLE_SIZE).map(({ record }) => sampleFromRecord(record));
  const lock = selfHash({
    schemaVersion: "stage15-source-native-sample-lock.v1" as const,
    seed: input.seed,
    qualificationHash: frame.qualificationHash,
    sourceId: frame.sourceId,
    frame,
    samples,
  }, "lockHash");
  return {
    ...lock,
    frame: copyFrame(lock.frame),
    samples: lock.samples.map((sample) => ({ ...sample })),
  };
}
