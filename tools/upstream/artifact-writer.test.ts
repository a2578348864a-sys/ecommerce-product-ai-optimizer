import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeArtifactsIdempotently } from "./artifact-writer";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function root() {
  const path = mkdtempSync(join(tmpdir(), "artifact-writer-"));
  roots.push(path);
  return path;
}

describe("versioned artifact writer", () => {
  it("首次写入全部文件，相同内容重放不改字节和时间", () => {
    const output = root();
    const artifacts = [
      { relativePath: "a.json", content: "{\"a\":1}\n" },
      { relativePath: "nested/guide.md", content: "guide\n" },
    ];
    const first = writeArtifactsIdempotently(output, artifacts, "OUTPUT_CONFLICT");
    const before = statSync(join(output, "a.json")).mtimeMs;
    const second = writeArtifactsIdempotently(output, artifacts, "OUTPUT_CONFLICT");

    expect(first).toEqual({ written: ["a.json", "nested/guide.md"], unchanged: [] });
    expect(second).toEqual({ written: [], unchanged: ["a.json", "nested/guide.md"] });
    expect(statSync(join(output, "a.json")).mtimeMs).toBe(before);
  });

  it("发现任一冲突时先整体拒绝，不补写其他缺失文件", () => {
    const output = root();
    writeFileSync(join(output, "a.json"), "user-edited\n", "utf8");
    const artifacts = [
      { relativePath: "a.json", content: "generated\n" },
      { relativePath: "missing.json", content: "must-not-be-written\n" },
    ];

    expect(() => writeArtifactsIdempotently(output, artifacts, "OUTPUT_CONFLICT")).toThrow("OUTPUT_CONFLICT:a.json");
    expect(readFileSync(join(output, "a.json"), "utf8")).toBe("user-edited\n");
    expect(existsSync(join(output, "missing.json"))).toBe(false);
  });

  it("拒绝绝对路径、目录穿越和重复路径", () => {
    const output = root();
    expect(() => writeArtifactsIdempotently(output, [{ relativePath: "../escape", content: "x" }], "OUTPUT_CONFLICT"))
      .toThrow("ARTIFACT_PATH_INVALID");
    expect(() => writeArtifactsIdempotently(output, [
      { relativePath: "same", content: "a" },
      { relativePath: "same", content: "b" },
    ], "OUTPUT_CONFLICT")).toThrow("ARTIFACT_PATH_DUPLICATE");
  });
});
