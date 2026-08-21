# V4.1 本地 C 端工作台改造（本阶段交付报告）

> 范围：仅本地 Local UI（首页/研究记录/详情 + 调试页）；未改公网 / Replay / Visitor；未 push / tag / 部署。

## 结论

- **本地三页 C 端化完成**（首页工作台 / 研究记录列表 / 研究详情 + 独立调试页），真实浏览器 + 全量回归证据齐全；
- 公网 / Replay 未改动（本地导航移除案例回放，公网 Public 分支保留）；
- 等待视觉确认；未执行发布。

## 修改（相对上一阶段）

- 用户语言：components/v4/userLanguage.ts（Evidence→数据依据；Gate A→是否继续找货；Product Fact Gate→确认我的商品信息；Gate B→是否开始准备上架；Content Guard→内容检查；blocked→暂时不能使用；unknown→待补充；no_results→暂未获得数据；approve_export→确认使用；Replay→演示案例；状态/事件/图片检查/下一步文案映射）。
- 列表 API 只读富化：candidateLabel/keyword/marketplace/firstGap（多源回退，无→诚实空态）。
- 导航：本地 7 项（工作台/发现商品/待研究商品/商品研究/研究记录/Listing Studio/Image Studio）；移除本地 V4 概览/研究任务/案例回放（公网分支保留案例回放）。
- 首页：C 端工作台——开始商品研究 + 等待我确认/正在研究/失败待处理/最近完成（真实 runs 数据；无 Hero/技术卡；flag off→引导文案）。
- 研究记录：卡片（占位图+商品名/关键词/市场/状态/最重要缺口/下一步按钮）；内部字段收进「调试详情」折叠；主区无 UUID/rev/节点/成本；空态/加载/错误友好。
- 详情：六 Tab（研究结论/市场与评论/货源与商品信息/成本与风险/Listing与图片/操作记录）+ 五问（怎么样/为什么/确认了什么/还缺什么/下一步唯一主按钮）；操作记录仅用户事件；图片检查中文文案+blocked 大提示（无「已批准使用」）；原文 74 节点/事件/hash/枚举 → 独立调试页 app/v4/runs/[runId]/debug（不进导航）。
- 修复：DebugView 移出 page（Next 页契约）；RunConsoleClient 校验竞态与 images.checks 形状适配；exhaustive-deps；bridge 残留进程清理（环境）。

## 验证（实际执行）

| 项 | 结果 |
|---|---|
| lint | exit 0（0 error / 8 warning 基线） |
| typecheck | exit 0 |
| 全量 npm test（最终） | **5854 passed / 0 failed / 78 skipped**（520 文件） |
| build | exit 0（多次含修复后最终） |
| 浏览器 | 首/列/详三页 1440 + 390：无横向溢出；console/hydration 0；术语审计术语 0（Gate/Content Guard/approve_export/Evidence/blocked/identity_not_detected/rev. 等 0 命中）；状态一致性（completed+缺口→研究已结束，资料不足；图片 blocked→暂时不能使用+补充提示，无已批准使用） |

## 截图证据

- docs/v4.1/evidence/c-end/home-1440.png、list-1440.png、detail-listing-tab-1440.png、home-390.png、list-390.png、detail-390.png

## 已知限制（如实）

- 商品图片：runs 列表数据无图片 URL 来源 → 当前为占位块（首字）；如需要真实图需准备商品图片来源（后续可接候选链接图）。
- 商品名称/关键词在部分历史 run 中缺失（系统未存储）→ 显示「待补充商品名称/待补充」+ 下一步动作引导；已确认的系统级补齐动作（V3 研究记录/候选池入口）在「开始商品研究」主按钮路径。
- 候选项无独立「创建表单」→ 研究入口跳候选池（/opportunity-candidates）；本地 runs 列表无 UUID 主标题（已满足）。
- 公网正式复验仍未执行（此前记录 G7 授权项）。

## 停止点

- 等待用户视觉确认；未 push / tag / 部署；本地 3005 保持 V4 flag ON 供查看。

