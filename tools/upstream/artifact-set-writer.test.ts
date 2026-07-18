import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeArtifactSetAtomically } from "./artifact-set-writer";

const fsMocks = vi.hoisted(() => ({ renameSync: vi.fn<typeof fs.renameSync>() }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  fsMocks.renameSync.mockImplementation(actual.renameSync);
  return { ...actual, renameSync: fsMocks.renameSync };
});

const temporaryDirectories: string[] = [];
const content = "{\"a\":1}\n";
const artifacts = [
  { relativePath: "a.json", content },
  {
    relativePath: "a.json.sha256",
    content: `${createHash("sha256").update(content, "utf8").digest("hex")}  a.json\n`,
  },
];

function temporaryDirectory(prefix: string) {
  const directory = fs.mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function existsError() {
  return Object.assign(new Error("destination exists"), { code: "EEXIST" });
}

beforeEach(() => {
  fsMocks.renameSync.mockClear();
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("atomic artifact set writer", () => {
  it("publishes a complete immutable directory and replays idempotently", () => {
    const root = temporaryDirectory("artifact-set-");

    const first = writeArtifactSetAtomically(root, "preparation", artifacts, "ALT_REVIEW_CONFLICT");
    const second = writeArtifactSetAtomically(root, "preparation", artifacts, "ALT_REVIEW_CONFLICT");

    expect(first.written).toEqual(["a.json", "a.json.sha256"]);
    expect(first.unchanged).toEqual([]);
    expect(second.written).toEqual([]);
    expect(second.unchanged).toEqual(["a.json", "a.json.sha256"]);
    expect(fs.readdirSync(join(root, "preparation")).sort()).toEqual(["a.json", "a.json.sha256"]);
    expect(fs.readdirSync(root).some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("does not replace a conflicting final directory", () => {
    const root = temporaryDirectory("artifact-set-conflict-");
    fs.mkdirSync(join(root, "preparation"));
    fs.writeFileSync(join(root, "preparation", "a.json"), "different\n");

    expect(() => writeArtifactSetAtomically(
      root,
      "preparation",
      [{ relativePath: "a.json", content: "expected\n" }],
      "ALT_REVIEW_CONFLICT",
    )).toThrow("ALT_REVIEW_CONFLICT:preparation");
  });

  it("returns unchanged when another writer wins the rename with identical content", () => {
    const root = temporaryDirectory("artifact-set-race-same-");
    fsMocks.renameSync.mockImplementationOnce((_source, destination) => {
      const finalDirectory = destination.toString();
      fs.mkdirSync(finalDirectory, { recursive: true });
      for (const artifact of artifacts) {
        fs.writeFileSync(join(finalDirectory, artifact.relativePath), artifact.content);
      }
      throw existsError();
    });

    const result = writeArtifactSetAtomically(root, "preparation", artifacts, "ALT_REVIEW_CONFLICT");

    expect(result.written).toEqual([]);
    expect(result.unchanged).toEqual(["a.json", "a.json.sha256"]);
    expect(fs.readdirSync(root).some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("fails closed when another writer wins the rename with different content", () => {
    const root = temporaryDirectory("artifact-set-race-conflict-");
    fsMocks.renameSync.mockImplementationOnce((_source, destination) => {
      const finalDirectory = destination.toString();
      fs.mkdirSync(finalDirectory, { recursive: true });
      fs.writeFileSync(join(finalDirectory, "a.json"), "different\n");
      throw existsError();
    });

    expect(() => writeArtifactSetAtomically(root, "preparation", artifacts, "ALT_REVIEW_CONFLICT"))
      .toThrow("ALT_REVIEW_CONFLICT:preparation");
    expect(fs.readdirSync(root).some((name) => name.includes(".tmp-"))).toBe(false);
  });
});
