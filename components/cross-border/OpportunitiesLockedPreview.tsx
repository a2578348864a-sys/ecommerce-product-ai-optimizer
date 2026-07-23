import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Eye,
  Lightbulb,
  Lock,
  Search,
  ShieldCheck,
  Target,
  Upload,
} from "lucide-react";

import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";

type OpportunitiesLockedPreviewProps = {
  readonly surfaceCopy: {
    readonly eyebrow: string | null;
    readonly lockedTitle: string;
    readonly lockedDescription: string;
  };
};

export function OpportunitiesLockedPreview({
  surfaceCopy,
}: OpportunitiesLockedPreviewProps) {
  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />
        <div className="min-w-0 space-y-6">
          {/* Header — same as unlocked state for visual consistency */}
          <header className="workspace-header">
            <div className="flex items-center gap-3">
              <div className="linear-icon size-10 shrink-0 rounded-xl">
                <Target className="size-5" />
              </div>
              <div>
                {surfaceCopy.eyebrow ? <p className="linear-kicker">{surfaceCopy.eyebrow}</p> : null}
                <h1 className={surfaceCopy.eyebrow ? "mt-1 text-xl font-semibold tracking-tight text-slate-950" : "text-xl font-semibold tracking-tight text-slate-950"}>{surfaceCopy.lockedTitle}</h1>
                <p className="muted-text mt-1 text-sm">{surfaceCopy.lockedDescription}</p>
              </div>
            </div>
          </header>

          {/* Value proposition */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="linear-icon size-10 shrink-0 rounded-xl bg-amber-100 text-amber-600">
                <Lightbulb className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-800">把公开来源中的商品/趋势线索整理成可复核候选</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  粘贴公开 URL、RSS 或 Sitemap → 系统自动抓取并解析 → 你勾选确认后进入候选池 → 标记状态、筛选排序 → 进入单品分析深挖。
                </p>
              </div>
            </div>
          </div>

          {/* 3-step flow */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">三分钟上手流程</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { step: "1", icon: Upload, title: "导入来源", desc: "粘贴公开 URL、RSS 或 Sitemap，一次最多 5 条" },
                { step: "2", icon: Search, title: "解析候选", desc: "系统自动爬取、清洗、评分，生成候选清单" },
                { step: "3", icon: CheckCircle2, title: "人工复核入池", desc: "你勾选确认的候选才会写入候选池，其余自动丢弃" },
              ].map((s) => (
                <div key={s.step} className="flex flex-col items-center gap-2 rounded-lg bg-slate-50 p-4 text-center">
                  <div className="linear-icon size-9 shrink-0 rounded-lg bg-white text-slate-500 ring-1 ring-slate-200">
                    <s.icon className="size-4" />
                  </div>
                  <p className="text-sm font-semibold text-slate-700">{s.title}</p>
                  <p className="text-xs leading-relaxed text-slate-400">{s.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Example candidates — clearly marked as mock */}
          <section className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Eye className="size-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-amber-800">示例候选品（仅供参考，非真实数据）</h3>
            </div>
            <p className="mb-4 text-xs text-amber-600">
              以下为静态示例，展示候选池的卡片样式和状态标记。解锁后可查看真实候选数据。
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { name: "桌面手机支架", score: 90, level: "A", levelLabel: "强烈推荐", reasons: ["需求稳定", "采购门槛低", "售后风险小"], status: "worth_analyzing" },
                { name: "宠物慢食碗", score: 55, level: "B", levelLabel: "可选关注", reasons: ["细分需求增长", "食品接触需合规", "新手可尝试"], status: "pending" },
                { name: "硅胶折叠水杯", score: 45, level: "C", levelLabel: "谨慎评估", reasons: ["食品接触材料", "FDA/LFGB 认证", "专利风险"], status: "paused" },
              ].map((item, i) => (
                <div key={i} className="rounded-lg border border-amber-200 bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${item.level === "A" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : item.level === "B" ? "border-sky-200 bg-sky-50 text-sky-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                      {item.level} · {item.levelLabel}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                    <BarChart3 className="size-3" />
                    评分 {item.score} · 示例数据
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.reasons.map((r, j) => (
                      <span key={j} className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{r}</span>
                    ))}
                  </div>
                  <div className="mt-2 border-t border-slate-100 pt-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.status === "worth_analyzing" ? "bg-emerald-50 text-emerald-700" :
                      item.status === "pending" ? "bg-slate-100 text-slate-500" :
                      "bg-amber-50 text-amber-700"
                    }`}>
                      {item.status === "worth_analyzing" ? "值得深挖" : item.status === "pending" ? "待判断" : "暂缓"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Data safety notice */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <ShieldCheck className="size-5 shrink-0 text-emerald-500" />
              <div>
                <h3 className="text-sm font-semibold text-slate-800">数据安全说明</h3>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-500">
                  <li>· 未解锁时不会读取或展示任何真实候选池数据</li>
                  <li>· 来源导入抓取结果只是临时预览，确认导入前不写数据库</li>
                  <li>· 删除候选需要二次确认，&ldquo;标记为放弃&rdquo;不等于删除</li>
                  <li>· 所有关键动作（导入、删除、进入分析）都需人工操作</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Unlock CTA */}
          <div className="rounded-xl border-2 border-dashed border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50 p-6 text-center shadow-sm">
            <div className="mx-auto flex max-w-md flex-col items-center gap-4">
              <div className="linear-icon size-12 rounded-2xl bg-blue-100 text-blue-500">
                <Lock className="size-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-800">解锁后使用完整功能</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  输入访问密码后，即可连接服务端候选池、使用来源导入、管理真实候选数据。
                </p>
              </div>
              <Link
                href="/?redirect=%2Fopportunities"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                返回首页解锁
                <ArrowRight className="size-4" />
              </Link>
              <p className="text-xs text-slate-400">
                轻选 Agent · Alpha MVP · 受控自动化 + 人工复核
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
