/** Feature flag 关闭时的占位（D4）。 */
export function V4DisabledPlaceholder() {
  return (
    <div data-testid="v4-disabled-placeholder" className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <p className="text-sm font-bold text-slate-900">V4 研究图未启用</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
        当前环境未开启 V4 研究图（QX_V4_GRAPH_ENABLED）。开启后此处将展示研究运行的节点、预算、暂停与恢复状态。
      </p>
    </div>
  );
}
