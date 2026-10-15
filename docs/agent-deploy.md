# Agent 部署 Runbook

Agent 默认**只检查、不对云端写入**。`main` CI 成功后的自动发布是已有流程；除此之外，创建资源、迁移生产 D1、发布 Worker、变更 Secrets、恢复数据或自定义域名必须获得部署者明确授权。通用步骤见 [Actions 部署](github-action-deploy.md)，红线见 [AGENTS](../AGENTS.md)。

## 无远端写入的检查

1. 查看最新 `main`、开放 PR、当前分支和差异；核对 `wrangler.jsonc`、[工作流](../.github/workflows/deploy.yml)、[package.json](../package.json) 与 [迁移目录](../migrations)。
2. 运行 `npm run verify` 和相关本地 `npm run test:e2e`；不得用 `npm run deploy` 做检查。
3. 只在得到**读取 Cloudflare 账号**授权后，运行 `npm run provision:remote -- --check` 或 `npm run deploy:dry-run`。前者可能把远端 D1 ID 写入本地配置，必须检查 diff，不能意外提交。

## 获准后的发布

先确认账号、备份、权限和正在发布的 SHA。优先通过 GitHub Actions 明确选择正式运行；需要手动终端发布时，顺序为：

`npm run provision:remote -- --check` → `npm run verify` → `node scripts/reconcile-birth-time.mjs` → `npx wrangler d1 migrations apply DB --remote` → `npx wrangler deploy --keep-vars` → `npm run smoke:check`。

首次缺资源需要**额外授权**后才可执行 `npm run provision:remote`。核心 Worker Secrets 由部署者在安全终端或已授权 Actions 中配置；绝不能回显或从聊天获取真实值。已有实例的 `DATA_KEY` 不可轮换，也不得将其他项目的资源当作部署目标。

## 验收与报告

健康检查通过后，仍需由部署者独立验证 HTTPS 首页初始化、登录、宝宝隔离、媒体读写、真实 iPhone / 微信协议。`/api/bootstrap/status` 只表明 Secret 是否配置，并不验证其原值。失败时保留日志、前向修复；严禁删除数据库或将 Worker 版本回退误当成 D1 回滚。

报告必须区分 **代码提交 / CI / main 合并 / 线上发布 / 真机验收**，逐项写明证据和未做部分。
