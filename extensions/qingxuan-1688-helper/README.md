# Qingxuan 1688 Sourcing Helper（V3.5 正式版）

V3.5 图片获取正式驱动（No-Debugger）：普通 Chrome + 窄权限扩展 + Authenticated Loopback Bridge。

## 能力（固定，非通用浏览器 Agent）

| Action | 作用 |
|---|---|
| getState | 页面分类 + 上传入口 proof + 预览 proof + 结果页分类 |
| upload | 候选图注入（DataTransfer + files 原型 setter；Identity Proof） |
| submit | “搜索图片”触发（resolver v2 + composed 事件；Trigger Proof；No Double Submit） |
| collect | 结果卡片提取（data-renderkey offerId；§38 守卫拒绝推荐流） |

## 权限（最小化，§9）

- `permissions`: 空
- `host_permissions`: `https://s.1688.com/*`、`https://air.1688.com/*`
- 无 `debugger` / `cookies` / `history` / `downloads` / `<all_urls>` / `scripting`（静态 content_scripts 声明）

## 安装（用户一次性操作）

1. `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择本目录
2. 普通 Chrome 正常登录 1688（不读取/复制任何 Cookie）

## Bridge

- 服务端：`bridge/server.mjs`（127.0.0.1:53318；`--token <256bit>` 认证轻选客户端通道）
- 客户端：`lib/server/native1688BridgeClient.ts`（轻选服务端自动启动/管理 bridge 子进程）
- 扩展 SW 通道无 token（loopback + 128bit jobId + 一次性消费 + TTL）；已知偏差文档化，正式升级路径 = Native Messaging（DEFERRED）

## 安全

- 无任意命令 / 任意 JS / 任意 URL / 任意文件路径（§8/§12/§13）
- 图片仅来自轻选注册 job（taskId/candidateId/imageHash 绑定；MIME/大小限制；§13/§48）
- No Double Submit：submit 每 job 一次（phase 门禁 + nonce 去重；§31/§32）
- 日志不含 cookie/token/QR/路径（§34）
