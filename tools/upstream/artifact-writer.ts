import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type VersionedArtifact = {
  relativePath: string;
  content: string;
};

function targetFor(root: string, relativePath: string) {
  if (!relativePath || isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("ARTIFACT_PATH_INVALID");
  }
  const target = resolve(root, relativePath);
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("ARTIFACT_PATH_INVALID");
  }
  return target;
}

function assertParentDirectories(root: string, target: string) {
  let parent = dirname(target);
  while (parent !== root) {
    if (existsSync(parent) && !lstatSync(parent).isDirectory()) throw new Error("ARTIFACT_PARENT_CONFLICT");
    const next = dirname(parent);
    if (next === parent) throw new Error("ARTIFACT_PATH_INVALID");
    parent = next;
  }
}

export function writeArtifactsIdempotently(
  outputDirectory: string,
  artifacts: readonly VersionedArtifact[],
  conflictCode: string,
) {
  const root = resolve(outputDirectory);
  mkdirSync(root, { recursive: true });
  const seen = new Set<string>();
  const planned = artifacts.map((artifact) => {
    const target = targetFor(root, artifact.relativePath);
    const key = process.platform === "win32" ? target.toLowerCase() : target;
    if (seen.has(key)) throw new Error("ARTIFACT_PATH_DUPLICATE");
    seen.add(key);
    assertParentDirectories(root, target);
    return { ...artifact, target };
  });

  const conflicts = planned.filter(({ target, content }) => {
    if (!existsSync(target)) return false;
    return !lstatSync(target).isFile() || readFileSync(target, "utf8") !== content;
  });
  if (conflicts.length > 0) {
    throw new Error(`${conflictCode}:${conflicts.map((item) => item.relativePath).join(",")}`);
  }

  const written: string[] = [];
  const unchanged: string[] = [];
  for (const artifact of planned) {
    if (existsSync(artifact.target)) {
      unchanged.push(artifact.relativePath);
      continue;
    }
    mkdirSync(dirname(artifact.target), { recursive: true });
    try {
      writeFileSync(artifact.target, artifact.content, { encoding: "utf8", flag: "wx" });
      written.push(artifact.relativePath);
    } catch (error) {
      if (existsSync(artifact.target) && lstatSync(artifact.target).isFile()
        && readFileSync(artifact.target, "utf8") === artifact.content) {
        unchanged.push(artifact.relativePath);
        continue;
      }
      throw error;
    }
  }
  return { written, unchanged };
}
