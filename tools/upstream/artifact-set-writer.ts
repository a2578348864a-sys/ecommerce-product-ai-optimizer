import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";

function listFiles(root: string, directory = root): string[] | null {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = listFiles(root, path);
      if (!nested) return null;
      files.push(...nested);
      continue;
    }
    if (!entry.isFile()) return null;
    files.push(relative(root, path).split(sep).join("/"));
  }
  return files;
}

function sameArtifactSet(directory: string, artifacts: readonly VersionedArtifact[]): boolean {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) return false;
  const expected = artifacts.map((item) => item.relativePath.split(sep).join("/")).sort();
  const listed = listFiles(directory);
  if (listed === null) return false;
  const actual = listed.sort();
  return expected.length === actual.length
    && expected.every((entry, index) => entry === actual[index])
    && artifacts.every((item) => readFileSync(join(directory, item.relativePath), "utf8") === item.content);
}

export function writeArtifactSetAtomically(
  parentDirectory: string,
  directoryName: string,
  artifacts: readonly VersionedArtifact[],
  conflictCode: string,
) {
  if (!directoryName || directoryName === "." || directoryName === ".."
    || basename(directoryName) !== directoryName || directoryName.includes("..")) {
    throw new Error("ARTIFACT_SET_DIRECTORY_INVALID");
  }
  const parent = resolve(parentDirectory);
  const finalDirectory = join(parent, directoryName);
  mkdirSync(parent, { recursive: true });
  if (existsSync(finalDirectory)) {
    if (!sameArtifactSet(finalDirectory, artifacts)) throw new Error(`${conflictCode}:${directoryName}`);
    return {
      directory: finalDirectory,
      written: [] as string[],
      unchanged: artifacts.map((item) => item.relativePath),
    };
  }

  const tempDirectory = mkdtempSync(join(parent, `.${directoryName}.tmp-${process.pid}-`));
  try {
    const result = writeArtifactsIdempotently(tempDirectory, artifacts, conflictCode);
    try {
      renameSync(tempDirectory, finalDirectory);
    } catch (renameError) {
      if (existsSync(finalDirectory)) {
        if (sameArtifactSet(finalDirectory, artifacts)) {
          rmSync(tempDirectory, { recursive: true, force: true });
          return {
            directory: finalDirectory,
            written: [] as string[],
            unchanged: artifacts.map((item) => item.relativePath),
          };
        }
        throw new Error(`${conflictCode}:${directoryName}`);
      }
      throw renameError;
    }
    return { directory: finalDirectory, written: result.written, unchanged: result.unchanged };
  } catch (error) {
    if (existsSync(tempDirectory)) rmSync(tempDirectory, { recursive: true, force: true });
    throw error;
  }
}
