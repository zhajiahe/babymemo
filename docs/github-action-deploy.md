# GitHub Actions 部署

权威执行入口：[`deploy.yml`](../.github/workflows/deploy.yml) / [Deploy BabyMemo to Cloudflare](https://github.com/zhajiahe/babymemo/actions/workflows/deploy.yml)。这里保留管理员必须了解的配置和风险，不复制工作流全部命令。

## 首次准备

1. Cloudflare 启用 Workers、D1、R2；创建最小权限的 [API Token](https://dash.cloudflare.com/profile/api-tokens)，取得 Account ID。
2. GitHub `Settings → Secrets and variables → Actions`（或 `production` Environment）设置：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`SESSION_SECRET`（至少 32 字符）、`DATA_KEY`（**64 位 hex**）。后两者分开生成、安全备份，绝不能随升级自动更换。
3. 可选 `OPENROUTER_API_KEY`：部署时注入 Worker Secret，**优先于**网页加密 Key。移除 GitHub Secret 并不会删除云端已有 Secret；如需撤销，应在 Cloudflare 控制台明确删除。
4. 可选 Variable `BABYMEMO_PUBLIC_URL`：仅指定 Smoke Check 的 HTTPS origin；先绑定并验证自定义域名。不要写入 Secret 值或 URL 路径。

## 手动执行

在 Actions 选择 `Deploy BabyMemo to Cloudflare → Run workflow`：

| 输入 | 默认 | 作用 |
| --- | --- | --- |
| `dry_run` | `true` | 只检查/构建，不迁移、发布或改 Secrets |
| `provision` | `true` | **正式运行时**按需创建缺失 D1/R2；自动发布不允许创建 |
| `preserve_runtime_secrets` | `true` | 保留线上核心 Secret；仅首次初始化且获授权后才改为 `false` |

新账号缺 D1/R2 时 Dry Run 提示缺资源是预期的；在确认账号后正式运行 `dry_run=false`、`provision=true`。工作流按 **核对资源 → 构建与单测 → `reconcile-birth-time` / D1 增量迁移 → `wrangler deploy --keep-vars` → Smoke Check** 的顺序执行。只在首次获授权的手动发布中同步必要的核心 Secrets；自动发布不轮换它们。

部署后在 HTTPS 首页初始化，检查 `/api/health`、`/api/bootstrap/status`、登录、宝宝切换、媒体读写与可选微信绑定。[初始化与日常使用](DEPLOY.md)。

## 自动发布边界

`deploy.yml` 只接受同一仓库 `main` 上 **push 触发且全部成功** 的 [Check BabyMemo](https://github.com/zhajiahe/babymemo/actions/workflows/ci.yml)；检查对应 SHA 是否仍是最新 `main`，防止旧版发布。PR、失败或取消的 CI 不发布。自动任务只验证现有资源、做增量迁移、部署 Worker 并健康检查；D1 迁移**没有自动回滚**。请关闭 Cloudflare Builds 等重复的自动部署入口。

**合并到 `main` 会触发真实生产变更**：合并前确认目标账号、备份、迁移兼容与影响范围；不能因失败就清空或重建 D1/R2。`npm run deploy` 会写远端，不属于 dry run。

## 排查

| 现象 | 检查 |
| --- | --- |
| 缺少 D1/R2 | 是否首次安装、`provision` 选项和账号权限 |
| D1 ID 或迁移冲突 | 校验实际库、已有迁移；`scripts/reconcile-birth-time.mjs` 仅在结构兼容时修复 0012 历史，不能乱改 schema |
| Worker API 502/503/504 或 429 | `scripts/deploy-worker-with-retry.sh` 仅重试发布阶段并核对 SHA；核对 [Cloudflare Status](https://www.cloudflarestatus.com/) 与 Actions 日志 |
| 缺 Secret / 登录 403 | 核对 Worker Secrets、HTTPS Cookie/Origin，不关闭 CSRF，也不为排错轮换 `DATA_KEY` |
| 微信不回复 | 检查绑定启用状态、iLink 轮询、Workers AI/可选 OpenRouter 配额和模型错误 |
| Smoke Check 无法访问 | 确认 HTTPS 域名已生效，或暂时改用可达的 workers.dev 地址 |

手动付费/真实模型工作流与发布工作流**相互独立**；使用方式见 [模型测试](ai-model-benchmark-and-quotas.md)。历史故障经过和执行证据直接查看 [Actions](https://github.com/zhajiahe/babymemo/actions)。
