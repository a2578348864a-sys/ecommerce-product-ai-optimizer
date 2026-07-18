import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactSetAtomically } from "./artifact-set-writer";
import { buildStage15SourceNativeBatch, serializeSourceNativeArtifactUtf8, type Stage15SourceNativeBatch } from "./stage15-source-native-batch";
import { analyzeStage15SourceNativeEffectiveness } from "./stage15-source-native-effectiveness";
import { buildStage15SourceNativeEvaluationMaterials, assertSourceNativeOutcomeAssessorResult, assertSourceNativeScreeningOperatorResult, type SourceNativeOutcomeAssessorResult, type SourceNativeScreeningOperatorResult } from "./stage15-source-native-evaluation";
import { finalizeStage15SourceNativeScreening } from "./stage15-source-native-screening";
import { PREPARATION_ARTIFACT_PATHS, SOURCE_NATIVE_MANIFEST, assertNoLinkedAncestors, loadAndAssertStage15SourceNativePreparation, type SourceNativePreparationManifest, type SourceNativePreparationSnapshot } from "./generate-stage15-source-native-preparation";

type Entry = { relativePath: string; rawUtf8Sha256: string; canonicalHash: string | null; kind: "json" | "presentation_html"; inherited?: boolean };
type FinalManifest = { schemaVersion: "source-native-batch-terminal-manifest.v1"; preparationHash: string; batchId: string; status: "ready"; createdAt: string; pendingArtifacts: []; artifacts: Entry[]; manifestHash: string };
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
export const RESULT_ARTIFACT_PATHS = ["source-native-screening-operator-result.v1.json", "source-native-outcome-assessor-a-result.v1.json", "source-native-outcome-assessor-b-result.v1.json", "stage15-run.v1.json", "source-native-effectiveness-analysis.v1.json"] as const;
const sidecar = (path: string, content: string) => `${sha256(content)}  ${path}\n`;
const json = (value: unknown) => serializeSourceNativeArtifactUtf8(value);
function fail(code: string): never { throw new Error(code); }
function anchor(path: string, code: string) { if (!existsSync(path)) fail(code); const stat = lstatSync(path); if (stat.isSymbolicLink()) fail(code); return { dev: stat.dev, ino: stat.ino, real: realpathSync(path) }; }
function safeFile(path: string, code: string): string {
  if (!isAbsolute(path)) fail("SOURCE_NATIVE_RESULT_PATH_INVALID"); const full = resolve(path);
  if (!existsSync(full)) fail(code); const stat = lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat as unknown as { isReparsePoint?: () => boolean }).isReparsePoint?.()) fail(code); return full;
}
function readJson(path: string, code: string): unknown {
  const raw = readFileSync(safeFile(path, code)); const text = raw.toString("utf8");
  if (text.startsWith("\uFEFF") || text.endsWith("\n")) fail(code); try { return JSON.parse(text); } catch { fail(code); }
}
function readRawJson(path: string, code: string): { value: unknown; raw: string } {
  const safe = safeFile(path, code); const before = lstatSync(safe); let fd: number | undefined;
  try { fd = openSync(safe, "r"); const stat = fstatSync(fd); if (stat.dev !== before.dev || stat.ino !== before.ino) fail(code); const raw = Buffer.alloc(stat.size); readSync(fd, raw, 0, raw.length, 0); const after = lstatSync(safe); if (after.isSymbolicLink() || after.dev !== stat.dev || after.ino !== stat.ino) fail(code);
    let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { fail(code); }
    if (!Buffer.from(text, "utf8").equals(raw) || text.startsWith("\uFEFF")) fail(code);
    try { return { value: JSON.parse(text), raw: text }; } catch { fail(code); }
  } finally { if (fd !== undefined) closeSync(fd); }
  fail(code);
}
function preparationBatch(snapshot: SourceNativePreparationSnapshot): { batch: Stage15SourceNativeBatch; materials: ReturnType<typeof buildStage15SourceNativeEvaluationMaterials> } {
  const { manifest } = snapshot; const get = <T>(file: string) => { const value = snapshot.parsedByPath.get(file); if (value === undefined) fail("SOURCE_NATIVE_RESULT_PREPARATION_INVALID"); return value as T; };
  const lock = get<Stage15SourceNativeBatch["controlArtifacts"]["sampleLock"]>("source-native-sample-lock.v1.json");
  const collection = get<Record<string, unknown>>("collection-run.v1.json");
  const batch = buildStage15SourceNativeBatch({ batchId: manifest.batchId, selectionBrief: get("source-native-selection-brief.v1.json"), qualification: get("source-native-source-qualification.v1.json"), accessRequest: get("source-native-access-request.v1.json"), authorization: get("source-native-access-authorization.v1.json"), accessLog: (get<{ entries: unknown[] }>("source-native-access-log.v1.json").entries) as never, sampleLock: lock, records: lock.frame.records, createdAt: String(collection.createdAt) });
  const materials = buildStage15SourceNativeEvaluationMaterials(batch, batch.createdAt);
  const checks: Array<[string, unknown]> = [["collection-run.v1.json", batch.collectionRun], ["source-adapter-result.v1.json", batch.sourceAdapterResult], ["import-package.v1.json", batch.importProjection], ["stage1-run.v1.json", batch.stage1], ["source-native-review-evidence.v1.json", batch.reviewEvidence], ["source-native-screening-visual-packet.v1.json", batch.screeningVisualPacket], ["source-native-outcome-visual-packet.v1.json", batch.outcomeVisualPacket], ["source-native-screening-operator-packet.v1.json", materials.operator.packet], ["source-native-outcome-assessor-packet.v1.json", materials.outcome.packet], ["source-native-screening-private-bindings.private.v1.json", materials.operator.bindings], ["source-native-outcome-private-bindings.private.v1.json", materials.outcome.bindings], ["source-native-screening-operator-result-template.v1.json", materials.operator.template], ["source-native-outcome-assessor-a-result-template.v1.json", materials.outcome.assessorA.template], ["source-native-outcome-assessor-b-result-template.v1.json", materials.outcome.assessorB.template]];
  if (checks.some(([file, expected]) => stableHash(get(file)) !== stableHash(expected))) fail("SOURCE_NATIVE_RESULT_PREPARATION_UNTRUSTED");
  return { batch, materials };
}
function resultEntry(relativePath: string, content: string, inherited = false): Entry { return { relativePath, rawUtf8Sha256: sha256(content), canonicalHash: stableHash(JSON.parse(content)), kind: "json", ...(inherited ? { inherited: true } : {}) }; }

export type SourceNativeResult = { directory: string; manifest: FinalManifest; screening: ReturnType<typeof finalizeStage15SourceNativeScreening>; analysis: ReturnType<typeof analyzeStage15SourceNativeEffectiveness>; write: { directory: string; written: string[]; unchanged: string[] } };
export function generateStage15SourceNativeResult(input: { preparationDirectory: string; outputRoot: string; createdAt: string; roleAttestations: { screeningOperatorDistinctFromOutcomeAssessors: boolean; outcomeAssessorsDistinctFromEachOther: boolean }; operatorResultPath: string; outcomeAssessorAResultPath: string; outcomeAssessorBResultPath: string }): SourceNativeResult {
  if (!isAbsolute(input.preparationDirectory)) fail("SOURCE_NATIVE_RESULT_PATH_INVALID"); const preparationDirectory = resolve(input.preparationDirectory); const parent = dirname(preparationDirectory);
  if (!isAbsolute(input.outputRoot) || resolve(input.outputRoot) !== parent || Number.isNaN(Date.parse(input.createdAt)) || preparationDirectory !== join(parent, "preparation")) fail("SOURCE_NATIVE_RESULT_PATH_INVALID");
  assertNoLinkedAncestors(preparationDirectory, parent, "SOURCE_NATIVE_RESULT_PATH_INVALID"); assertNoLinkedAncestors(parent, parent, "SOURCE_NATIVE_RESULT_PATH_INVALID"); const parentAnchor = anchor(parent, "SOURCE_NATIVE_RESULT_PATH_INVALID");
  const snapshot = loadAndAssertStage15SourceNativePreparation(preparationDirectory, parent); const manifest = snapshot.manifest; const { batch, materials } = preparationBatch(snapshot);
  const operatorPath = safeFile(input.operatorResultPath, "SOURCE_NATIVE_RESULT_INPUT_INVALID"); const aPath = safeFile(input.outcomeAssessorAResultPath, "SOURCE_NATIVE_RESULT_INPUT_INVALID"); const bPath = safeFile(input.outcomeAssessorBResultPath, "SOURCE_NATIVE_RESULT_INPUT_INVALID");
  assertNoLinkedAncestors(operatorPath, dirname(operatorPath), "SOURCE_NATIVE_RESULT_INPUT_INVALID"); assertNoLinkedAncestors(aPath, dirname(aPath), "SOURCE_NATIVE_RESULT_INPUT_INVALID"); assertNoLinkedAncestors(bPath, dirname(bPath), "SOURCE_NATIVE_RESULT_INPUT_INVALID");
  const operatorRaw = readRawJson(operatorPath, "SOURCE_NATIVE_RESULT_INPUT_INVALID"); const aRaw = readRawJson(aPath, "SOURCE_NATIVE_RESULT_INPUT_INVALID"); const bRaw = readRawJson(bPath, "SOURCE_NATIVE_RESULT_INPUT_INVALID");
  const operator = operatorRaw.value as SourceNativeScreeningOperatorResult; const assessorA = aRaw.value as SourceNativeOutcomeAssessorResult; const assessorB = bRaw.value as SourceNativeOutcomeAssessorResult;
  try { assertSourceNativeScreeningOperatorResult(operator, materials.operator.template); assertSourceNativeOutcomeAssessorResult(assessorA, materials.outcome.assessorA.template); assertSourceNativeOutcomeAssessorResult(assessorB, materials.outcome.assessorB.template); } catch { fail("SOURCE_NATIVE_RESULT_ROLE_OR_HASH_INVALID"); }
  if (assessorA.slot !== "outcome_assessor_a" || assessorB.slot !== "outcome_assessor_b" || assessorA.packetHash !== materials.outcome.packet.packetHash || assessorB.packetHash !== materials.outcome.packet.packetHash) fail("SOURCE_NATIVE_RESULT_ROLE_OR_HASH_INVALID");
  const screening = finalizeStage15SourceNativeScreening({ batch, materials, operatorResult: operator });
  if (typeof input.roleAttestations.screeningOperatorDistinctFromOutcomeAssessors !== "boolean" || typeof input.roleAttestations.outcomeAssessorsDistinctFromEachOther !== "boolean" || assessorA.roleIndependenceAttested !== true || assessorB.roleIndependenceAttested !== true) fail("SOURCE_NATIVE_RESULT_ROLE_ATTESTATION_INVALID");
  const attestationBody = { schemaVersion: "stage15-source-native-role-attestations.v1" as const, screeningOperatorDistinctFromOutcomeAssessors: input.roleAttestations.screeningOperatorDistinctFromOutcomeAssessors, outcomeAssessorsDistinct: input.roleAttestations.outcomeAssessorsDistinctFromEachOther, identityHardGateReasons: [] as string[] };
  const roleAttestations = { ...attestationBody, attestationHash: stableHash(attestationBody) };
  const analysis = analyzeStage15SourceNativeEffectiveness({ batch, materials, screening: { kind: "task7_artifact", artifact: screening, trustedInput: { batch, materials, operatorResult: operator } }, outcomeAssessorResults: [assessorA, assessorB], roleAttestations });
  const inherited = manifest.artifacts.map((entry) => ({ ...entry, inherited: true }));
  const generated = [{ relativePath: RESULT_ARTIFACT_PATHS[0], content: operatorRaw.raw }, { relativePath: RESULT_ARTIFACT_PATHS[1], content: aRaw.raw }, { relativePath: RESULT_ARTIFACT_PATHS[2], content: bRaw.raw }, { relativePath: RESULT_ARTIFACT_PATHS[3], content: json(screening) }, { relativePath: RESULT_ARTIFACT_PATHS[4], content: json(analysis) }];
  if (stableHash(inherited.map((entry) => entry.relativePath).sort()) !== stableHash([...PREPARATION_ARTIFACT_PATHS].sort()) || stableHash(generated.map((entry) => entry.relativePath).sort()) !== stableHash([...RESULT_ARTIFACT_PATHS].sort())) fail("SOURCE_NATIVE_RESULT_ARTIFACT_SET_INVALID");
  const body = { schemaVersion: "source-native-batch-terminal-manifest.v1" as const, preparationHash: manifest.preparationHash, batchId: manifest.batchId, status: "ready" as const, createdAt: input.createdAt, pendingArtifacts: [] as [], artifacts: [...inherited, ...generated.map((item) => resultEntry(item.relativePath, item.content))] };
  const finalManifest = { ...body, manifestHash: stableHash(body) } as FinalManifest; const manifestContent = json(finalManifest);
  const artifacts = [...generated.flatMap((item) => [{ ...item }, { relativePath: item.relativePath.replace(/\.json$/u, ".sha256"), content: sidecar(item.relativePath, item.content) }]), { relativePath: SOURCE_NATIVE_MANIFEST, content: manifestContent }, { relativePath: SOURCE_NATIVE_MANIFEST.replace(/\.json$/u, ".sha256"), content: sidecar(SOURCE_NATIVE_MANIFEST, manifestContent) }];
  assertNoLinkedAncestors(parent, parent, "SOURCE_NATIVE_RESULT_PATH_INVALID"); const beforeWrite = anchor(parent, "SOURCE_NATIVE_RESULT_PATH_INVALID"); if (stableHash(beforeWrite) !== stableHash(parentAnchor)) fail("SOURCE_NATIVE_RESULT_PATH_INVALID"); const write = writeArtifactSetAtomically(parent, `execution-${manifest.preparationHash.slice(0, 12)}`, artifacts, "SOURCE_NATIVE_RESULT_CONFLICT"); assertNoLinkedAncestors(write.directory, parent, "SOURCE_NATIVE_RESULT_PATH_INVALID"); if (stableHash(anchor(parent, "SOURCE_NATIVE_RESULT_PATH_INVALID")) !== stableHash(parentAnchor)) fail("SOURCE_NATIVE_RESULT_PATH_INVALID");
  return { directory: write.directory, manifest: finalManifest, screening, analysis, write };
}
