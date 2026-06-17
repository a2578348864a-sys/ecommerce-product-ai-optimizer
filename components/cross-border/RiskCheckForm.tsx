"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceMobileNav, WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { CROSS_BORDER_PLATFORMS } from "@/lib/types";
import { useSharedProduct } from "@/hooks/useSharedProduct";
import { useLocalStorage } from "@/hooks/useLocalStorage";

type RiskLevel = "green" | "yellow" | "red";

type RiskCheckItem = {
  category: string;
  level: RiskLevel;
  title: string;
  description: string;
  suggestion: string;
};

type RiskCheckData = {
  overallLevel: RiskLevel;
  summary: string;
  risks: RiskCheckItem[];
  blacklistMatches: string[];
  beginnerFriendly: boolean;
};

type RiskCheckApiResponse =
  | { ok: true; data: RiskCheckData }
  | { ok: false; error: { code: string; message: string } };

const levelLabels: Record<RiskLevel, string> = {
  green: "低风险",
  yellow: "需注意",
  red: "高风险",
};

const levelClasses: Record<RiskLevel, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  yellow: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
};

const levelDotClasses: Record<RiskLevel, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};

const defaultCategories = [
  "服装配饰", "鞋靴箱包", "美妆个护", "3C数码", "家居日用",
  "母婴用品", "食品饮料", "运动户外", "宠物用品", "玩具乐器",
  "汽车用品", "医疗器械", "成人用品", "珠宝首饰", "其他",
];

function isRiskCheckApiResponse(value: unknown): value is RiskCheckApiResponse {
  return typeof value === "object" && value !== null && "ok" in value;
}

export function RiskCheckForm() {
  const [sharedProduct, updateShared] = useSharedProduct();
  const [productName, setProductName] = useState(sharedProduct.productName);
  const [category, setCategory] = useState(sharedProduct.category);
  const [claims, setClaims] = useState(sharedProduct.claims);
  const [targetPlatform, setTargetPlatform] = useState(sharedProduct.targetPlatform);
  const [description, setDescription] = useState(sharedProduct.description);
  const [accessPassword, setAccessPassword] = useLocalStorage("qingxuan-pwd", "");
  const [result, setResult] = useState<RiskCheckData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncToShared = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      updateShared({ productName, category, targetPlatform, description, claims });
    }, 500);
  }, [productName, category, targetPlatform, description, claims, updateShared]);

  useEffect(() => {
    syncToShared();
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [syncToShared]);

  async function handleSubmit() {
    if (loading) return;

    if (!productName.trim()) {
      setError("请先填写商品名称。");
      return;
    }

    if (!accessPassword.trim()) {
      setError("请输入访问密码。");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/agents/risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName: productName.trim(),
          category: category.trim(),
          claims: claims.trim(),
          targetPlatform,
          description: description.trim(),
          accessPassword: accessPassword.trim(),
        }),
      });

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        setError("服务端返回格式异常。");
        return;
      }

      if (!isRiskCheckApiResponse(payload)) {
        setError("服务端返回格式异常。");
        return;
      }

      if (payload.ok) {
        setResult(payload.data);
        return;
      }

      setError(payload.error.message || "风险排查失败，请稍后重试。");
    } catch {
      setError("网络异常，请检查本地服务或网络。");
    } finally {
      setLoading(false);
    }
  }

  const hasResult = Boolean(result);

  return (
    <main className="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <div className="workspace-page workspace-layout">
        <WorkspaceSidebar />

        <div className="min-w-0 space-y-6">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">Qingxuan Workspace</p>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">风险排查</h1>
              <p className="muted-text mt-1 text-sm">检查侵权、功效宣称、品类、物流和售后风险，仅做参考不做最终法律判断。</p>
            </div>
            <WorkspaceMobileNav />
          </header>

          {/* Form */}
          <section className="surface-card rounded-[28px] p-5">
            <div className="mb-5">
              <h2 className="text-xl font-bold text-slate-950">商品风险信息</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                填写商品基本信息后，AI 会从侵权、合规、物流、售后等维度做风险排查。
              </p>
            </div>

            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">商品名称 *</span>
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="例如：便携式桌面收纳盒、猫咪慢食碗"
                    className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">商品品类</span>
                  <div className="relative">
                    <input
                      type="text"
                      list="risk-category-list"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="例如：家居日用、户外用品"
                      className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    />
                    <datalist id="risk-category-list">
                      {defaultCategories.map((cat) => (
                        <option key={cat} value={cat} />
                      ))}
                    </datalist>
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">目标平台</span>
                  <select
                    value={targetPlatform}
                    onChange={(e) => setTargetPlatform(e.target.value)}
                    className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  >
                    {CROSS_BORDER_PLATFORMS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-800">卖点声明 / 功效宣称</span>
                  <input
                    type="text"
                    value={claims}
                    onChange={(e) => setClaims(e.target.value)}
                    placeholder="例如：防水IPX4、食品级硅胶、承重30kg"
                    className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                  <p className="mt-1 text-xs text-slate-400">填写商品详情页宣传的卖点词，AI 会检查是否有违规宣传风险。</p>
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">商品描述</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="简单描述商品用途、材质、规格和适用人群。"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-800">访问密码</span>
                <input
                  type="password"
                  value={accessPassword}
                  onChange={(e) => setAccessPassword(e.target.value)}
                  placeholder="输入服务端配置的访问密码"
                  className="h-11 w-full max-w-xs rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="glass-button-primary inline-flex h-11 items-center justify-center px-6 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "排查中..." : hasResult ? "重新排查" : "开始风险排查"}
              </button>
            </div>
          </section>

          {/* Error */}
          {error ? (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </section>
          ) : null}

          {/* Loading */}
          {loading ? (
            <section className="surface-card rounded-[28px] p-5">
              <p className="text-sm text-slate-500">AI 正在分析商品风险，请稍等...</p>
            </section>
          ) : null}

          {/* No result yet */}
          {!hasResult && !loading ? (
            <section className="surface-card rounded-[28px] p-5">
              <div className="max-w-2xl">
                <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">待排查</span>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  填写商品名称、品类和卖点声明后，点击「开始风险排查」。AI 会从侵权、功效宣称、品类合规、平台规则、物流和售后共 6 个维度做检查。
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  AI 结果仅供运营参考，不做最终法律判断。上架前必须人工复核平台最新规则和当地法规。
                </p>
              </div>
            </section>
          ) : null}

          {/* Results */}
          {result ? (
            <section className="surface-card rounded-[28px] p-5">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">风险排查结果</h2>
                  <p className="mt-1 text-sm text-slate-500">AI 辅助分析，最终决策需人工复核。</p>
                </div>
                <span className={`inline-flex shrink-0 rounded-full border px-4 py-1.5 text-sm font-bold ${levelClasses[result.overallLevel]}`}>
                  {levelLabels[result.overallLevel]}
                </span>
              </div>

              {/* Summary */}
              <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">综合判断</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{result.summary}</p>
              </div>

              {/* Risk cards */}
              <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {result.risks.map((risk) => (
                  <div key={risk.category} className="surface-card-soft rounded-[22px] p-4">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block size-2.5 shrink-0 rounded-full ${levelDotClasses[risk.level]}`} />
                      <span className="text-xs font-semibold text-slate-500">{risk.category}</span>
                      <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-semibold ${levelClasses[risk.level]}`}>
                        {levelLabels[risk.level]}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-bold text-slate-950">{risk.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{risk.description}</p>
                    <p className="mt-2 text-xs leading-5 text-teal-700">
                      <span className="font-semibold">建议：</span>{risk.suggestion}
                    </p>
                  </div>
                ))}
              </div>

              {/* Blacklist matches */}
              {result.blacklistMatches.length ? (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-900">匹配到高风险类目</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.blacklistMatches.map((item) => (
                      <span key={item} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Beginner friendly */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-3">
                  <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${result.beginnerFriendly ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {result.beginnerFriendly ? "适合新手操作" : "建议有经验者操作"}
                  </span>
                  <span className="text-xs text-slate-500">
                    {result.beginnerFriendly ? "小白运营可以独立上架和售后。" : "该品类复杂度较高，建议先咨询有经验的运营或服务商。"}
                  </span>
                </div>
              </div>
            </section>
          ) : null}

          {/* 下一步 */}
          <section className="surface-card rounded-[28px] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-600">Step 2 完成 → 下一步</p>
                <p className="mt-1 text-sm text-slate-500">知道有什么风险了，接下来算算能不能赚钱。</p>
              </div>
              <Link href="/products/new" className="glass-button-primary inline-flex h-11 items-center justify-center gap-2 px-5 text-sm font-semibold">
                选品体检 → Step 3
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
