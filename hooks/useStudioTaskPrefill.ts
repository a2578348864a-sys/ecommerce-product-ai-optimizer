"use client";

import { useEffect, useState } from "react";
import {
  loadStudioTaskPrefill,
  type StudioTaskPrefill,
} from "@/lib/client/studioTaskPrefill";

type StudioTaskPrefillState =
  | { status: "idle"; data: null }
  | { status: "loading"; data: null }
  | { status: "ready"; data: StudioTaskPrefill }
  | { status: "unavailable"; data: null };

export function useStudioTaskPrefill(taskId?: string) {
  const normalizedTaskId = taskId?.trim() || "";
  const [state, setState] = useState<StudioTaskPrefillState>({
    status: normalizedTaskId ? "loading" : "idle",
    data: null,
  });

  useEffect(() => {
    if (!normalizedTaskId) {
      setState({ status: "idle", data: null });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading", data: null });
    loadStudioTaskPrefill(normalizedTaskId, controller.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "unavailable", data: null });
      });

    return () => controller.abort();
  }, [normalizedTaskId]);

  return state;
}
