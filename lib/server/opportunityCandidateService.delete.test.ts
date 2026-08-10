import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    opportunityCandidate: {
      deleteMany: mocks.deleteMany,
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
      delete: mocks.delete,
    },
  },
}));

import {
  deleteCandidate,
  removeCandidateFromResearchPool,
} from "@/lib/server/opportunityCandidateService";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("removeCandidateFromResearchPool lifecycle guard", () => {
  it("archives a normal Candidate with status=rejected (unconditional write)", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(removeCandidateFromResearchPool("candidate-plain")).resolves.toBe("removed");

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "candidate-plain" },
      data: { status: "rejected", lastActionAt: expect.any(Date) },
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("archives a Task-linked Candidate without touching convertedTaskId", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(removeCandidateFromResearchPool("candidate-linked")).resolves.toBe("removed");

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "candidate-linked" },
      data: expect.not.objectContaining({ convertedTaskId: expect.anything() }),
    });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it("reports not_found when the Candidate is missing instead of a false success", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue({ id: "candidate-missing" });

    await expect(removeCandidateFromResearchPool("candidate-missing")).resolves.toBe("not_found");

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "candidate-missing" },
      data: { status: "rejected", lastActionAt: expect.any(Date) },
    });
  });

  it("never returns success when the write missed: a later linking cannot mask a not-found", async () => {
    // 第一次 update 未命中（记录尚不存在）→ remove 必须返回 not_found，
    // 即使随后记录被并发创建并绑定 Task，也不能伪造一次成功的落库。
    mocks.updateMany
      .mockResolvedValueOnce({ count: 0 });

    await expect(removeCandidateFromResearchPool("candidate-interleaved")).resolves.toBe("not_found");

    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});

describe("deleteCandidate lifecycle guard", () => {
  it("deletes only an unlinked Candidate with one conditional write", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });

    await expect(deleteCandidate("candidate-unlinked")).resolves.toBe("deleted");

    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { id: "candidate-unlinked", convertedTaskId: null },
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("fails closed when save-task has already linked the Candidate", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue({ id: "candidate-linked" });

    await expect(deleteCandidate("candidate-linked")).resolves.toBe("linked_task");

    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { id: "candidate-linked", convertedTaskId: null },
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: "candidate-linked" },
      select: { id: true },
    });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("distinguishes a missing Candidate after the conditional delete misses", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(deleteCandidate("candidate-missing")).resolves.toBe("not_found");

    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
