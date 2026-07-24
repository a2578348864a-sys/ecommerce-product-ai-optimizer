import type { AccessContext } from "@/lib/server/accessPassword";

export type ScopeSubject =
  | Readonly<{ kind: "owner"; subjectId: "default" }>
  | Readonly<{ kind: "visitor"; subjectId: string }>;

export function resolveScopeSubject(context: AccessContext): ScopeSubject {
  return Object.freeze(
    context.mode === "owner"
      ? { kind: "owner" as const, subjectId: "default" as const }
      : { kind: "visitor" as const, subjectId: context.demoAccessId },
  );
}
