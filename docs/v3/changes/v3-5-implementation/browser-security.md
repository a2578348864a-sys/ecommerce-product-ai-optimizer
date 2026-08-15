# V3.5 Implementation — Browser Security / Test Plan / Learnings

> 合同：§75-§80/§50；浏览器本地服务安全见 §76

## 1. Browser Security（§76/§77 落地检查）

| 项 | 状态 |
|---|---|
| 只监听 127.0.0.1（CDP remote-debugging-address） | ✅ `--remote-debugging-address=127.0.0.1` |
| 不监听 0.0.0.0 | ✅ |
| 无 arbitrary command | ✅ 驱动只发固定 CDP 方法；Runtime.evaluate 表达式为 resolver 内建常量 |
| 无 arbitrary URL | ✅ 页面域白名单 s.1688.com / air.1688.com / 1688.com |
| 无 arbitrary filesystem path | ✅ 上传仅已知 Candidate 图（SSRF+类型+大小校验）或用户选择 |
| 允许图片 temp 文件有界 + 清理 | ✅ mkdtemp + finally rm |
| 不复制 Cookie/Token，不读其他 profile | ✅ 专用持久 profile（用户首次登录后 session 由专用 profile 合法保留） |
| auth/nonce/session binding | ✅ Preview Store subjectKey+taskId；route 全链路 auth |
| 前台要求 | ✅ BROWSER_FOREGROUND_REQUIRED / UPLOAD_NOT_CONFIRMED |

## 2. CLI 安全（§12/§13/§25）

- allowlist 硬编码 + 参数校验（关键词长度/控制字符、offerId 数字白名单）+ `shell:false` + args array。
- 写命令（inquiry/cart/order/checkout/seller/inbox/...）业务层零代码路径；route 测试断言写命令名作为 action 全部 400。
- 输出大小限制（stdout 2MB / stderr 256KB）+ timeout + 进程 kill（SIGTERM→SIGKILL）+ 版本探测缓存。
- 敏感字段丢弃（receiveAddress/账号标识）+ trace 不含凭据。

## 3. Test Plan（已执行）

### 单测（V3.5 新增 97 用例全 PASS）
- normalize 16：字段映射/价格三语义/MOQ/Seller Claim 分类/平台元数据/PII 零泄漏/超限 fail-closed。
- entityBinding 15：单记录门禁/交叉验证/URL 白名单（SSRF 变体）。
- sourcingAcquisition 20：假 CLI 端到端（见 keyword-acquisition.md §5）。
- sourcingEvidence 12：保存/读回/幂等/未确认拒绝/候选不一致/stale storageVersion/Preview 绑定/过期/跨主体。
- sourcing route 14：search/url/detail/save 全链/未配置工具 503/预览过期 410/确认不一致/写命令名拒绝/Visitor B 隔离 404。
- image resolver 21：§63 fixture 矩阵（Wrong Upload/Wrong Click 全部 fail-closed）。
- UI 5：入口渲染/前台提示/禁止文案零出现/询盘问题确定性。

### 全量回归
- `npm test`：4740 passed / 79 skipped；2 failed 已定位（见 regression-review.md：release-package 缺 .next 构建产物=环境差异，baseline 通过；demoSandbox.store-consistency 单独跑通过=并发 flaky，baseline 同样单独通过）。
- `tsc --noEmit`：PASS。
- `npm run build`：见 build 结果（Phase 5）。
- lint：待跑。

## 4. Learnings（实现期实测）

1. **1688-cli 真实输出与文档差异**：search 顶层无 ok 信封（exit 0=成功）；image 是逗号分隔字符串；verified 是对象；location 是对象 → normalize 必须按实测结构防御式解析。
2. **daemon 风控暂停**：高频调用后 daemon 自动暂停（DAEMON_PAUSED / failureKind=risk_challenge，exit 9 + JSON 信封）→ driver 必须解析失败信封映射 risk_control_required（真实 smoke 发现的实现改进，已修 + 测试）。
3. **真实 smoke 与单元测试分离**：Spike 真实证据不能冒充新实现 smoke；本次实现代码真实 smoke 被外部风控暂停阻塞，如实记录 BLOCKED，不虚报。
4. **PowerShell 5.1 陷阱**：无 `&&`；`[id]` 目录需 -LiteralPath；Get-Content 默认 ANSI 读 UTF-8 会乱码（用 git show/node 验证）。
5. **vitest 约束**：include 只收 `*.test.ts`（组件测试用 .ts + createElement）；默认 5s test timeout 对真实 CLI（6-10s）不够，需显式 timeout。
6. **spawn 不传 env 时子进程用 process.env**：驱动测试注入 FAKE_CLI_MODE 必须显式传 env（曾导致 mode 分支全部失效的假阴性）。

## 5. 未覆盖/遗留

- Image 浏览器真实 smoke：需用户登录 profile + 前台窗口（MORNING_ACTION，见 real-smoke.md）。
- 图搜入口/按钮 invariant 的"当前真实页面重确认"：resolver v1 基于 Spike 实测，真实页面确认列入 morning smoke 第一步。
- AI Summary（Evidence-reliant 总结）本轮未接（避免扩大范围 + 付费调用）；询盘问题为确定性生成。
