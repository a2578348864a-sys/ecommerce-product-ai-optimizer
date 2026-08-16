# V3 Final Interaction & Research Navigation Correction — 安全审查

> 范围：R1 1688 登录 capability / R2 AI 动作收口 / R3 Decision 保存 / R4/R6 Studio resolver / R5 导航拆分 / R7 状态派生。

## 1. 1688 登录 capability（R1）
- 新增 `begin1688KeywordLogin()`：**fixed executable + 固定参数 ["login","--headed"]**；shell=false；detached；stdio=ignore；不捕获/不导出 cookie/token/password；login 会话由 CLI 自身管理；返回后由用户点「重新检测」（whoami）确认。
- **未开放 arbitrary CLI**：login 仍在 FORBIDDEN_COMMANDS；业务层唯一执行点是固定 capability（route 测试断言 "login" 原始 action 仍 invalid_action）。
- 扫码动作 MUST_BE_HUMAN（CLI 打开真实浏览器，用户手机扫码）。
- 无新增依赖；无 shell=true；无用户可传 executable/path。

## 2. AI 动作收口（R2）
- 删除顶部"AI 整理当前资料"链接（原 href 指向候选池——非 AI 动作的误导链接）。
- 唯一 AI Evidence Summary action 位于「AI 证据总结」区，POST 到 /api/tasks/[id]/ai-evidence-summary，**永不导航离开 Workbench**（无 redirect/router.push/Link 跳转）。

## 3. Decision 保存（R3）
- 新版：ProductResearchDecisionPanel 显式「保存新决定」（既有，未改）。
- 旧版：combobox 只改草稿（state），显式「保存旧版状态」按钮 PATCH decisionStatus；失败保留输入可重试；无自动写入（消除"改了不知道是否保存"的不确定交互）。

## 4. Studio resolver（R4/R6）
- `taskAccessible` 语义：任务不存在 / 跨 actor → **仍 404**（防枚举，不泄露存在性——保持既有 Micro-Gate 安全目标）。
- 同 actor 旧版任务 → 200 + gateReason=legacy_not_supported（Studio 显示"缺少新版创作资料，需要重新确认"）；不放松 Owner/Visitor 隔离（跨 actor 测试覆盖）。
- Studio 错误契约细分（legacy / decision_not_ready / blocked / record_not_found），用户文案准确、无 raw 技术串。

## 5. 导航拆分（R5）
- /research 与 /tasks 均为既有数据视图过滤（无新数据模型、无 DB 变更）；classifyResearchLifecycle 纯函数（可测）。
- highlight 用 URL from 参数（无状态泄漏）；不暴露内部状态名。

## 6. 状态派生（R7）
- deriveResearchMaterialStatus 只读 resultJson namespaces；不新增冗余持久字段；preview/AI 不参与判定；无写路径改动。

## 7. 结论
未引入新安全面；R4/R6 的 404 防枚举语义保持不变（taskAccessible=false 路径）；固定 capability 无 arbitrary 命令面；无 DB migration、无依赖变更。SECURITY=PASS。
