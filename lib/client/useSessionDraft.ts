"use client";

/**
 * useSessionDraft — 会话草稿（刷新防丢失）。
 *
 * 用途：用户在页面填写/勾选/切换步骤过程中，即使网页刷新也能恢复尚未提交的内容。
 * 使用 sessionStorage（标签页生命周期），不使用 localStorage，不写入正式数据库。
 *
 * 隔离规则：
 *   Key = `qingxuan-workbench:draft:v1:<subject>:<pageKind>:<entityId>:<revision>`
 *   - subject  安全主体标识：owner 用稳定 "owner"，访客用 demoAccessId（绝不使用密码/Token/Cookie）
 *   - pageKind 页面类型（如 "research-decision" / "creative-handoff" / "candidate-pool"）
 *   - entityId taskId 或 candidateId
 *   - revision researchRevision / handoff revision 或 storageVersion
 *
 * Revision 语义：
 *   - 调用方在首次加载完成、获知服务端权威 revision 前传入 null（尚未获知：不暴露草稿、
 *     不判定过期、不写入）；
 *   - 获知后传入真实 revision：与「已恢复草稿自带的 revision」一致才恢复；
 *     不一致 → 自动清除旧草稿并提示（绝不把旧草稿恢复到新 Handoff/新研究上）。
 *     恢复暴露延迟到校验之后，避免「先闪现旧草稿再失效」。
 *
 * 写入抑制：
 *   - 恢复窗口：恢复后跳过首次默认值写入，基线为已恢复草稿；
 *   - 无草稿且值仍为初始默认值：不写入（避免"假已保存"）；
 *   - 值与最近一次写入一致：不重复写入；
 *   - 清除（手动 / 提交成功）后的回显抑制：短时间窗口内跳过组件 effect 回写。
 *
 * 安全边界：
 *   - 禁止保存密码、Access Token、Cookie、API Key、XLSX 内容、图片 Base64/Blob、
 *     完整 Handoff/resultJson、内部主体对象、Provider 响应、原始商品图片 URL。
 *   - SSR 安全：不在服务端访问 window/sessionStorage。
 *   - JSON 解析失败 / 草稿校验不匹配 → 自动清理，不恢复。
 *   - 存储异常不阻断正常操作（静默降级）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAccessMode, getDemoAccessInfo } from "@/lib/client/accessToken";

export const SESSION_DRAFT_SCHEMA = "qingxuan-workbench:draft:v1";

export type SessionDraftResult<T> = {
  /** 恢复出的草稿（仅恢复校验通过后非 null） */
  draft: T | null;
  /** 是否刚刚恢复了草稿（用于展示"已恢复刷新前的未提交内容"） */
  restored: boolean;
  /** 草稿已保存状态 */
  saved: boolean;
  /** 是否因 Revision 变化而删除旧草稿并提示 */
  invalidated: boolean;
  /** 保存草稿（防抖） */
  save: (next: T) => void;
  /** 立即保存（提交前 flush） */
  flush: (next: T) => void;
  /** 清除当前草稿 */
  clear: () => void;
};

/** 安全主体标识：owner 用稳定标识，访客用 demoAccessId（不用 token） */
export function sessionSubjectKey(): string {
  const mode = getAccessMode();
  if (mode === "owner") return "owner";
  if (mode === "demo") {
    const info = getDemoAccessInfo();
    return info?.id ?? "demo:unknown";
  }
  return "anonymous";
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function storagePrefix(subject: string, pageKind: string, entityId: string): string {
  return `${SESSION_DRAFT_SCHEMA}:${subject}:${pageKind}:${entityId}:`;
}

/** 清除指定主体下全部草稿（切换身份 / 退出登录时使用） */
export function clearSessionDraftsForSubject(subject: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const prefix = `${SESSION_DRAFT_SCHEMA}:${subject}:`;
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) toRemove.push(key);
    }
    for (const key of toRemove) storage.removeItem(key);
  } catch {
    // 存储异常静默降级
  }
}

/** 清除指定实体（task/candidate）对应页面类型的草稿（删除任务/候选时使用） */
export function clearSessionDraftsForEntity(pageKind: string, entityId: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const prefix = storagePrefix(sessionSubjectKey(), pageKind, entityId);
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) toRemove.push(key);
    }
    for (const key of toRemove) storage.removeItem(key);
  } catch {
    // 存储异常静默降级
  }
}

type StoredDraft<T> = {
  draft: T | null;
  restored: boolean;
  /** 已恢复草稿自带的 revision（key 后缀；无草稿时为空串） */
  restoredRevision: string;
};

function readStored<T>(subject: string, pageKind: string, entityId: string): StoredDraft<T> {
  if (typeof window === "undefined") return { draft: null, restored: false, restoredRevision: "" };
  const prefix = storagePrefix(subject, pageKind, entityId);
  try {
    const storage = window.sessionStorage;
    const candidates: Array<{ revision: string; raw: string }> = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) {
        candidates.push({ revision: key.slice(prefix.length), raw: storage.getItem(key) ?? "" });
      }
    }
    if (candidates.length === 0) return { draft: null, restored: false, restoredRevision: "" };
    candidates.sort((a, b) => (a.revision > b.revision ? 1 : a.revision < b.revision ? -1 : 0));
    const latest = candidates[candidates.length - 1];
    const parsed = JSON.parse(latest.raw) as {
      schema?: string; subject?: string; pageKind?: string; entityId?: string; data?: T;
    };
    if (
      parsed?.schema !== SESSION_DRAFT_SCHEMA
      || parsed.subject !== subject
      || parsed.pageKind !== pageKind
      || parsed.entityId !== entityId
      || parsed.data === undefined
    ) {
      for (const c of candidates) storage.removeItem(`${prefix}${c.revision}`);
      return { draft: null, restored: false, restoredRevision: "" };
    }
    return { draft: parsed.data, restored: true, restoredRevision: latest.revision };
  } catch {
    // JSON 解析失败 / 存储异常 → 清除该实体相关草稿，不恢复
    try {
      const storage = window.sessionStorage;
      const toRemove: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key && key.startsWith(prefix)) toRemove.push(key);
      }
      for (const key of toRemove) storage.removeItem(key);
    } catch {
      // 忽略
    }
    return { draft: null, restored: false, restoredRevision: "" };
  }
}

/** 浅深比较：支持原始值 / 数组 / 纯对象（草稿均为小型表单状态） */
function looseEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => looseEqual(item, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    if (ka.length !== kb.length) return false;
    return ka.every((key) => looseEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ));
  }
  return false;
}

/** 清除后回显抑制窗口（毫秒）：清除后组件 effect 会立即回写，此窗口内跳过 */
const DISCARD_ECHO_WINDOW_MS = 1500;

/**
 * 创建隔离的草稿 Hook。
 *
 * @param options.pageKind  页面类型（research-decision / creative-handoff / candidate-pool）
 * @param options.entityId  taskId 或 candidateId
 * @param options.revision  版本标识（researchRevision / handoff revision / storageVersion）。
 *                          null = 首次加载前尚未获知：不暴露草稿、不判定过期、不写入。
 *                          获知后必须传入真实值，只有与草稿自带 revision 一致才恢复。
 * @param options.initial   无草稿时的初始值（仅用于"是否仍为默认值"的判定）
 */
export function useSessionDraft<T>(options: {
  pageKind: string;
  entityId: string;
  revision: string | null;
  initial: T;
  /** 300~500ms 防抖保存（默认 400ms） */
  debounceMs?: number;
}): SessionDraftResult<T> {
  const { pageKind, entityId, revision, initial, debounceMs = 400 } = options;

  const subjectRef = useRef(sessionSubjectKey());
  // 挂载时读取存储（revision 未知时先暂存，待校验后暴露）
  const [stored] = useState<StoredDraft<T>>(() => readStored<T>(subjectRef.current, pageKind, entityId));
  const storedRef = useRef(stored);
  storedRef.current = stored;
  // 首次渲染的初始值（稳定基线，用于"仍为默认值"判定）
  const initialRef = useRef(initial);

  // 初始状态：revision 已同步获知时立即校验（SSR/renderToString 友好，不依赖 effect）；
  // revision 为 null（异步获知）时先不暴露。
  const [initialState] = useState<{
    draft: T | null;
    restored: boolean;
    invalidated: boolean;
    activeRevision: string | null;
  }>(() => {
    if (revision === null) {
      return { draft: null, restored: false, invalidated: false, activeRevision: null };
    }
    if (stored.restored && stored.restoredRevision === revision) {
      return { draft: stored.draft, restored: true, invalidated: false, activeRevision: revision };
    }
    if (stored.restored && stored.restoredRevision !== revision) {
      // 旧 Revision 草稿 → 立即清除并标记失效（不恢复旧内容）
      const storage = safeStorage();
      if (storage) {
        try {
          const prefix = storagePrefix(subjectRef.current, pageKind, entityId);
          const toRemove: string[] = [];
          for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (key && key.startsWith(prefix)) toRemove.push(key);
          }
          for (const key of toRemove) storage.removeItem(key);
        } catch { /* ignore */ }
      }
      return { draft: null, restored: false, invalidated: true, activeRevision: revision };
    }
    return { draft: null, restored: false, invalidated: false, activeRevision: revision };
  });

  const [draft, setDraft] = useState<T | null>(initialState.draft);
  const [restored, setRestored] = useState(initialState.restored);
  const [saved, setSaved] = useState(false);
  const [invalidated, setInvalidated] = useState(initialState.invalidated);
  // 当前草稿写入的 revision（null = 尚未获知，不写入）
  const [activeRevision, setActiveRevision] = useState<string | null>(initialState.activeRevision);
  // 用户已主动清除（手动清除 / 提交成功后清除）：静默采用新 revision，不再判定过期
  const discardedRef = useRef(false);
  // 恢复窗口保护：恢复后跳过首次默认值写入
  const wroteOnceRef = useRef(false);
  // 最近一次已知处于存储中的值（写入成功 / 恢复时更新）
  const lastWrittenRef = useRef<T | null>(stored.draft);
  // 清除时间戳（回显抑制窗口）
  const clearedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storageKey = useMemo(() => {
    if (!activeRevision) return null;
    return `${storagePrefix(subjectRef.current, pageKind, entityId)}${activeRevision}`;
  }, [activeRevision, pageKind, entityId]);

  // Revision 变化（挂载后的过渡）：null→真实值（异步获知）或真实值→新值。
  // 仅处理「当前 activeRevision 与 revision 不一致」的情况；
  // 初始同步获知已在 lazy init 完成校验。
  const seenRevisionRef = useRef<string | null>(initialState.activeRevision);
  useEffect(() => {
    if (revision === null) return;
    if (seenRevisionRef.current === revision) return;
    seenRevisionRef.current = revision;

    const current = storedRef.current;
    setActiveRevision(revision);
    setSaved(false);

    if (discardedRef.current) {
      // 已主动清除：静默采用新 revision，不再提示过期
      setInvalidated(false);
      setRestored(false);
      setDraft(null);
      return;
    }

    if (current.restored && current.restoredRevision === revision) {
      // 一致 → 恢复
      setDraft(current.draft);
      setRestored(true);
      setInvalidated(false);
      lastWrittenRef.current = current.draft;
      return;
    }

    if (current.restored && current.restoredRevision !== revision) {
      // 旧 Revision 草稿 → 清除并提示（绝不恢复旧内容）
      const storage = safeStorage();
      if (storage) {
        try {
          const prefix = storagePrefix(subjectRef.current, pageKind, entityId);
          const toRemove: string[] = [];
          for (let i = 0; i < storage.length; i += 1) {
            const key = storage.key(i);
            if (key && key.startsWith(prefix)) toRemove.push(key);
          }
          for (const key of toRemove) storage.removeItem(key);
        } catch { /* ignore */ }
      }
      setDraft(null);
      setRestored(false);
      setInvalidated(true);
      lastWrittenRef.current = null;
      return;
    }

    // 无草稿：正常空状态
    setDraft(null);
    setRestored(false);
    setInvalidated(false);
  }, [revision, pageKind, entityId]);

  const write = useCallback((next: T, key: string) => {
    const storage = safeStorage();
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify({
        schema: SESSION_DRAFT_SCHEMA,
        subject: subjectRef.current,
        pageKind,
        entityId,
        revision: activeRevision ?? "",
        data: next,
      }));
    } catch {
      // 存储异常（配额/禁用）：静默降级，不阻断操作
    }
  }, [pageKind, entityId, activeRevision]);

  const save = useCallback((next: T) => {
    if (!storageKey) return;
    // 清除后的回显抑制：提交/手动清除后，组件 effect 立即回写，此窗口内跳过
    if (clearedAtRef.current !== null && Date.now() - clearedAtRef.current < DISCARD_ECHO_WINDOW_MS) return;
    clearedAtRef.current = null;
    // 恢复窗口：跳过首次默认值写入，基线设为已恢复草稿
    if (restored && !wroteOnceRef.current) {
      wroteOnceRef.current = true;
      lastWrittenRef.current = storedRef.current.draft;
      return;
    }
    // 值与最近一次已知存储值一致 → 不重复写入
    if (lastWrittenRef.current !== null && looseEqual(next, lastWrittenRef.current)) return;
    // 无草稿且仍为初始默认值 → 不写入（避免"假已保存"）
    if (lastWrittenRef.current === null && looseEqual(next, initialRef.current)) return;
    lastWrittenRef.current = next;
    setSaved(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      write(next, storageKey);
      timerRef.current = null;
    }, debounceMs);
  }, [storageKey, write, debounceMs, restored, storedRef, initialRef]);

  const flush = useCallback((next: T) => {
    if (!storageKey) return;
    discardedRef.current = false;
    clearedAtRef.current = null;
    wroteOnceRef.current = true;
    lastWrittenRef.current = next;
    setSaved(false);
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    write(next, storageKey);
  }, [storageKey, write]);

  const clear = useCallback(() => {
    discardedRef.current = true;
    wroteOnceRef.current = true;
    lastWrittenRef.current = null;
    clearedAtRef.current = Date.now();
    setDraft(null);
    setRestored(false);
    setInvalidated(false);
    setSaved(false);
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (storageKey) {
      const storage = safeStorage();
      if (storage) {
        try { storage.removeItem(storageKey); } catch { /* ignore */ }
      }
    }
  }, [storageKey]);

  return {
    draft: restored ? draft : null,
    restored,
    saved,
    invalidated,
    save,
    flush,
    clear,
  };
}
