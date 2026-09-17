# V3.5 Implementation — Image Acquisition（Phase 3）

> 合同：§31-§41/§62-§64；架构裁决见 architecture-decision.md（Option A′）

## 1. 正式能力边界

```
FULLY_AUTOMATED_IN_ACTIVE_FOREGROUND_BROWSER_SESSION
```
- 不实现、不宣传 background autonomous crawler。
- 浏览器窗口非前台 → 上传/点击不响应 → fail-closed（`BROWSER_FOREGROUND_REQUIRED` 或 `UPLOAD_NOT_CONFIRMED`）。
- 图搜结果 = Candidate Discovery（Search Result），不自动成为 Evidence。

## 2. 实现（tools/collectors/1688/）

| 模块 | 职责 |
|---|---|
| image-search-contract.ts | 页面状态机 / Proof 类型 / 结果卡片 / trace（含 resolver 版本常量） |
| image-search-resolver.ts | 版本化 resolver：`native-image-upload-resolver.v1` / `native-image-submit-resolver.v1` / `native-image-result-extractor.v1`；DOM 表达式 + 报告解析纯函数 |
| browser-session.ts | 1688 专用**持久 profile**（env `V35_1688_BROWSER_PROFILE`，默认 `%USERPROFILE%/.qingxuan/1688-browser-profile`）+ loopback CDP（attach 现有实例或启动新实例）+ 前台窗口 |
| image-search-driver.ts | 编排：导航 → Upload Proof → focus+Enter → Native File Chooser（拦截）→ setFileInputFiles → Upload State Proof（Candidate Identity：预览 dataURL 长度匹配）→ Submit Proof（class 扫描 + elementFromPoint + 点击前实时重证明）→ CDP 鼠标点击 → 结果页证明（imageId + 非 fallback）→ 卡片提取 → trace |

## 3. 关键门禁（Wrong Upload = 0 / Wrong Click = 0）

- **UPLOAD_TARGET_PROOF**：page=正确图搜页（s.1688.com）+ target=唯一 file input `input#img-search-upload` + visible/enabled/box valid + **坐标来自 live geometry**（禁止固定坐标）。
- **UPLOAD_STATE_PROOF**：预览 dataURL 出现且 base64 长度与本地候选图一致（spike A.3 实测精确一致）→ Candidate Identity Proof；不一致 → `upload_not_confirmed`（Wrong Upload 门禁）。
- **布局重试**：紧凑布局（input y<50 顶部死区）→ 重开页面（≤3 次）。
- **SUBMIT_TARGET_PROOF**：`search-btn` class（递归穿透 shadow root）+ elementFromPoint 命中 + 文本"搜索图片" + unique + 点击前**实时重新扫描**（stale 防护）→ CDP mouseMoved/Pressed/Released。
- **结果页证明（§38）**：跳转 `air.1688.com?tab=imageSearch&imageId=<id>` + 无推荐流标记才视为 Native 结果；否则 `fallback_recommendation` → fail-closed（未点搜索=默认推荐，已作为对照验证）。
- **卡片校验**：offerId 合法 + 唯一 + 同卡片绑定（entityBound）+ 上限 60；跨卡片拼字段风险 → `entity_binding_failed`。

## 4. Upload 正式语义（§33）

```
UPLOAD_TRIGGER = FOCUSED_FILE_INPUT + CDP_KEYBOARD_INPUT（与用户 Tab+Enter 等价）
FILE_CHOOSER = NATIVE_BROWSER_FILE_CHOOSER（Page.setInterceptFileChooserDialog + fileChooserOpened）
FILE_SELECTION = CDP_FILE_INPUT_HANDOFF（DOM.setFileInputFiles，backendNodeId 来自事件）
UPLOAD_RESULT = REAL_1688_UPLOAD_STATE_CONFIRMED（预览图 + Candidate Identity Proof）
```
代码/文档不声称"等同真人事件"。

## 5. 业务门面（lib/server/sourcingImageAcquisition.ts）

- 图片仅来自已知 Candidate image（URL 必须 https + SSRF 公网校验 + 类型/大小限制 ≤30MB）或用户明确选择。
- 下载到临时目录（有界），驱动完成后清理；Web 请求不能任意读取本机文件。
- 错误归一化：`browser_not_ready` / `browser_foreground_required` / `upload_target_not_found` / `upload_not_confirmed` / `search_trigger_not_confirmed` / `entity_binding_failed` / `timeout`。

## 6. 限速与取消（§41）

- 单次总超时 120s；每步超时（导航 20s / 上传确认 15s / 结果 30s）；操作间 cooldown 1s；最多 60 卡片；AbortSignal 取消支持。
- 不做 background crawling；高频操作可能触发 1688 风控 → 如实返回 `risk_control_required`，人工处理后继续。

## 7. 测试

resolver 层 21 个 fixture/replay 用例（§63 矩阵子集）：表达式可编译 / Upload Proof（缺失/重复/错误页 fail-closed）/ Submit Proof（缺失/重复/坐标缺失 fail-closed）/ Upload State（确认/未确认）/ 结果页分类（native vs fallback）/ 卡片解析（非法 offerId/缺 title 丢弃、重复 offerId/超限/空校验抛错）/ URL 白名单。真实浏览器 smoke 见 real-smoke.md（BLOCKED_BY_USER_ACTION：需登录 profile + 前台窗口 + 首次上传激活验证）。
