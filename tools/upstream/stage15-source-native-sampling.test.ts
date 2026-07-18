import { describe, expect, it } from "vitest";

import { stableHash } from "../../lib/upstream/pipeline";
import { assertSourceNativeSampleIntegrity, type SourceNativeProductRecord, type SourceNativeSourceQualification } from "./stage15-source-native-contract";
import { FIXTURE_SOURCE_NATIVE_QUALIFICATION, SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS } from "./stage15-source-native-test-fixtures";
import { buildSourceNativeSamplingFrame, lockSourceNativeSample } from "./stage15-source-native-sampling";

function selfHash<T extends Record<string, unknown>, K extends string>(body: T, field: K): T & Record<K, string> {
  return { ...body, [field]: stableHash(body) } as T & Record<K, string>;
}

function rehashRecord(record: SourceNativeProductRecord): SourceNativeProductRecord {
  const { recordHash: _recordHash, ...body } = record;
  return selfHash(body, "recordHash");
}

function rehashQualification(
  qualification: SourceNativeSourceQualification,
): SourceNativeSourceQualification {
  const { qualificationHash: _qualificationHash, ...body } = qualification;
  return selfHash(body, "qualificationHash");
}

function rehashFrame(frame: ReturnType<typeof buildSourceNativeSamplingFrame>) {
  const { frameHash: _frameHash, ...body } = frame;
  return selfHash(body, "frameHash");
}

describe("stage15 source-native sampling", () => {
  it("locks the same twenty source-native samples from an unordered eligible input without mutating it", () => {
    const unordered = [...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS].reverse();
    const originalOrder = unordered.map((record) => record.sourceProductId);

    const orderedFrame = buildSourceNativeSamplingFrame({
      qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION,
      eligibleRecords: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS,
    });
    const unorderedFrame = buildSourceNativeSamplingFrame({
      qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION,
      eligibleRecords: unordered,
    });
    const orderedLock = lockSourceNativeSample({ seed: "source-native-seed-v1", frame: orderedFrame });
    const unorderedLock = lockSourceNativeSample({ seed: "source-native-seed-v1", frame: unorderedFrame });

    expect(unordered.map((record) => record.sourceProductId)).toEqual(originalOrder);
    expect(unorderedFrame.frameHash).toBe(orderedFrame.frameHash);
    expect(unorderedLock.lockHash).toBe(orderedLock.lockHash);
    expect(unorderedLock.samples).toHaveLength(20);
    expect(unorderedLock).toMatchObject({
      schemaVersion: "stage15-source-native-sample-lock.v1",
      seed: "source-native-seed-v1",
      qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash,
      sourceId: "synthetic-catalogue",
    });
    unorderedLock.samples.forEach((sample) => {
      assertSourceNativeSampleIntegrity(sample);
      expect(sample.productKey).toBe(`source:${sample.sourceId}:${sample.sourceProductId}:${stableHash(sample.variantSignature).slice(0, 16)}`);
      expect(sample.productKey).not.toContain("amazon:US:");
      expect(sample.productKey).not.toMatch(/:[A-Z0-9]{10}$/u);
    });
    const { lockHash, ...lockBody } = unorderedLock;
    expect(lockHash).toBe(stableHash(lockBody));
  });

  it("selects a deterministic subset of exactly twenty from more than twenty eligible records", () => {
    const extra = rehashRecord({
      ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0],
      sourceProductId: "SN-021",
      variantSignature: "finish=aurora-21;size=standard",
    });
    const records = [...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS, extra];

    const first = lockSourceNativeSample({
      seed: "source-native-seed-v1",
      frame: buildSourceNativeSamplingFrame({ qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, eligibleRecords: records }),
    });
    const second = lockSourceNativeSample({
      seed: "source-native-seed-v1",
      frame: buildSourceNativeSamplingFrame({ qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, eligibleRecords: [...records].reverse() }),
    });

    expect(first.samples).toHaveLength(20);
    expect(second.samples.map((sample) => sample.sampleHash)).toEqual(first.samples.map((sample) => sample.sampleHash));
    expect(second.lockHash).toBe(first.lockHash);
  });

  it("canonicalizes a valid externally reordered frame before locking it", () => {
    const frame = buildSourceNativeSamplingFrame({
      qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION,
      eligibleRecords: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS,
    });
    const externallyReorderedFrame = rehashFrame({ ...frame, records: [...frame.records].reverse() });

    expect(lockSourceNativeSample({ seed: "source-native-seed-v1", frame: externallyReorderedFrame }).lockHash)
      .toBe(lockSourceNativeSample({ seed: "source-native-seed-v1", frame }).lockHash);
  });

  it("binds the lock to the complete sampling frame, including an unselected record", () => {
    const extra = rehashRecord({
      ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0],
      sourceProductId: "SN-021",
      variantSignature: "finish=aurora-21;size=standard",
    });
    const records = [...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS, extra];
    const first = lockSourceNativeSample({
      seed: "source-native-seed-v1",
      frame: buildSourceNativeSamplingFrame({ qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, eligibleRecords: records }),
    });
    const unselected = records.find((record) => !first.samples.some((sample) => sample.recordHash === record.recordHash));
    expect(unselected).toBeDefined();
    const changedUnselected = rehashRecord({ ...unselected!, title: "Changed unselected synthetic utility item" });
    const changedRecords = records.map((record) => record.recordHash === unselected!.recordHash ? changedUnselected : record);
    const second = lockSourceNativeSample({
      seed: "source-native-seed-v1",
      frame: buildSourceNativeSamplingFrame({ qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, eligibleRecords: changedRecords }),
    });

    expect(second.frame.frameHash).not.toBe(first.frame.frameHash);
    expect(second.lockHash).not.toBe(first.lockHash);
  });

  it("changes the lock hash when its seed, qualification hash, or a selected record hash changes", () => {
    const baseline = lockSourceNativeSample({
      seed: "source-native-seed-v1",
      frame: buildSourceNativeSamplingFrame({
        qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION,
        eligibleRecords: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS,
      }),
    });
    const changedQualification = rehashQualification({
      ...FIXTURE_SOURCE_NATIVE_QUALIFICATION,
      sourceOrigin: "https://catalogue-2.synthetic.invalid",
    });
    const changedRecord = rehashRecord({
      ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0],
      title: "Changed synthetic utility item",
    });

    expect(lockSourceNativeSample({ seed: "source-native-seed-v2", frame: baseline.frame }).lockHash)
      .not.toBe(baseline.lockHash);
    expect(lockSourceNativeSample({
      seed: "source-native-seed-v1",
      frame: buildSourceNativeSamplingFrame({
        qualification: changedQualification,
        eligibleRecords: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS,
      }),
    }).lockHash).not.toBe(baseline.lockHash);
    expect(lockSourceNativeSample({
      seed: "source-native-seed-v1",
      frame: buildSourceNativeSamplingFrame({
        qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION,
        eligibleRecords: [changedRecord, ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS.slice(1)],
      }),
    }).lockHash).not.toBe(baseline.lockHash);
  });

  it("rejects an eligible set with fewer than twenty records", () => {
    expect(() => buildSourceNativeSamplingFrame({
      qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION,
      eligibleRecords: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS.slice(0, 19),
    })).toThrow("SOURCE_NATIVE_SAMPLE_EXACT_COUNT_REQUIRED:19");
  });

  it("fails closed for a duplicate source product and variant identity", () => {
    const duplicate = rehashRecord({ ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0] });

    expect(() => buildSourceNativeSamplingFrame({
      qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION,
      eligibleRecords: [...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS.slice(0, 19), duplicate, SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[19]],
    })).toThrow("SOURCE_NATIVE_PRODUCT_RECORD_INVALID");
  });

  it("rejects an invalid qualification hash and an invalid seed deterministically", () => {
    expect(() => buildSourceNativeSamplingFrame({
      qualification: { ...FIXTURE_SOURCE_NATIVE_QUALIFICATION, qualificationHash: "0".repeat(64) },
      eligibleRecords: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS,
    })).toThrow("SOURCE_NATIVE_QUALIFICATION_INVALID");

    const frame = buildSourceNativeSamplingFrame({
      qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION,
      eligibleRecords: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS,
    });
    expect(() => lockSourceNativeSample({ seed: "", frame })).toThrow("SOURCE_NATIVE_SAMPLE_SEED_INVALID");
  });

  it("rejects a sampling frame whose records span more than one source", () => {
    const foreignRecord = rehashRecord({
      ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0],
      sourceId: "other-synthetic-catalogue",
    });

    expect(() => buildSourceNativeSamplingFrame({
      qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION,
      eligibleRecords: [foreignRecord, ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS.slice(1)],
    })).toThrow("SOURCE_NATIVE_SAMPLE_SINGLE_SOURCE_REQUIRED");
  });

  it("self-hashes frames and isolates unknown nested extensions from its input and lock output", () => {
    const extendedRecord = rehashRecord({
      ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0],
      extension: { nested: { marker: "input" } },
    } as SourceNativeProductRecord);
    const records = [extendedRecord, ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS.slice(1)];
    const frame = buildSourceNativeSamplingFrame({
      qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION,
      eligibleRecords: records,
    });
    const { frameHash, ...frameBody } = frame;
    expect(frameHash).toBe(stableHash(frameBody));
    const lock = lockSourceNativeSample({ seed: "source-native-seed-v1", frame });

    const outputExtension = (frame.records[0] as unknown as { extension: { nested: { marker: string } } }).extension;
    outputExtension.nested.marker = "frame-output";
    expect((records[0] as unknown as { extension: { nested: { marker: string } } }).extension.nested.marker).toBe("input");

    const lockExtension = (lock.frame.records[0] as unknown as { extension: { nested: { marker: string } } }).extension;
    lockExtension.nested.marker = "lock-output";
    expect(outputExtension.nested.marker).toBe("frame-output");
  });
});
