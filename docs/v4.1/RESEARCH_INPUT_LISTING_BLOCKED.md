# RESEARCH_INPUT_LISTING BLOCKED（第 3 轮）

无。

## 曾被排除的候选（不属于缺陷，不改）
- 「模板太重复」「门禁太严」：均为误判。第1/2轮模板句确实违反冻结 Claim Evidence 允许词表（unclassified_factual_claim），属组合层缺陷（已修），非门禁阈值问题；阈值/Resolver 全程零改动。
- 「3029 出旧句 = bundle 脏」：初判错误。真实原因是组合层模板未过冻结门禁导致 Stage B 422，页面只显示旧快照；clean rebuild 后已用活体 POST + bundle 字符串证据（新帧 1 旧帧 0）确认。
- 「Provider 关闭即不可生成」：英文 run-on 误判（Vacuum Insulated）与 CJK 事实按渲染器自档契约逐事实 fail-closed 降级；外部 Provider 调用 0（baseURL=本机死端口 + key 清空，两重保险）。
