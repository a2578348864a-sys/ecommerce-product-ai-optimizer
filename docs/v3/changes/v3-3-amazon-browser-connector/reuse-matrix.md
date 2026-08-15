# V3.3 — V3.1 → V3.3 Reuse Matrix

> 原则：V3.1 是技术验证资产，不等于生产实现。逐文件、逐能力审查后选择性吸收；禁止整 branch merge。

| V3.1 资产 | 是否复用 | 原因 | V3.3 正式落点 |
|---|---|---|---|
| `detail-page-extract.ts`（6 字段提取器） | **复用（核心）** | 10 商品实测 0 误绑、0 wrong_value；确定性锚点 + 严格格式 + fail-closed 正是正式产品需要 | 复制为 `tools/collectors/amazon/detail-page-extract.ts`（正式资产，保留测试） |
| `detail-page-extract.test.ts`（11 用例） | **复用（核心）** | 覆盖错绑/缺字段/格式非法/JPY/captcha 等对抗场景 | 同路径复制，补 JPY/currency 用例 |
| 实体绑定机制（URL ASIN + 页面 ASIN 锚点双一致） | **复用（核心）** | Wrong Entity=0 硬门禁的唯一机制 | 原样进入合同（browser-evidence.v1 bindingProof） |
| locale/currency guard（JPY → price unknown） | **复用（核心）** | V3.1 实测非 US 网络返回 JPY；正式产品必须显式处理 | 进入 collect 流程 + Preview 币种提示 |
| captcha/login/error 页面分类 | **复用** | fail-closed 前提 | 复用 page-diagnostics 门禁（main 已有） |
| `browser-control.ts`（CDP 会话） | **复用（main 已有）** | 隔离临时 Profile/白名单/清理；V3 Core 已入库 | 直接 import（main 基线已有，无需复制） |
| `detail-page-collector.ts`（批量采集器） | **部分复用** | 环境设置（US ZIP）在当前网络失败；批量循环不适配"单页采集+Preview"流程 | 只吸收"自动导航单页 + 提取"逻辑；环境设置失败 → currency 提示；批量循环不进入 |
| `detail-page-runtime.ts` / `detail-page-cli.mjs`（human-assisted CLI） | **拒绝（重写）** | 终端交互 CLI 不满足"工作台内可理解入口"；改由 API + 工作台 UI 触发 | 正式入口 = `POST /api/tasks/[id]/browser-evidence`（collect/save）+ Evidence Workbench UI |
| `detail-page.runtime.test.ts`（授权运行时） | **拒绝** | 依赖真实浏览器授权；正式链 Smoke 由测试任务替代 | Smoke 走 API 链路（测试任务数据） |
| 一次性脚本（probe/batch/verify/debug-zip 等） | **拒绝** | 实验调试产物 | 不进入 |
| `browser-control.ts` 的 evaluateByValue 错误信息增强、maxNavigations 20 | **复用** | fail-closed 可诊断性 + V3.3 导航预算 | 从 V3.1 选择性复制这两处小改动（正式价值） |
| V3.1 Change Package 文档（learnings/evidence-matrix） | **复用（参考）** | 实验依据与失败场景记录 | 引用到 V3.3 文档，不复制 |

## 明确拒绝进入正式产品的 V3.1 内容

- 整 branch merge（禁止）
- human-assisted CLI（终端交互 → 工作台 UI 替代）
- 批量采集循环（单页采集 + 人工确认流程替代）
- 一次性调试脚本
- SellerSprite 页面采集（未验证，只登记未来候选）
- 环境自动设置（US ZIP）——当前网络失败，正式产品改为 currency 显式提示 + 用户自查

## EXTENSION_NOT_REQUIRED（浏览器控制方式论证）

按任务书二十二"插件判断门"逐条论证：

| 判断门条件 | 结论 |
|---|---|
| 1. 普通用户无法通过现有 browser-control 完成体验？ | 现有 browser-control 是 CLI；**工作台 UI + API 封装后可完成**（不需要 Extension） |
| 2. 必须获取"用户当前已经打开的页面"？ | v1 采用"受控隔离浏览器自动导航到任务绑定 ASIN 单页"（不自动搜索/不批量）；用户日常浏览器 Extension 留未来候选 |
| 3. 扩展明显比本地 helper 简单？ | 否——Extension 需打包/安装/签名/权限审查，复杂度显著更高 |
| 4. 不需要敏感 cookie/token？ | 两边都不需要（受控浏览器零凭据） |
| 5. 权限可以最小？ | 本地 helper 零权限；Extension 至少 activeTab+scripting |
| 6. 不需要 background 大范围监控？ | 两边都不需要 |

**结论：EXTENSION_NOT_REQUIRED**——v1 用"工作台入口 + 本地受控浏览器会话"实现"当前页面 → 采集 → Preview → 保存"完整链，零新依赖、零高危权限。日常浏览器最小 Extension 登记为未来候选（触发条件：需要采集用户已登录/日常浏览器当前页且本地受控浏览器不可用时，单独评估）。
