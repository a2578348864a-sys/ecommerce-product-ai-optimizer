# P6 — V4.1 UI 本地 Release Candidate（RC）报告

> 分支：feature/v4.1-ui-productization；基线 v4.0.1=f223494；本报告仅记录可验证事实；
> 未 push / 未 tag / 未部署（G7 授权边界）；公网正式复验标记为待授权阻塞项。

## 结论

- **本地 RC：PASS（Local Live + Public 语义等量验证）**
- 达到 V4.1 UI 产品化目标（首页/导航/Workflow/Replay 产品化 + 硬门禁 1-10 全部落地并有浏览器证据）；
- 公网（https://112.124.54.81）正式部署复验：**未完成（证据不足）——G7 发布授权未到**；已用相同构建 + public_showcase 模式在本地 3011 完成等量语义验证。

## SHA / 分支 / 发布状态

| 项 | 值 |
|---|---|
| baselineSha | f22349443d8921eda539a8c915061daa7c13a6fa（v4.0.1） |
| validatedCodeSha（本轮） | 42077438c3b7238957c1705f890ff12713bdb881 |
| branch | feature/v4.1-ui-productization |
| push / tag / deploy | 未执行（G7 边界；v4.0.0 / v4.0.1 tag 未动） |

## 修改（按页面/组件）

- 根 Shell：components/WorkspaceSidebar.tsx（buildV4NavGroups 双模式导航 + V4 概览 + 模式 Badge + 移动导航同源）、app/layout.tsx（V4 metadata）、app/api/runtime-mode/route.ts（+v4GraphEnabled 服务端权威 flag）；
- 首页：app/page.tsx（server 化：runtime+featured 注入）、components/v4/home/*（Hero/Workflow 7 阶段+三闸门/价值卡 4 张/FeaturedReplay 动态统计/Boundary/HomeGate 客户端分发）、components/v4/replay-featured.ts（只读 loader：parseBundle+verifyBundleHash+业务字段派生）、GuestLanding/HomeDashboardClient/LoginPage（V4 定位 + 金标演示降级历史演示 + 同一语义组件）；
- Runs：app/v4/runs*（标题/信息层级）、components/v4/{RunListTable 响应式卡片+下一步,V4RunStageNav 9 阶段+下一步推导,RunConsoleClient 权威状态+修复 review 两步 revision 竞态,RunConsoleView 阶段/证据来源/尚未生成诚实卡,api.ts RunSummary 加法扩展}；
- Replay：components/v4/replay-resolvers.ts（纯共享解析器单真源 + resolveReplayMetrics + 业务字段/阶段/证据）、ReplayView（摘要层/业务信息卡/研究链路/证据展开/74 步高级详情折叠）、app/replay/*（案例库概览/业务卡）、ReplayDemoChoicePanel（访客沙盒，服务端 cookie 门控）；
- 门禁 6/7 后端：app/api/replay/demo-choice/*（GET/POST/DELETE 整包表单，guest 白名单显式登记，ID 注入防护存储）、lib/v4/content/exportGuard.ts（资产级导出校验，content/review + resume 双路径封堵）；
- Graph/API/DB 业务逻辑：**未改动**（仅新增只读 helpers 与门禁校验；不重写后端，符合指令书 §四）。

## 验证（实际 exit code）

| 项 | 结果 |
|---|---|
| lint | exit 0（0 error / 8 warning，与基线持平） |
| typecheck | exit 0（tsc --noEmit） |
| 全量 npm test（最终） | **5842 passed / 0 failed / 78 skipped**（518 文件；期间 2 次并行负载 flake 均复跑通过） |
| build（受控窗口，多次） | exit 0（最后一次 04:23 构建，此后无代码变更） |
| 定向测试 | Replay 40、Metrics/realbundle、V4RunStageNav 7、RunList 5、Console 14、home 14、nav 审计 41+、panel 3、exportGuard 5、demo-choice 6 全绿 |

## 浏览器验收（真实浏览器 + 截图证据）

**本地 Local Live（3005，flag ON，桌面 1440 / 768 / 移动 390）**
- 首页：Evidence-first · Human-in-the-loop / V4 标题 / 副标题 / 诚实边界 / Local Live Badge / CTA（开始商品研究→/v4/runs + 查看研究任务）/ Workflow 7 阶段+三闸门 / 价值卡 / Featured Replay / 边界区 ✓（page-2026-08-21T20-02-16-246Z.png）
- Runs 列表：研究任务标题、卡片化（状态/下一步/节点/成本/更新时间/查看详情）、可恢复失败·需重试、等待人工 ✓（20-02-36-160Z.png）
- Run Console（内容审核 run）：阶段总览+下一步、证据来源、内容审核/商业/事实记录、无状态矛盾、终端期无“尚未生成” ✓（20-02-57-446Z.png）；
- 人工决定：通过并准备导出 → **中途发现 revision 竞态 409 → 修复（先取最新 revision 再 resume）→ 复验 run 完成 rev.31 + console 0** ✓（20-06-23-314Z.png）
- 390/768：无横向溢出、移动导航存在、Hero/Replay 渲染正常 ✓（20-06-50/20-07-04/20-09-12-982Z 快照）

**Public 语义（3011 = public_showcase + flag OFF 等量实例；同构建）**
- 首页：Public Replay · 只读脱敏案例 Badge、主 CTA 查看真实脱敏案例→/replay、无 Live CTA、无研究任务导航、金标降级“历史演示”、Evidence-first 小标签（修复后）✓（20-11-08-330Z.png）
- /replay 列表：案例库概览（动态统计）、业务字段卡、非 UUID 主标题 ✓（20-13-02-638Z.png）
- 详情：业务信息卡（关键词/市场/风险）、研究链路 8 阶段、证据来源（可展开）、高级详情折叠（74 步原始时间线保留）、Gate 5 / Guard 11 / hash 4826f635…/ 脱敏通过 ✓（20-13-29-467Z.png）
- 访客沙盒面板：匿名→“请先进入公开演示建立访客身份”（console 0）；建立身份 → ready → 保存（Gate A continue_sourcing / Gate B content_ready / 备注）→ **刷新保持** ✓（20-25-02-831Z.png）→ 重置清空 ✓
- console：全部 0 error / 0 warning；网络断言：仅 /api/replay/demo-choice + /api/runtime-mode + 静态/RSC——无 /api/v4/*、Owner、Browser、Amazon/1688、/api/tasks/*；cookie 唯一 __Host-lqx_guest（访客 12h）

- 证据目录：docs/v4.1/evidence/（before-* 基线 6 张）+ .playwright-cli/（20-0x… 验收 PNG/YML 多张）

## 硬门禁覆盖核对

1 ✅ 唯一 V4 主体验（金标降历史演示）；侧栏自然进 Runs/Replay；2 ✅ 统一阶段导航+下一步；3 ✅ 状态单源（终态权威/真实 facts/无伪 0 项/尚未生成卡）；4 ✅ 业务字段卡非 UUID、74 条折叠高级详情；5 ✅ Evidence 可展开真实字段；6 ✅ 沙盒面板（保存/刷新保持/重置/不修改母案例）；7 ✅ blocked 资产不可导出（exportGuard+resume 双守卫、单测+review 流程修复）；8 ✅ Public 无 Amazon/1688/Owner（网络断言）；9 ✅ 状态矩阵+失败恢复（重试链路）；10 ✅ 三档+键盘焦点/无溢出。

## 已知限制（如实）

- **公网正式部署复验：未完成（G7 授权缺口）**——当前公网仍为 v4.0.1 旧首页；授权后需 push/tag/deploy + 公网三档复验；
- 该同步书（G7）前不得向用户宣称“公网 V4.1 已发布”；
- Replay 案例的“候选名/关键词/链接/缩略图”在该真实 bundle 中为 null（诚实空态“未命名案例/未记录/无缩略图”）——源自运行数据的真实缺口，非造假，展示为诚实空态；
- 移动端详情页“研究链路”长文本在 390 下可读（已测无溢出），未做专项 aria live 断言（键盘可达为既有组件约定）；
- 共享工作区曾有并行 Agent 过程状态（B/C 报告中的“1 failed”均已闭口——根因各自树的中间态或负载 flake，最终全量 5842/0）。

## 发布停止点（G7）

- 未执行：push main、tag v4.1.0、部署 artifact、公网环境变更、（如授权）公网三档复验与 README/CHANGELOG V4.1 声明；
- ✅ 已执行到位的：本地实现+本地全量验证+本地与 public 语义浏览器验收+RC 文档。

