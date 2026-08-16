# V3.5-R1 Formal Replacement — Proposal 与 Architecture

> 授权：2026-08-16 用户正式授权（V3.5-R1 No-Debugger Image Driver Formal Replacement）
> 基线：main == origin/main == 39120d9；分支 codex/v3-5-r1-formal-replacement
> 权威修订：`docs/v3/V3_5_PRE_IMPLEMENTATION_CONTRACT.md` §42（R1 Amendment）

## 1. 目标

替换被真实生产 smoke 反证的 CDP Image Driver（无限滑块 → BLOCKED_BY_RISK_CONTROL）为
**Native1688ExtensionDriver**（普通 Chrome + 窄权限扩展 + Authenticated Loopback Bridge）。
其余 V3.5（Keyword/Detail/Preview/Human Confirm/sourcing-evidence.v1）全部冻结不动。

## 2. 架构

```
ImageAcquisitionDriver
  ↓ Native1688ExtensionDriver（lib/server/sourcingImageAcquisition.ts）
  ↓ Authenticated Loopback Bridge（extensions/qingxuan-1688-helper/bridge/server.mjs；127.0.0.1:53318）
  ↓ Qingxuan 1688 Narrow Extension（content.js + service-worker.js）
  ↓ Normal Chrome（用户正常登录的当前会话；不读取/复制 Cookie）
  ↓ 1688 Native Image Search（s.1688.com 上传 → air.1688.com 结果页）
```

## 3. 安全设计

| 项 | 实现 |
|---|---|
| 无 debugger / 无 remote-debugging | manifest 无 debugger/cookies/all_urls；驱动路径零 CDP（§28 审计测试锁定） |
| Bridge 认证 | 轻选↔bridge：256bit `--token`（x-bridge-token header）；SW 通道：128bit jobId + 一次性消费 + TTL（偏差文档化，升级路径 Native Messaging DEFERRED） |
| 命令安全 | action allowlist（getState/upload/submit/collect/navigateUploadPage）+ typed/versioned 消息 + nonce 去重 |
| 自动导航 | 仅固定 URL（s.1688.com/selloffer/offer_search.html）；SW 验证导航生效、被页面拦截时新建 tab 兜底、preferredTabId 避免多 tab 错选；驱动侧导航后轮询确认上传页就绪（≤30s，≤2 次导航） |
| No Double Submit | bridge job.phase 门禁：submit 每 job 一次（重复 → duplicate_submit fail-closed） |
| 图片边界 | 仅轻选注册 job（taskId/candidateId/sha256 imageHash 绑定；MIME/大小限制）；不读取任意本机文件 |
| Upload Identity Proof | 预览 dataURL 长度 vs 本地 base64 长度（≤1% 容差）；不匹配 → fail-closed |
| Search Trigger Proof | result_page + imageId + resultsReady + 非推荐流（§38 守卫） |
| 错误语义 | extension_not_installed / extension_disconnected / auth_required / risk_control_required / page_identity_unknown / upload_not_confirmed / search_trigger_not_confirmed / image_results_insufficient |
| CDP 旧驱动 | LEGACY_DISABLED / DIAGNOSTIC_ONLY；NO_AUTOMATIC_FALLBACK_TO_CDP = TRUE |

## 4. 结果分级（Contract §42.6）

```
FULL PASS  → V3_5_IMAGE_ACQUISITION = APPROVED；V3.5 结项
PARTIAL    → SEMI_AUTOMATED_ONE_USER_CLICK；停止研究
FAIL       → NOT_ADOPTED；Image = Manual / Future Official API；停止浏览器研究
```

## 5. 实施清单（本分支 commits）

1. docs: amend v3.5 image acquisition contract（1e9d780）
2. feat: add no-debugger 1688 image extension + authenticated loopback bridge（8a9b688）
3. feat: replace v3.5 image acquisition driver（ce3a643）
4. test: validate no-debugger image acquisition（383c3f1）
5. test: extension source invariant audit（6cf3132）
6. （待）docs: close v3.5 image replacement
