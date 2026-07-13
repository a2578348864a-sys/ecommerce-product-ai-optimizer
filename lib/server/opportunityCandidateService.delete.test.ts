import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  findUnique: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    opportunityCandidate: {
      deleteMany: mocks.deleteMany,
      findUnique: mocks.findUnique,
      delete: mocks.delete,
    },
  },
}));

import { deleteCandidate } from "@/lib/server/opportunityCandidateService";

beforeEach(() => {
  vi.clearAllMocks();
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
