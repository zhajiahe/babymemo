# 部署与初始化

面向自托管管理员；具体工作流选项与 Secrets 以 [GitHub Actions 部署](github-action-deploy.md) 为准，Agent 远端操作见 [Agent Runbook](agent-deploy.md)。

## 部署方式

- [Cloudflare 一键部署](https://deploy.workers.cloudflare.com/?url=https://github.com/zhajiahe/babymemo)：按提示准备 Workers / D1 / R2。
- [GitHub Actions](github-action-deploy.md)：首次手动运行，`dry_run=false` 且按需 `provision=true`；以后 `main` 全部 CI 成功后自动发布现有资源。

绑定为 D1 `DB`（`babymemo`）、私有 R2 `MEDIA`（`babymemo-media`）、Durable Object `BOT`（`WechatSession`）。已有实例**不得删除、重建资源或轮换加密密钥**。

## 首次配置

在 Cloudflare Worker Secrets 安全配置：

| Secret | 要求 |
| --- | --- |
| `SESSION_SECRET` | 至少 32 字符，稳定保存 |
| `DATA_KEY` | 独立随机的 **64 位 hex**，稳定保存 |
| `OPENROUTER_API_KEY` | 可选；默认 Workers AI 不需要 |

前两项可分别在私有终端运行 `openssl rand -hex 32` 生成。若 GitHub Actions 管理 OpenRouter Key，部署 Secret 优先于网页加密保存的 Key；撤销必须到 Cloudflare 明确删除，详见 [Actions](github-action-deploy.md)。

部署完成后立即在 HTTPS **首页 /** 初始化家庭、管理员及首位宝宝（密码至少 6 位）。空实例无额外初始化密钥，公开前建议 Cloudflare Access 防抢注。

## 升级与检查

先核对生产账号、备份和向前兼容迁移，再走 CI → 自动部署。发布顺序为资源检查、迁移历史核对、增量 D1 migration、Worker 发布、健康检查。不可把部署回退当作 D1 回滚。

验证 `/api/health`、`/api/bootstrap/status`，再人工检查登录、宝宝隔离、相册/视频和微信状态；浏览器编解码兼容性需要真机测试。遇到迁移冲突、登录错误或微信无回复，查看 [Actions 故障排查](github-action-deploy.md) 与 [QA 边界](qa-regression-matrix.md)，不要重建数据库。

生产灾备见 [备份手册](BACKUP.md)。
