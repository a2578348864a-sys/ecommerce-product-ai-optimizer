import { createHash } from "node:crypto";
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";

import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactSetAtomically } from "./artifact-set-writer";
import { serializeSourceNativeArtifactUtf8, assertStage15SourceNativeBatchIntegrity, type Stage15SourceNativeBatch } from "./stage15-source-native-batch";
import { buildStage15SourceNativeEvaluationMaterials } from "./stage15-source-native-evaluation";
import { generateStage15SourceNativeWorkbenches } from "./generate-stage15-source-native-workbenches";

type Artifact = { relativePath: string; content: string };
type ManifestEntry = { relativePath: string; rawUtf8Sha256: string; canonicalHash: string | null; kind: "json" | "presentation_html" };
export type SourceNativePreparationManifest = {
  schemaVersion: "source-native-batch-manifest.v1"; batchId: string; batchMode: "source_native_blind_validation_batch"; batchRole: "prospective_validation"; sampleSize: 20; primarySourceCount: 1; productionEffect: false;
  status: "ready_for_screening_operator"; pendingArtifacts: Array<{ name: "stage15_run" | "screening_operator_result" | "outcome_assessor_results" | "effectiveness_analysis"; status: "stage_required_pending" }>;
  artifacts: ManifestEntry[]; preparationHash: string;
};
export type SourceNativePreparationResult = { directory: string; manifest: SourceNativePreparationManifest; files: string[]; write: { directory: string; written: string[]; unchanged: string[] } };
export type SourceNativePreparationSnapshot = { directory: string; manifest: SourceNativePreparationManifest; rawByPath: ReadonlyMap<string, Buffer>; parsedByPath: ReadonlyMap<string, unknown> };

export const SOURCE_NATIVE_MANIFEST = "source-native-batch-manifest.v1.json";
export const PREPARATION_ARTIFACT_PATHS = [
  "source-native-selection-brief.v1.json", "source-native-source-qualification.v1.json", "source-native-access-request.v1.json", "source-native-access-authorization.v1.json", "source-native-access-log.v1.json", "source-native-sampling-frame.v1.json", "source-native-sample-lock.v1.json", "collection-run.v1.json", "source-adapter-result.v1.json", "import-package.v1.json", "stage1-run.v1.json", "source-native-review-evidence.v1.json", "source-native-screening-visual-packet.v1.json", "source-native-outcome-visual-packet.v1.json", "source-native-screening-operator-packet.v1.json", "source-native-outcome-assessor-packet.v1.json", "source-native-screening-private-bindings.private.v1.json", "source-native-outcome-private-bindings.private.v1.json", "source-native-screening-operator-result-template.v1.json", "source-native-outcome-assessor-a-result-template.v1.json", "source-native-outcome-assessor-b-result-template.v1.json", "source-native-screening-operator-workbench.html", "source-native-outcome-assessor-a-workbench.html", "source-native-outcome-assessor-b-workbench.html",
] as const;
const HASH = /^[a-f0-9]{64}$/u;
const pending = ["stage15_run", "screening_operator_result", "outcome_assessor_results", "effectiveness_analysis"] as const;
const json = (value: unknown) => serializeSourceNativeArtifactUtf8(value);
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const sidecar = (path: string, content: string) => `${sha256(content)}  ${path}\n`;
const isPath = (path: string) => path && path !== "." && path !== ".." && !/[\\/\0]/u.test(path) && basename(path) === path;
function fail(code: string): never { throw new Error(code); }
export type PathAnchor = Readonly<{ path: string; dev: number; ino: number; realpath: string }>;
export function capturePathAnchor(pathInput: string, code: string): PathAnchor {
  let path = resolve(pathInput);
  while (!existsSync(path)) {
    const parent = dirname(path);
    if (parent === path) fail(code);
    path = parent;
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (stat as unknown as { isReparsePoint?: () => boolean }).isReparsePoint?.()) fail(code);
  return { path, dev: stat.dev, ino: stat.ino, realpath: realpathSync(path) };
}
export function assertPathAnchorUnchanged(anchor: PathAnchor, code: string): void {
  if (!existsSync(anchor.path)) fail(code);
  const stat = lstatSync(anchor.path);
  if (stat.isSymbolicLink() || (stat as unknown as { isReparsePoint?: () => boolean }).isReparsePoint?.() || stat.dev !== anchor.dev || stat.ino !== anchor.ino || realpathSync(anchor.path) !== anchor.realpath) fail(code);
}
function stableRead(path: string, code: string): Buffer { const before = lstatSync(path); if (before.isSymbolicLink() || !before.isFile()) fail(code); let fd: number | undefined; try { fd = openSync(path, "r"); const stat = fstatSync(fd); if (stat.dev !== before.dev || stat.ino !== before.ino) fail(code); const out = Buffer.alloc(stat.size); readSync(fd, out, 0, out.length, 0); const after = lstatSync(path); if (after.isSymbolicLink() || after.dev !== stat.dev || after.ino !== stat.ino) fail(code); return out; } finally { if (fd !== undefined) closeSync(fd); } }
export function assertNoLinkedAncestors(path: string, explicitRoot: string, code: string): void {
  const full = resolve(path); const root = resolve(explicitRoot);
  if (full !== root && !full.startsWith(`${root}${sep}`)) fail(code);
  const drive = parse(full).root; const parts = relative(drive, full).split(sep).filter(Boolean); let current = drive;
  for (const part of parts) { current = join(current, part); if (!existsSync(current)) break; const stat = lstatSync(current); if (stat.isSymbolicLink()) fail(code); const real = realpathSync(current); if (real !== resolve(current)) fail(code); }
}
function expectedFiles(manifest: SourceNativePreparationManifest): string[] {
  return [...manifest.artifacts.flatMap((entry) => entry.kind === "json" ? [entry.relativePath, entry.relativePath.replace(/\.json$/u, ".sha256")] : [entry.relativePath]), SOURCE_NATIVE_MANIFEST, SOURCE_NATIVE_MANIFEST.replace(/\.json$/u, ".sha256")].sort();
}
function listExact(directory: string, expected: string[], code: string): void {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) fail(code);
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || (entry as unknown as { isReparsePoint?: () => boolean }).isReparsePoint?.())) fail(code);
  const actual = entries.map((entry) => entry.name).sort();
  if (stableHash(actual) !== stableHash(expected)) fail(code);
}
function readManifest(directory: string): SourceNativePreparationManifest {
  const raw = readFileSync(join(directory, SOURCE_NATIVE_MANIFEST));
  const side = readFileSync(join(directory, SOURCE_NATIVE_MANIFEST.replace(/\.json$/u, ".sha256")), "utf8");
  if (side !== sidecar(SOURCE_NATIVE_MANIFEST, raw.toString("utf8"))) fail("SOURCE_NATIVE_PREPARATION_MANIFEST_SIDECAR_DRIFT");
  let manifest: SourceNativePreparationManifest; try { manifest = JSON.parse(raw.toString("utf8")) as SourceNativePreparationManifest; } catch { fail("SOURCE_NATIVE_PREPARATION_MANIFEST_INVALID"); }
  const { preparationHash, ...body } = manifest;
  if (!HASH.test(preparationHash) || stableHash(body) !== preparationHash || manifest.schemaVersion !== "source-native-batch-manifest.v1" || manifest.batchMode !== "source_native_blind_validation_batch" || manifest.batchRole !== "prospective_validation" || manifest.sampleSize !== 20 || manifest.primarySourceCount !== 1 || manifest.productionEffect !== false || manifest.status !== "ready_for_screening_operator" || !Array.isArray(manifest.artifacts) || !Array.isArray(manifest.pendingArtifacts)) fail("SOURCE_NATIVE_PREPARATION_MANIFEST_INVALID");
  if (stableHash(manifest.pendingArtifacts) !== stableHash(pending.map((name) => ({ name, status: "stage_required_pending" })))) fail("SOURCE_NATIVE_PREPARATION_MANIFEST_INVALID");
  return manifest;
}
export function assertStage15SourceNativePreparation(directoryInput: string, allowedRoot = directoryInput): SourceNativePreparationManifest {
  return loadAndAssertStage15SourceNativePreparation(directoryInput, allowedRoot).manifest;
}
export function loadAndAssertStage15SourceNativePreparation(directoryInput: string, allowedRoot = directoryInput): SourceNativePreparationSnapshot {
  const directory = resolve(directoryInput); assertNoLinkedAncestors(directory, allowedRoot, "SOURCE_NATIVE_PREPARATION_PATH_ESCAPE");
  const manifestRaw = stableRead(join(directory, SOURCE_NATIVE_MANIFEST), "SOURCE_NATIVE_PREPARATION_SET_DRIFT"); const sideRaw = stableRead(join(directory, SOURCE_NATIVE_MANIFEST.replace(/\.json$/u, ".sha256")), "SOURCE_NATIVE_PREPARATION_SET_DRIFT");
  if (sideRaw.toString("utf8") !== sidecar(SOURCE_NATIVE_MANIFEST, manifestRaw.toString("utf8"))) fail("SOURCE_NATIVE_PREPARATION_MANIFEST_SIDECAR_DRIFT"); let manifest: SourceNativePreparationManifest; try { manifest = JSON.parse(manifestRaw.toString("utf8")) as SourceNativePreparationManifest; } catch { fail("SOURCE_NATIVE_PREPARATION_MANIFEST_INVALID"); }
  const { preparationHash, ...body } = manifest; if (!HASH.test(preparationHash) || stableHash(body) !== preparationHash || manifest.schemaVersion !== "source-native-batch-manifest.v1" || manifest.batchMode !== "source_native_blind_validation_batch" || manifest.batchRole !== "prospective_validation" || manifest.sampleSize !== 20 || manifest.primarySourceCount !== 1 || manifest.productionEffect !== false || manifest.status !== "ready_for_screening_operator" || !Array.isArray(manifest.artifacts) || !Array.isArray(manifest.pendingArtifacts)) fail("SOURCE_NATIVE_PREPARATION_MANIFEST_INVALID"); if (stableHash(manifest.pendingArtifacts) !== stableHash(pending.map((name) => ({ name, status: "stage_required_pending" })))) fail("SOURCE_NATIVE_PREPARATION_MANIFEST_INVALID");
  const paths = new Set<string>();
  if (manifest.artifacts.length !== PREPARATION_ARTIFACT_PATHS.length || manifest.artifacts.some((entry) => !entry || !isPath(entry.relativePath) || paths.has(entry.relativePath) || !HASH.test(entry.rawUtf8Sha256) || (entry.canonicalHash !== null && !HASH.test(entry.canonicalHash)) || !["json", "presentation_html"].includes(entry.kind) || (PREPARATION_ARTIFACT_PATHS.includes(entry.relativePath as never) === false) || (entry.kind !== (entry.relativePath.endsWith(".json") ? "json" : "presentation_html")) || (paths.add(entry.relativePath), false)) || stableHash([...paths].sort()) !== stableHash([...PREPARATION_ARTIFACT_PATHS].sort())) fail("SOURCE_NATIVE_PREPARATION_MANIFEST_INVALID");
  listExact(directory, expectedFiles(manifest), "SOURCE_NATIVE_PREPARATION_SET_DRIFT");
  for (const entry of manifest.artifacts) {
    const path = join(directory, entry.relativePath); assertNoLinkedAncestors(path, directory, "SOURCE_NATIVE_PREPARATION_PATH_ESCAPE");
    const raw = stableRead(path, "SOURCE_NATIVE_PREPARATION_SET_DRIFT"); if (sha256(raw) !== entry.rawUtf8Sha256) fail(`SOURCE_NATIVE_PREPARATION_RAW_DRIFT:${entry.relativePath}`);
    if (entry.kind === "json") {
      const text = raw.toString("utf8"); if (text.startsWith("\uFEFF") || text.endsWith("\n") || stableRead(join(directory, entry.relativePath.replace(/\.json$/u, ".sha256")), "SOURCE_NATIVE_PREPARATION_SET_DRIFT").toString("utf8") !== sidecar(entry.relativePath, text)) fail(`SOURCE_NATIVE_PREPARATION_SIDECAR_DRIFT:${entry.relativePath}`);
      let parsed: unknown; try { parsed = JSON.parse(text); } catch { fail(`SOURCE_NATIVE_PREPARATION_JSON_INVALID:${entry.relativePath}`); }
      if (entry.canonicalHash !== stableHash(parsed)) fail(`SOURCE_NATIVE_PREPARATION_CANONICAL_DRIFT:${entry.relativePath}`);
    } else if (entry.canonicalHash !== stableHash(raw.toString("utf8"))) fail(`SOURCE_NATIVE_PREPARATION_CANONICAL_DRIFT:${entry.relativePath}`);
  }
  const rawByPath = new Map<string, Buffer>(); const parsedByPath = new Map<string, unknown>(); rawByPath.set(SOURCE_NATIVE_MANIFEST, manifestRaw); rawByPath.set(SOURCE_NATIVE_MANIFEST.replace(/\.json$/u, ".sha256"), sideRaw); for (const entry of manifest.artifacts) { const raw = stableRead(join(directory, entry.relativePath), "SOURCE_NATIVE_PREPARATION_SET_DRIFT"); rawByPath.set(entry.relativePath, raw); if (entry.kind === "json") { rawByPath.set(entry.relativePath.replace(/\.json$/u, ".sha256"), stableRead(join(directory, entry.relativePath.replace(/\.json$/u, ".sha256")), "SOURCE_NATIVE_PREPARATION_SET_DRIFT")); parsedByPath.set(entry.relativePath, JSON.parse(raw.toString("utf8"))); } }
  return { directory, manifest, rawByPath, parsedByPath };
}
function artifact(path: string, value: unknown, kind: "json" | "presentation_html" = "json"): Artifact { return { relativePath: path, content: kind === "json" ? json(value) : String(value) }; }
function initialArtifacts(batch: Stage15SourceNativeBatch, materials: ReturnType<typeof buildStage15SourceNativeEvaluationMaterials>) {
  const workbenches = generateStage15SourceNativeWorkbenches(materials);
  return [
    artifact("source-native-selection-brief.v1.json", batch.controlArtifacts.selectionBrief), artifact("source-native-source-qualification.v1.json", batch.controlArtifacts.qualification), artifact("source-native-access-request.v1.json", batch.controlArtifacts.accessRequest), artifact("source-native-access-authorization.v1.json", batch.controlArtifacts.authorization), artifact("source-native-access-log.v1.json", batch.controlArtifacts.accessLog), artifact("source-native-sampling-frame.v1.json", batch.controlArtifacts.samplingFrame), artifact("source-native-sample-lock.v1.json", batch.controlArtifacts.sampleLock), artifact("collection-run.v1.json", batch.collectionRun), artifact("source-adapter-result.v1.json", batch.sourceAdapterResult), artifact("import-package.v1.json", batch.importProjection), artifact("stage1-run.v1.json", batch.stage1), artifact("source-native-review-evidence.v1.json", batch.reviewEvidence), artifact("source-native-screening-visual-packet.v1.json", batch.screeningVisualPacket), artifact("source-native-outcome-visual-packet.v1.json", batch.outcomeVisualPacket), artifact("source-native-screening-operator-packet.v1.json", materials.operator.packet), artifact("source-native-outcome-assessor-packet.v1.json", materials.outcome.packet), artifact("source-native-screening-private-bindings.private.v1.json", materials.operator.bindings), artifact("source-native-outcome-private-bindings.private.v1.json", materials.outcome.bindings), artifact("source-native-screening-operator-result-template.v1.json", materials.operator.template), artifact("source-native-outcome-assessor-a-result-template.v1.json", materials.outcome.assessorA.template), artifact("source-native-outcome-assessor-b-result-template.v1.json", materials.outcome.assessorB.template), artifact("source-native-screening-operator-workbench.html", workbenches.operator.html, "presentation_html"), artifact("source-native-outcome-assessor-a-workbench.html", workbenches.assessorA.html, "presentation_html"), artifact("source-native-outcome-assessor-b-workbench.html", workbenches.assessorB.html, "presentation_html"),
  ];
}
export function generateStage15SourceNativePreparation(input: { batch: Stage15SourceNativeBatch; outputRoot: string; createdAt: string }): SourceNativePreparationResult {
  if (input.createdAt !== input.batch.createdAt || Number.isNaN(Date.parse(input.createdAt))) fail("SOURCE_NATIVE_PREPARATION_TIMESTAMP_INVALID"); assertStage15SourceNativeBatchIntegrity(input.batch); const root = resolve(input.outputRoot); assertNoLinkedAncestors(root, root, "SOURCE_NATIVE_PREPARATION_PATH_ESCAPE");
  const materials = buildStage15SourceNativeEvaluationMaterials(input.batch, input.batch.createdAt); const values = initialArtifacts(input.batch, materials);
  if (stableHash(values.map((value) => value.relativePath).sort()) !== stableHash([...PREPARATION_ARTIFACT_PATHS].sort())) fail("SOURCE_NATIVE_PREPARATION_ARTIFACT_SET_INVALID");
  const entries: ManifestEntry[] = values.map(({ relativePath, content }) => ({ relativePath, rawUtf8Sha256: sha256(content), canonicalHash: relativePath.endsWith(".json") ? stableHash(JSON.parse(content)) : stableHash(content), kind: relativePath.endsWith(".json") ? "json" : "presentation_html" }));
  const body = { schemaVersion: "source-native-batch-manifest.v1" as const, batchId: input.batch.batchId, batchMode: "source_native_blind_validation_batch" as const, batchRole: "prospective_validation" as const, sampleSize: 20 as const, primarySourceCount: 1 as const, productionEffect: false as const, status: "ready_for_screening_operator" as const, pendingArtifacts: pending.map((name) => ({ name, status: "stage_required_pending" as const })), artifacts: entries };
  const manifest = { ...body, preparationHash: stableHash(body) } as SourceNativePreparationManifest;
  const output = [...values.flatMap(({ relativePath, content }) => relativePath.endsWith(".json") ? [{ relativePath, content }, { relativePath: relativePath.replace(/\.json$/u, ".sha256"), content: sidecar(relativePath, content) }] : [{ relativePath, content }]), { relativePath: SOURCE_NATIVE_MANIFEST, content: json(manifest) }, { relativePath: SOURCE_NATIVE_MANIFEST.replace(/\.json$/u, ".sha256"), content: sidecar(SOURCE_NATIVE_MANIFEST, json(manifest)) }];
  assertNoLinkedAncestors(root, root, "SOURCE_NATIVE_PREPARATION_PATH_ESCAPE"); const rootAnchor = capturePathAnchor(root, "SOURCE_NATIVE_PREPARATION_PATH_ESCAPE"); const write = writeArtifactSetAtomically(root, "preparation", output, "SOURCE_NATIVE_PREPARATION_CONFLICT"); assertPathAnchorUnchanged(rootAnchor, "SOURCE_NATIVE_PREPARATION_PATH_ESCAPE"); assertNoLinkedAncestors(write.directory, root, "SOURCE_NATIVE_PREPARATION_PATH_ESCAPE"); loadAndAssertStage15SourceNativePreparation(write.directory, root);
  return { directory: write.directory, manifest, files: output.map((item) => item.relativePath), write };
}
