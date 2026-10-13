# BabyMemo 部署与初始化

面向自托管管理员。这里介绍**该做什么**；GitHub Actions 的逐步命令、参数和发布门禁以 [GitHub Actions 部署指南](github-action-deploy.md) 为准，Agent 操作规范以 [Agent Runbook](agent-deploy.md) 为准。

## 1. 选择部署方式

| 方式 | 首次创建资源 | 后续更新 |
| --- | --- | --- |
| [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/zhajiahe/babymemo) | Wrangler 自动准备同名 D1、R2、Durable Object | 可继续使用 Cloudflare 构建 |
| [GitHub Actions](github-action-deploy.md) | 手动 `dry_run=false`、`provision=true`，会显式创建缺失资源 | `main` 通过 CI 后自动发布（默认只验证资源） |

Cloudflare 绑定：D1 `DB`（数据库名 `babymemo`）；R2 `MEDIA`（bucket 名 `babymemo-media`）；Durable Object `BOT`（`WechatSession`）。**禁止为排除迁移故障而清空或重建线上 D1/R2。**

部署前先确认目标账号与备份；部署期间的数据库迁移不是可自动回滚操作。

## 2. 配置密钥

Cloudflare → Workers & Pages → `babymemo` → Settings → Variables and Secrets：

| 名称 | 是否必需 | 要求 |
| --- | --- | --- |
| `SESSION_SECRET` | 是 | 最少 32 字符；会话签名，长期不更换 |
| `DATA_KEY` | 是 | 独立的 64 位十六进制随机值；解密已有 D1 凭据 |
| `OPENROUTER_API_KEY` | 否 | 以 `sk-or-` 开头；微信自然语言工具路由使用 |

前两个密钥可以在安全终端各运行一次 `openssl rand -hex 32` 生成；后续升级需复用原值，不要重新生成。

如果使用 **GitHub Actions**，管理员可以把 `OPENROUTER_API_KEY` 配置为仓库或 `production` Environment Secret，再正式部署。Worker 会优先使用这个 Key。也可以部署后在网页「设置 → 微信操作引擎 · OpenRouter」配置 Key（加密保存于 D1）。两种路径的优先级和撤销方法见 [GitHub Actions 指南](github-action-deploy.md)。

## 3. 首次初始化

部署成功且 Worker Secrets 配置好后，访问 Worker 的 HTTPS 首页 `/`，填写家庭名称、管理员登录名、**至少 6 位**家庭密码，以及第一位宝宝姓名、出生日期、性别、时区。出生时间、过敏信息可后续补充。

初始化**没有独立密钥**。尚未注册的公开站点可被其他人抢先初始化：应及时注册，或预先使用 Cloudflare Access 限制公开访问。

初始化后可在「设置 → 宝宝资料」新增第二个宝宝，无需另建家庭账号。

## 4. 使用与检查

- 登录后分别测试宝宝切换、成长记录、成长瞬间和回收站的创建、查看、删除与恢复。
- 测试一张图片和一段视频的私密上传与下载。网页单文件上限 200 MB；微信消息附件单文件上限 50 MiB。Safari HEIC、MOV/HEVC 的可播放性取决于设备解码器，**当前没有自动转码**。
- 如需微信操作，配置 OpenRouter 模型 ID，测试连接，再通过「设置 → 微信操作」扫码绑定 iLink Bot，之后手动启用。
- 如需自定义域名，先在 Cloudflare Workers 绑定并确认 HTTPS 可用，再在 GitHub Variables 配置用于 Smoke Check 的 `BABYMEMO_PUBLIC_URL`。**不要因为更换域名就轮换会话或加密密钥。**

## 5. 已有实例升级

`main` 提交完成 CI 后会自动触发发布工作流：确认最新提交 → 检查 D1/R2 → 验证 D1 迁移历史 → 应用未执行的迁移 → 发布 Worker 并保留原有密钥 → 健康检查。

针对曾出现的 `duplicate column name: birth_time`，部署脚本 `scripts/reconcile-birth-time.mjs` 只有在列已经存在且 `TEXT NOT NULL DEFAULT ''`、上一条迁移记录已存在时才补记 `0012_birth_time.sql`。**修复的是迁移历史，不删除或修改宝宝资料**。其他不符合预期的数据库差异会停止部署，需人工诊断。

只有确认备份可用且知道生产账号时，才运行正式部署。建议先运行 GitHub Actions 的 `dry_run=true`，后续要手工发布再显式选择 `dry_run=false`。

## 6. 故障排查入口

| 症状 | 优先排查 |
| --- | --- |
| 部署报 D1、R2 不存在 | 首次创建与非首次自动发布模式不同；参考 [GitHub Actions 指南](github-action-deploy.md) |
| 迁移报重复列 | 确认 D1 指向正确的生产数据库；查看 `reconcile-birth-time` 的安全校验结果 |
| 初始化无法完成 | `/api/health` 和 `/api/bootstrap/status`，以及两项必需 Worker Secrets |
| 登录失效或 403 Origin | HTTPS 域名、Cookie 域隔离、同源 POST；不要关闭 CSRF 验证 |
| 微信 Bot 不回复 | OpenRouter Key/余额/工具调用支持、iLink 授权、默认宝宝和 Bot 状态 |
| 视频在 iPhone 无法播放 | 浏览器支持的 MIME/编解码格式；上传成功不代表转码成功 |

生产数据需按 [备份与恢复手册](BACKUP.md) 独立保管；MyBaby 旧数据迁移另见 [迁移计划](MIGRATION.md)。
