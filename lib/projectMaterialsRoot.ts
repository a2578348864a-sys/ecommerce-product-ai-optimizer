import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH } from "@/lib/marketScreeningBatchManifest";

export type ProjectMaterialsRootResolution =
  | {
      status: "ready";
      projectMaterialsRoot: string;
      source: "runtime_config" | "project_parent" | "git_worktree";
    }
  | {
      status: "unavailable";
      errorCode: "project_materials_root_unavailable";
    };

function isContained(root: string, candidate: string) {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function recognizedMaterialsRoot(candidate: string): string | null {
  if (!isAbsolute(candidate)) return null;

  try {
    if (lstatSync(candidate).isSymbolicLink()) return null;
    const root = realpathSync(candidate);
    if (!statSync(root).isDirectory()) return null;

    const marker = resolve(root, FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH);
    if (!isContained(root, marker) || lstatSync(marker).isSymbolicLink()) return null;
    const markerReal = realpathSync(marker);
    if (!isContained(root, markerReal) || !statSync(markerReal).isFile()) return null;
    return root;
  } catch {
    return null;
  }
}

function gitWorktreeProjectRoot(cwd: string): string | null {
  const dotGit = resolve(cwd, ".git");

  try {
    const dotGitStat = lstatSync(dotGit);
    if (dotGitStat.isSymbolicLink()) return null;
    if (dotGitStat.isDirectory()) return dirname(cwd);
    if (!dotGitStat.isFile()) return null;

    const match = /^gitdir:\s*(.+)\s*$/u.exec(readFileSync(dotGit, "utf8").trim());
    if (!match) return null;
    const gitDir = isAbsolute(match[1]) ? resolve(match[1]) : resolve(cwd, match[1]);
    const worktreesDir = dirname(gitDir);
    if (basename(worktreesDir).toLowerCase() !== "worktrees") {
      return null;
    }
    const commonGitDir = dirname(worktreesDir);
    return dirname(dirname(commonGitDir));
  } catch {
    return null;
  }
}

export function resolveProjectMaterialsRoot(options: {
  configuredRoot?: string | null;
  cwd?: string;
} = {}): ProjectMaterialsRootResolution {
  const configuredRoot = options.configuredRoot === null
    ? undefined
    : options.configuredRoot ?? process.env.PROJECT_MATERIALS_ROOT;
  const cwd = resolve(options.cwd ?? process.cwd());

  if (configuredRoot !== undefined) {
    const root = recognizedMaterialsRoot(configuredRoot.trim());
    return root
      ? { status: "ready", projectMaterialsRoot: root, source: "runtime_config" }
      : { status: "unavailable", errorCode: "project_materials_root_unavailable" };
  }

  const projectParent = recognizedMaterialsRoot(resolve(cwd, ".."));
  if (projectParent) {
    return {
      status: "ready",
      projectMaterialsRoot: projectParent,
      source: "project_parent",
    };
  }

  const gitProjectRoot = gitWorktreeProjectRoot(cwd);
  const worktreeRoot = gitProjectRoot ? recognizedMaterialsRoot(gitProjectRoot) : null;
  if (worktreeRoot) {
    return {
      status: "ready",
      projectMaterialsRoot: worktreeRoot,
      source: "git_worktree",
    };
  }

  return {
    status: "unavailable",
    errorCode: "project_materials_root_unavailable",
  };
}
