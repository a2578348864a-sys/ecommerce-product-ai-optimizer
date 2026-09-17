import "server-only";

import type { SandboxTask } from "@/lib/server/demoSandbox";
import { mutateDemoSandboxStore } from "@/lib/server/demoSandboxStore.internal";

export function mutateSandboxTaskResultJsonInternal<T>(
  demoAccessId: string,
  taskId: string,
  action: (task: SandboxTask) => Promise<{ task: SandboxTask; value: T }> | { task: SandboxTask; value: T },
): Promise<{ status: "updated"; task: SandboxTask; value: T } | { status: "not_found" }> {
  return mutateDemoSandboxStore<
    { status: "updated"; task: SandboxTask; value: T } | { status: "not_found" }
  >(async (store) => {
    const index = store.tasks.findIndex(
      (task) => task.id === taskId && task.demoAccessId === demoAccessId,
    );
    if (index === -1) {
      return { value: { status: "not_found" as const }, changed: false };
    }
    const current = structuredClone(store.tasks[index]);
    const result = await action(current);
    if (result.task.id !== current.id || result.task.demoAccessId !== current.demoAccessId) {
      throw new Error("SANDBOX_TASK_IDENTITY_MUTATION_FORBIDDEN");
    }
    store.tasks[index] = structuredClone(result.task);
    return {
      value: { status: "updated" as const, task: structuredClone(result.task), value: result.value },
      changed: true,
    };
  });
}
