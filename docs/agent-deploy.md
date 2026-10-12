# BabyMemo Agent 部署 Runbook

本文供 Codex、Claude Code、Pi 等能运行终端的 Coding Agent 使用。目标是按可核查、可重复、尽量不破坏数据的方式完成 **BabyMemo → Cloudflare** 的验证和部署。GitHub Actions 路径见 [github-action-deploy.md](./github-action-deploy.md)。

> **首要原则：Agent 默认只检查、不主动触发发布。** 已获得一次性产品决策授权，将 `main` 的 CI 全绿与 Cloudflare 自动发布关联。Agent 可以读取仓库、检查配置与运行本地构建；除此自动路径外，仍须得到部署者明确授权才可手工创建资源、迁移远端数据库、发布 Worker、修改 Secrets 或绑定自定义域名。本文不会授权 Agent 触碰旧 MyBaby 生产环境。

## 0. 部署约束

- 目标技术栈固定：Node.js 22+、React/Vite、Hono/Cloudflare Workers、D1 `DB`、R2 `MEDIA`、Durable Object `BOT`（类 `WechatSession`）。
- AI 供应商仅使用 OpenRouter，通过 BabyMemo 网页设置 Key/模型；微信可选，使用 iLink，**不需要** VPS / OpenClaw。
- 先看 [`wrangler.jsonc`](../wrangler.jsonc)、[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)、[`package.json`](../package.json)、[`migrations/`](../migrations) 和本文件，**以当前代码为准**。
- 不准把密码、`SESSION_SECRET`、`DATA_KEY`、OpenRouter Key、微信授权 Token、Cookie 或日志中的敏感原文复制到聊天、PR、Issue、Git 仓库或命令行参数。
- 不得生成虚假的“部署成功”“扫码成功”“数据迁移成功”报告；任何一项未实测要写成**未验证**。
- 本仓库已获部署者授权启用「完整 CI 通过后自动发布 `main`」；Agent 不得绕过 CI 直接创建未经检查的生产发布。不得删除或重建现有 D1/R2，不得轮换现存的 `SESSION_SECRET` / `DATA_KEY`。GitHub 仍提供手动 Dry Run 和授权后的手动发布入口。
- 开始部署前核对最新 `main`、工作分支和 PR 状态；若已有其他 PR 合并，先整合代码并审查部署脚本冲突，禁止强推或跳过验证。
- 若部署者仅要求代码优化与文档，不调用任何可能操作生产 Cloudflare 资源的命令。

## 1. 本地仓库与质量检查（无远端写入）

```bash
git status --short
git branch --show-current
node --version
npm install --no-audit --no-fund
node --check scripts/provision-cloudflare.mjs
node --check scripts/smoke-check.mjs
npm run verify
```

`npm run verify` 目前依次执行 `npm run check`、`npm run test:unit` 与 `npm run build`，不等于端到端功能验收。保持 `node_modules/`、`dist/`、`.wrangler/` 和包含明文密钥的 `.dev.vars` 不进入 Git。

如果部署者允许读取 Cloudflare 资源，先检查当前账号：

```bash
npx wrangler whoami
npm run provision:remote -- --check
npm run deploy:dry-run
```

`provision:remote -- --check` 会访问 Cloudflare **只读检查远端资源**；若能找到同名 D1，也可能将其 `database_id` 写入**本地** `wrangler.jsonc`。因此执行前先确认工作区变更，执行后用 `git diff -- wrangler.jsonc` 审查，不要未经许可提交目标账号 ID。

如果云账号中尚没有 D1/R2，`--check` 失败是正常的。不能私自切换到会创建资源的模式。

## 2. Cloudflare 资源预检

实际部署前需确认：

| 绑定 / 路径 | 预期 |
| --- | --- |
| Worker 名称 | `babymemo` |
| D1 binding | `DB`，数据库名称 `babymemo` |
| R2 binding | `MEDIA`，bucket 名称 `babymemo-media` |
| Durable Object | `BOT` → `WechatSession`，`migrations` 中的 `v1` 为其注册 |
| 前端静态资源 | `assets.directory=./dist`，`/api/*` 优先走 Worker |
| API 路由 | `/api/health`、`/api/bootstrap/status` 等使用 Hono |

如果现有 D1 的 ID 与配置不符，脚本会拒绝继续。应停止并确认账号/目标环境，不得清空数据或随意修改 ID。部署在现有生产项目时先确认 D1/R2 备份与应用可恢复策略。

**得到明确的首次创建授权后**，执行以下幂等资源准备：

```bash
npm run provision:remote
```

这只负责 D1/R2；无须额外创建 Queue、Vectorize、Neon、VPS。脚本可能写回本地 `wrangler.jsonc` 的 `database_id`；务必核对环境。

## 3. 认证和密钥

正式运行必须有两个互不相同的 Worker Secret：

| Secret | 生成要求 | 操作警告 |
| --- | --- | --- |
| `SESSION_SECRET` | 随机值，至少 32 字符 | 改动会导致现有 Session 失效 |
| `DATA_KEY` | **64 位 hex 字符**（32 字节） | 改动会使既有加密 OpenRouter/微信凭据不可解密 |

密钥应由部署者在自己的终端或密码管理器生成、保存。只在被授权的终端以 Wrangler **交互式输入**写入 Worker：

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put DATA_KEY
```

首次发布前 Worker 可能尚不存在：此时**先完成 Worker 发布**，再执行以上命令。已有实例升级时复用原值，**不要自行重新生成**。密钥也可以事先写入 GitHub Secrets，之后让 Actions 在正式发布期间同步。Agent 不得要求用户在聊天中粘贴任何密钥。

可使用 `npx wrangler secret list` 核对 Secret **名称**，但无法安全读回 Secret 原值。`/api/bootstrap/status` 仅返回配置状态布尔值，不能证明明文是什么。

## 4. 获准后正式发布（有远端写入）

再次确认：目标 Cloudflare 账号、当前分支、数据备份、变更审核、生产授权。Agent 只运行下列有明确步骤的顺序：

```bash
# 1. 配置和数据库资源必须已存在；首次部署则先获准 provision。
npm run provision:remote -- --check

# 2. 本地构建并确认静态资源正常。
npm run verify

# 3. 先执行数据库 migration，再发布 Worker。
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy

# 4. 首次部署后，由部署者安全地配置两个 Worker Secret（见上节）。
# 5. 最后检查服务。
npm run smoke:check
```

**不要直接使用当前 `npm run deploy` 替代此流程**：它目前把 `wrangler deploy` 排在远端 D1 migration 前面，而 GitHub Actions 工作流与本 Runbook 使用“先 migration、后 publish”的顺序。

`smoke:check` 会使用 `BABYMEMO_PUBLIC_URL`（如果配置）作为目标站点；否则通过 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID` 查询当前账号的 workers.dev 子域。手动运行时可在**自己的终端**只为本次检查设置一个公开地址：

```bash
export BABYMEMO_PUBLIC_URL="https://baby.example.com"
npm run smoke:check
```

若只有 SSH/终端而没有 GitHub Secrets，部署者需在 Agent 运行检查前安全地完成 Worker Secret 配置。第一次部署后 `smoke:check` 失败可能仅表示 Secret 尚未配置；不要因此删除数据库。

## 5. 浏览器初始化与验收

首次安装由部署者亲自在 **HTTPS 首页 `/`** 的初始化界面完成，无需额外密钥。**公开空实例存在被抢先注册风险**，建议部署后立即完成初始化，或先通过 Cloudflare Access 限制访问；**不是** `/setup`。填写家庭管理员名称、至少 10 位的家庭密码、宝宝姓名、生日、性别、时区和可选过敏信息。

Agent 可以进行不携带秘密的只读 HTTP 检查：

```bash
curl -i https://baby.example.com/api/health
curl -i https://baby.example.com/api/bootstrap/status
curl -i https://baby.example.com/api/state
```

预期：`/api/health` 为 200 且 `ok=true`，`bootstrap/status` 中 `sessionConfigured`、`encryptionConfigured` 为 `true`；未登录时 `/api/state` 返回 `401 LOGIN_REQUIRED`。之后初始化、登录和私有数据 CRUD 必须通过部署者的浏览器人工验收。不要为了自动验收将家庭密码写入 curl、Shell History 或日志。

验收记录建议至少覆盖：家庭初始化、退出与重新登录、已有记录保留、宝宝切换、成长记录/里程碑 CRUD、图片上传/读取/删除、iPhone Safari 大图片与 MOV 上传、多分片网络失败、OpenRouter 模型测试、微信扫码/启停及 Durable Object 轮询状态。报告必须明确区分“脚本构建通过”“公开健康检查通过”和“真人/真实设备端到端验收通过”。

## 6. 故障处理与禁止性恢复操作

| 现象 | 处理 |
| --- | --- |
| `npm run provision:remote -- --check` 提示 Missing D1/R2 | 资源尚未创建；只在授权后使用不带 `--check` 的命令 |
| `wrangler` 提示账号不符或权限不足 | 运行 `npx wrangler whoami`，核对 Token 权限及 Cloudflare Account ID |
| `database_id` 冲突 | 停止部署，对照 Cloudflare Dashboard 确认真实数据库；禁止覆盖或删除 |
| `/api/health` 返回 503 | Worker 无法连接 D1 或表结构未准备好；检查绑定和迁移日志 |
| `/api/bootstrap/status` 返回密钥未配置 | 仅检查 Worker Secret 名称及工作流环境映射，不要求明文回读 |
| 登录失败但健康检查正常 | 检查初始化是否完成、管理员名称/密码、Cookie 作用域、同源 POST `Origin` |
| 切换到自定义域名后 `403 ORIGIN_REJECTED` | 浏览器 POST 请求的 `Origin` 必须和当前请求 origin 一致；不要直接取消同源校验 |
| R2 上传失败 | 检查 `MEDIA` 绑定、对象权限、分片大小与网络状况；MOV 转码目前不支持 |
| 微信一直未收到消息 | 检查网页内 iLink 绑定、`wechat_enabled` 状态、Bot 轮询错误和 OpenRouter 测试 |
| 发布后行为与预期不符 | 保留日志、优先前向修复。D1 迁移不会因为回滚 Worker 自动撤销；禁止直接清库 |

## 7. 交付报告

Agent 每次应向部署者交付：当前 Git commit/branch、是否修改工作树、Cloudflare 目标环境（不含凭据）、`npm run verify` 结果、Wrangler Dry Run 结果、D1/R2 资源核对、实际发布/密钥同步是否执行、`/api/health` 与 `/api/bootstrap/status` 结果，以及所有**尚未验证**的浏览器/手机/微信步骤。不要用 Cloudflare 发布成功来替代业务验收。

旧 **MyBaby → BabyMemo** 的 Neon、R2、Vercel 数据迁移、数据校验与切换不是这份 Runbook 的任务，必须单独设计只读导出、媒体复制、完整性校验和最终切换方案。
