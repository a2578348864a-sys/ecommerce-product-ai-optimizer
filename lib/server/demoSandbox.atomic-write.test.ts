import { beforeEach, describe, expect, it, vi } from "vitest";

const fileSystem = vi.hoisted(() => {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  return {
    files,
    directories,
    writeFileSync: vi.fn((path: string, value: string) => {
      files.set(String(path), String(value));
    }),
    readFileSync: vi.fn((path: string) => {
      const value = files.get(String(path));
      if (value === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return value;
    }),
    existsSync: vi.fn((path: string) => files.has(String(path)) || directories.has(String(path))),
    mkdirSync: vi.fn((path: string) => {
      directories.add(String(path));
    }),
    renameSync: vi.fn((from: string, to: string) => {
      const source = String(from);
      const target = String(to);
      const value = files.get(source);
      if (value === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      files.delete(source);
      files.set(target, value);
    }),
    unlinkSync: vi.fn((path: string) => {
      files.delete(String(path));
    }),
  };
});

vi.mock("fs", () => ({
  writeFileSync: fileSystem.writeFileSync,
  readFileSync: fileSystem.readFileSync,
  existsSync: fileSystem.existsSync,
  mkdirSync: fileSystem.mkdirSync,
  renameSync: fileSystem.renameSync,
  unlinkSync: fileSystem.unlinkSync,
}));

import {
  createSandboxTaskAndLinkCandidate,
  deleteSandboxCandidate,
  loadDemoSandboxStore,
  saveDemoSandboxStore,
} from "@/lib/server/demoSandbox";
import {
  buildCandidateAnalysisContext,
  createCandidateAnalysisBindingHash,
} from "@/lib/server/candidateAnalysisContext";

const STORE_PATH = "C:\\candidate-sandbox-test\\sandbox.json";
const BACKUP_PATH = `${STORE_PATH}.backup`;
const NEIGHBOR_PATH = "C:\\candidate-sandbox-test\\do-not-touch.txt";
const ORIGINAL = JSON.stringify({ version: 1, tasks: [], candidates: [{ id: "original" }] });

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "sandbox_candidate_a",
    demoAccessId: "visitor-a",
    name: "Candidate A",
    rawInput: "Candidate A",
    link: null,
    score: 70,
    source: "访客输入",
    keyword: "",
    riskLevel: "",
    riskLabel: "",
    summaryLabel: "",
    status: "worth_analyzing",
    sourceMetaJson: "{}",
    analysisJson: "{}",
    createdAt: "2026-07-12T00:00:00.000Z",
    convertedTaskId: null,
    lastActionAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fileSystem.files.clear();
  fileSystem.directories.clear();
  fileSystem.directories.add("C:\\candidate-sandbox-test");
  fileSystem.renameSync.mockImplementation((from: string, to: string) => {
    const source = String(from);
    const target = String(to);
    const value = fileSystem.files.get(source);
    if (value === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    fileSystem.files.delete(source);
    fileSystem.files.set(target, value);
  });
  process.env.DEMO_SANDBOX_STORE_PATH = STORE_PATH;
});

describe("demo Sandbox recoverable replacement", () => {
  it("keeps the original Candidate and creates no Task when combined publication fails", () => {
    const atomicCandidate = {
      id: "sandbox_candidate_atomic",
      demoAccessId: "visitor-a",
      name: "Atomic Product",
      rawInput: "Atomic Product",
      link: null,
      score: 70,
      source: "访客输入",
      keyword: "",
      riskLevel: "",
      riskLabel: "",
      summaryLabel: "",
      status: "worth_analyzing",
      sourceMetaJson: "{}",
      analysisJson: "{}",
      createdAt: "2026-07-12T00:00:00.000Z",
      convertedTaskId: null,
      lastActionAt: null,
    };
    const originalStore = {
      version: 1 as const,
      tasks: [],
      candidates: [atomicCandidate],
    };
    const originalJson = JSON.stringify(originalStore);
    fileSystem.files.set(STORE_PATH, originalJson);
    let tempToTargetCalls = 0;
    fileSystem.renameSync.mockImplementation((from: string, to: string) => {
      const source = String(from);
      const target = String(to);
      if (source.endsWith(".tmp") && target === STORE_PATH) {
        tempToTargetCalls += 1;
        throw Object.assign(new Error(tempToTargetCalls === 1 ? "EPERM" : "EIO"), {
          code: tempToTargetCalls === 1 ? "EPERM" : "EIO",
        });
      }
      const value = fileSystem.files.get(source);
      if (value === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      fileSystem.files.delete(source);
      fileSystem.files.set(target, value);
    });

    expect(() => createSandboxTaskAndLinkCandidate("visitor-a", "sandbox_candidate_atomic", {
      title: "Atomic Product 一键分析",
    }, {
      expectedProductName: "Atomic Product",
      expectedContextHash: createCandidateAnalysisBindingHash(
        atomicCandidate,
        buildCandidateAnalysisContext(atomicCandidate),
      ),
    })).toThrow("EIO");
    expect(fileSystem.files.get(STORE_PATH)).toBe(originalJson);
    expect(JSON.parse(fileSystem.files.get(STORE_PATH)!).tasks).toHaveLength(0);
    expect(JSON.parse(fileSystem.files.get(STORE_PATH)!).candidates[0].convertedTaskId).toBeNull();
  });

  it("restores the original target when both replacement renames fail", () => {
    fileSystem.files.set(STORE_PATH, ORIGINAL);
    fileSystem.files.set(NEIGHBOR_PATH, "neighbor");
    let tempToTargetCalls = 0;
    fileSystem.renameSync.mockImplementation((from: string, to: string) => {
      const source = String(from);
      const target = String(to);
      if (source.endsWith(".tmp") && target === STORE_PATH) {
        tempToTargetCalls += 1;
        throw Object.assign(new Error(tempToTargetCalls === 1 ? "EPERM" : "EIO"), {
          code: tempToTargetCalls === 1 ? "EPERM" : "EIO",
        });
      }
      const value = fileSystem.files.get(source);
      if (value === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      fileSystem.files.delete(source);
      fileSystem.files.set(target, value);
    });

    expect(() => saveDemoSandboxStore({ version: 1, tasks: [], candidates: [] })).toThrow("EIO");
    expect(fileSystem.files.get(STORE_PATH)).toBe(ORIGINAL);
    expect(fileSystem.files.has(BACKUP_PATH)).toBe(false);
    expect(fileSystem.files.get(NEIGHBOR_PATH)).toBe("neighbor");
  });

  it("recovers the controlled backup when the target is missing", () => {
    fileSystem.files.set(BACKUP_PATH, ORIGINAL);
    fileSystem.files.set(NEIGHBOR_PATH, "neighbor");

    const result = loadDemoSandboxStore();

    expect(result).toMatchObject({ version: 1, candidates: [{ id: "original" }] });
    expect(fileSystem.files.get(STORE_PATH)).toBe(ORIGINAL);
    expect(fileSystem.files.has(BACKUP_PATH)).toBe(false);
    expect(fileSystem.files.get(NEIGHBOR_PATH)).toBe("neighbor");
  });

  it("cleans a stale controlled backup only after a valid target exists", () => {
    fileSystem.files.set(STORE_PATH, ORIGINAL);
    fileSystem.files.set(BACKUP_PATH, "stale-backup");
    fileSystem.files.set(NEIGHBOR_PATH, "neighbor");

    expect(loadDemoSandboxStore()).toMatchObject({ version: 1, candidates: [{ id: "original" }] });
    expect(fileSystem.files.has(BACKUP_PATH)).toBe(false);
    expect(fileSystem.files.get(NEIGHBOR_PATH)).toBe("neighbor");
  });
});

describe("demo Sandbox Candidate delete lifecycle", () => {
  it("returns linked_task and publishes nothing for a converted Candidate", () => {
    const originalJson = JSON.stringify({
      version: 1,
      tasks: [],
      candidates: [candidate({ convertedTaskId: "sandbox_task_linked" })],
    });
    fileSystem.files.set(STORE_PATH, originalJson);

    expect(deleteSandboxCandidate("visitor-a", "sandbox_candidate_a")).toBe("linked_task");
    expect(fileSystem.writeFileSync).not.toHaveBeenCalled();
    expect(fileSystem.files.get(STORE_PATH)).toBe(originalJson);
  });

  it("returns not_found without publishing when Visitor A targets Visitor B Candidate", () => {
    const originalJson = JSON.stringify({
      version: 1,
      tasks: [],
      candidates: [candidate({ demoAccessId: "visitor-b", convertedTaskId: "sandbox_task_b" })],
    });
    fileSystem.files.set(STORE_PATH, originalJson);

    expect(deleteSandboxCandidate("visitor-a", "sandbox_candidate_a")).toBe("not_found");
    expect(fileSystem.writeFileSync).not.toHaveBeenCalled();
    expect(fileSystem.files.get(STORE_PATH)).toBe(originalJson);
  });

  it("deletes an unlinked Candidate through the existing atomic publication", () => {
    fileSystem.files.set(STORE_PATH, JSON.stringify({
      version: 1,
      tasks: [],
      candidates: [candidate()],
    }));

    expect(deleteSandboxCandidate("visitor-a", "sandbox_candidate_a")).toBe("deleted");
    expect(fileSystem.writeFileSync).toHaveBeenCalledOnce();
    expect(JSON.parse(fileSystem.files.get(STORE_PATH)!)).toMatchObject({ candidates: [] });
  });
});
