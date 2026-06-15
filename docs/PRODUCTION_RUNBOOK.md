# 生产环境运维记录

## 当前生产地址

- 公网地址：[http://112.124.54.81](http://112.124.54.81/)
- 服务端口：`3005`

## 推荐连接方式

后续默认通过阿里云控制台进入服务器：

```text
阿里云控制台 -> Workbench -> root 网页终端
```

当前本地 SSH 暂不可用，报错为：

```text
Permission denied (publickey)
```

后续暂不优先处理本地 SSH 登录问题，服务器操作优先使用 Workbench 网页终端。

## 服务器信息

- 登录用户：`root`
- 公网 IP：`112.124.54.81`
- 项目目录：`/www/alibaba-ai-assistant`
- PM2 服务名：`alibaba-ai-assistant`

注意：

- 项目目录来自历史部署记录，进入服务器后仍需用 `pwd` 和 `git status -sb` 再确认。
- PM2 服务名来自历史日志和当前运行信息，后续部署前仍需用 `pm2 status` 再确认。

## 标准部署流程

在阿里云 Workbench 网页终端中执行：

```bash
cd /www/alibaba-ai-assistant
pwd
git branch --show-current
git status -sb
git log --oneline -3
git fetch origin main
git pull --ff-only origin main
git log --oneline -3
git status -sb
npm run build
pm2 restart alibaba-ai-assistant
pm2 status
curl -s http://127.0.0.1:3005/api/health
curl -s http://112.124.54.81/api/health
```

说明：

- 如果 `git status -sb` 显示工作区不干净，先停止部署并排查，不要强行覆盖。
- 本项目部署时不要打印 `.env.local` 内容。
- 本次没有 schema/migration 变化时，默认不执行数据库迁移。
- 如果未来确实有 Prisma schema 或 migration 变化，再按当次部署要求执行 `npx prisma generate` 和 `npx prisma migrate deploy`。

## 线上验收清单

部署后至少检查：

```bash
curl -I http://112.124.54.81/
curl -I http://112.124.54.81/viral
curl -I http://112.124.54.81/tasks
curl -s http://112.124.54.81/api/health
```

页面验收：

- `/`
- `/viral`
- `/tasks`
- `/api/health`
- 任务闭环：保存 -> 列表 -> 详情 -> 删除

任务闭环测试建议：

1. 在 `/viral` 输入唯一测试内容，例如 `DEPLOY_TEST_STEP_时间戳`。
2. 只点击“生成模拟拆解”，不要点击真实 AI 按钮。
3. 保存到任务记录。
4. 进入 `/tasks`，找到本轮测试记录。
5. 点击“查看详情”，确认 `/tasks/[id]` 可打开。
6. 确认详情页有完整内容或 JSON。
7. 只删除本轮新建的测试记录。
8. 返回 `/tasks`，确认测试记录不再显示。

## 安全注意事项

- 不要在日志里输出密钥。
- 不要 `cat .env.local`。
- 不要截图暴露密钥、密码、token。
- 不要直接删除生产数据库。
- 测试删除只能删除本轮新建的测试记录。
- 不要调用真实 AI 接口做普通部署验收。
- 不要在未确认工作区状态时执行覆盖性 Git 操作。

## 当前结论

第76步公网验收通过，线上已经包含任务详情页和删除闭环。

已验证结果：

- `/` 返回 `200`
- `/viral` 返回 `200`
- `/tasks` 返回 `200`
- `/api/health` 返回 `{"ok":true}`
- 任务闭环“保存 -> 列表 -> 详情 -> 删除”已跑通

仍需注意：

- 由于本地 SSH 无可用私钥，服务器内 `git log`、`pm2 status`、`pm2 logs` 默认通过阿里云 Workbench 网页终端确认。
- 后续部署记录应继续写明提交号、构建结果、PM2 状态和公网验收结果。
