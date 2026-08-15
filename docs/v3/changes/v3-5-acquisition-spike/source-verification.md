# V3.5-A — Source Verification（事实来源纪律）

> 任务书七节：技术事实优先级。本 Spike 全部结论的取证来源登记。

## 1. 取证来源（按优先级）

| 来源层级 | 本轮使用 | 用途 |
|---|---|---|
| 1. 当前官方源码 | ✅ TEMP 浅克隆审阅：`1688-product-find`（_auth.py/_http.py/_const.py/SKILL.md/configure.md）、`1688-source-suppliers`、`1688-cli`（package.json/postinstall.mjs/SAFETY.md/session/*）、`OpenCLI`（clis/1688/*、extension/manifest.json、extension/src/*、docs/adapters/browser/1688.md） | 认证模型/endpoint/schema/权限/登录模型 |
| 2. 官方 README | ✅ 各仓 README/中文 README | 能力声明/边界 |
| 3. 官方 docs | ✅ OpenCLI docs/adapters/browser/1688.md、1688-cli docs/SAFETY.md/JSON_CONTRACTS.md | 命令契约/登录/风控 |
| 4. Release/commit history | ✅ gh API（created/updated/archived/license/stars） | 维护状态 |
| 5. 实际运行结果 | ❌ 本轮未运行（用户选择先静态审计）→ 全部标 NOT_TESTED | 实测项 |
| 6. Issue/Discussion | ❌ 未采信（不用于判定能力） | — |
| 7. 第三方资料 | ⚠️ 仅背景（web_search 的开放平台指南）；未用于能力判定 | — |

## 2. 禁止采信的判定

- GitHub Star ≠ 能力（已分层：PROJECT_EXISTS/MAINTAINED/…/FIT_FOR_V3_5）
- 旧博客/搜索摘要 ≠ 事实（能力判定一律源码级）
- "README 声称支持" ≠ 可用（image search 等标 ⏳ 待实测）

## 3. 已知未验证项（如实登记）

- AK 获取的真实门槛（clawhub 流程是否个人账号可完成）——需用户实测
- 三 Route 的 search/detail/image 实际输出质量——NOT_TESTED
- OpenCLI Extension 安装与 bind 稳定性——NOT_TESTED
- 1688-cli 扫码登录与 session 持久性——NOT_TESTED
- 海外 IP 下的风控表现——NOT_TESTED（此前 probe 已证匿名会话登录墙）
