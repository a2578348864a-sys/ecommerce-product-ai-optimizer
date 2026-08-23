/**
 * V4.1 — 首页 V4 展示组件的运行模式派生逻辑（纯函数，SSR / 客户端一致）。
 *
 * 不 import WorkspaceSidebar：模式 Badge 与 CTA 矩阵在此按契约 §3 / §4 独立派生，
 * 避免共享高冲突组件被首页 Hero 引入（根 Agent 冻结 WorkspaceSidebar）。
 */
import type { RuntimeMode } from "@/lib/server/runtimeMode";

/** 首页运行模式（服务端权威，由 page.tsx 经 getRuntimeMode / isLocalOwnerNoAuthTrust / isV4GraphEnabled 派生）。 */
export type HomeRuntime = {
  mode: RuntimeMode;
  noAuthOwner: boolean;
  v4Graph: boolean;
};

/** Featured Replay 展示数据（服务端只读 loader 派生，见 components/v4/replay-featured.ts）。
 * 业务字段取自真实 bundle（candidate.name/keyword/market/link/report.summary/risk/content images 引用），
 * 缺失 → null（诚实空态）；主标题禁用 bundleId(UUID)。 */
export type FeaturedReplay = {
  bundleId: string;
  candidateName: string | null;
  keyword: string | null;
  market: string | null;
  link: string | null;
  riskLevel: string | null;
  summary: string | null;
  thumbnail: { src: string; alt: string } | null;
  capturedAt: string;
  exportedAt: string;
  scanOk: boolean;
  redactionEntries: number;
  filesCount: number;
  bundleSha256Short: string;
  timelineSteps: number;
  humanDecisions: number;
  guardItems: number;
};

/** 模式 Badge 文案（与 WorkspaceSidebar.modeBadgeLabel 同规则；unknown → 空，避免 hydration 漂移）。 */
export function v4ModeBadgeLabel(runtime: HomeRuntime): string {
  if (runtime.mode === "public_showcase") return "Public Replay · 只读脱敏案例";
  if (runtime.mode === "local_owner") {
    return runtime.v4Graph ? "Local Live · 可执行研究流程" : "本地模式 · V4 未启用";
  }
  return "";
}

export type HeroCta = {
  label: string;
  href: string;
  primary: boolean;
};

/**
 * CTA 矩阵（契约 §3 运行模式 CTA 矩阵）。
 *   Public        → 主 CTA「查看真实脱敏案例」/replay；次 CTA「了解研究流程」#workflow
 *   Local Live    → 主 CTA「开始商品研究」/v4/runs；次 CTA「查看研究任务」/v4/runs
 *   Local（off）  → 不显示 Live CTA；仅「案例回放」/replay
 */
export function deriveHeroCtas(runtime: HomeRuntime): {
  primary: HeroCta;
  secondary: HeroCta | null;
} {
  if (runtime.mode === "public_showcase") {
    return {
      primary: { label: "查看真实脱敏案例", href: "/replay", primary: true },
      secondary: { label: "了解研究流程", href: "#workflow", primary: false },
    };
  }

  if (runtime.mode === "local_owner") {
    if (runtime.v4Graph) {
      return {
        primary: { label: "开始商品研究", href: "/v4/runs", primary: true },
        secondary: { label: "查看研究任务", href: "/v4/runs", primary: false },
      };
    }
    // Local flag OFF：不得渲染 Live CTA / 不泄露 Live 入口。
    return {
      primary: { label: "案例回放", href: "/replay", primary: true },
      secondary: null,
    };
  }

  // 保守缺省（未知模式）：只暴露公开只读回放入口，绝不泄露 Live CTA。
  return {
    primary: { label: "案例回放", href: "/replay", primary: true },
    secondary: null,
  };
}

/** 公网 HR 演示收口：public_showcase 模式下一律展示演示首页（匿名与访客一致，不得切回旧工作台）。 */
export type HomeExperience = "showcase" | "dashboard" | "login";
export function deriveHomeExperience(runtime: HomeRuntime, authenticated: boolean): HomeExperience {
  if (runtime.mode === "public_showcase") return "showcase";
  if (runtime.mode === "local_owner" && runtime.noAuthOwner) return "dashboard";
  if (!authenticated) return "login";
  return "dashboard";
}
