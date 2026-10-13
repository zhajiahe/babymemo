# 通过 GitHub Actions 部署 BabyMemo

本文适用于自己的 `zhajiahe/babymemo` 仓库。工作流位于 [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)，显示名称为 **Deploy BabyMemo to Cloudflare**。支持两种发布方式：**`main` 的完整 CI（包括本地 Worker E2E 和 Chromium 浏览器 E2E）通过后自动发布**，或在 Actions 里手动点击 **Run workflow**（默认 Dry Run，不修改生产）。PR 检查不会触发发布。

BabyMemo 运行于 Cloudflare Workers + D1 + R2 + Durable Objects，前端 React/Vite、服务端 Hono；无需 VPS。首次初始化使用家庭管理员名称和密码。AI 仅使用网页内配置的 OpenRouter；微信 Bot 为可选的 iLink 集成。

> **生产变更已通过启用自动发布得到部署者授权。** 合并到 `main` 且 CI 全部通过，会自动迁移远端 D1 并发布 Worker；请在合并前确认数据库备份、目标账号及影响范围。手动 Dry Run 仍只检查，不发布，但会读取目标账号的 D1/R2。MyBaby 旧站的 Neon / Vercel / R2 不会被本工作流迁移，切勿把新空数据库当作旧站数据。

## 1. Cloudflare 与 GitHub 准备

1. 在 Cloudflare Dashboard 开通 **Workers**、**D1** 和 **R2**，确认当前账号的 `*.workers.dev` 子域可用。Durable Object 类 `WechatSession` 在部署时由 Wrangler migration 注册。
2. 在 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 创建限定到目标账号的 Token。需具备 Workers Scripts 编辑、D1 编辑、Workers R2 Storage 编辑所需权限；部分账号还需允许读取 Workers 子域信息。授予实际所需的最小权限即可。
3. 在 Cloudflare Dashboard 获取 **Account ID**。
4. 在 GitHub 仓库 `Settings → Actions → General` 启用 Actions；本工作流仅需 `contents: read`。
5. 进入 `Settings → Secrets and variables → Actions`。由于部署 job 使用了 `environment: production`，密钥也可以保存在同名 GitHub Environment 中，前提是该环境允许工作流访问。

## 2. 设置 Secrets 和可选 Variable

先在**自己的安全终端**分别执行两次（每次产生一个新值），立即保存到密码管理器：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

在 GitHub Actions **Secrets** 中创建下列条目：

| 名称 | 用途 | 要求 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API 权限 | 限定目标账号 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID | 必填 |
| `SESSION_SECRET` | 家庭登录 Cookie 签名 | 至少 32 字符，保持稳定 |
| `DATA_KEY` | 加密 OpenRouter / 微信凭据 | **恰好 64 位十六进制字符**，保持稳定 |
| `OPENROUTER_API_KEY` | 可选：部署时统一配置微信指令模型的 OpenRouter Key | 以 `sk-or-` 开头，不写入源码或 D1 |

**重要：** 设置 `OPENROUTER_API_KEY` 后，下一次正式部署会把它作为 Cloudflare Worker Secret 写入，并优先于网页中原先加密保存的 Key。若部署 Secret 生效，网页只能修改模型 ID；要换 Key 请更新 GitHub Secret 后重新部署。若 GitHub Secret 缺失，部署会保留既有 Worker Secret 和原先的 D1 设置；**清空 GitHub Secret 不会撤销已经部署的 Worker Secret**，需要到 Cloudflare 控制台明确删除。

**不可将密钥写进** workflow 文件、提交记录、Issue、PR、聊天、`workflow_dispatch` 的表单输入或浏览器地址。GitHub Secret 保存后不会回显原值。`SESSION_SECRET` 变化会令既有会话失效；`DATA_KEY` 变化会使已经保存的 OpenRouter 和微信凭据无法解密，**升级时必须复用旧值**。首次初始化已无需独立密钥。已配置在旧 Worker 中的初始化密钥不再使用，也不会自动删除。新实例应立即注册管理员，或先使用 Cloudflare Access 限制访问。

可在 GitHub Actions **Variables**（不是 Secret）中设定：

```text
BABYMEMO_PUBLIC_URL=https://baby.example.com
```

这里只能填写 HTTPS **origin**，不要附加路径、查询参数或尾随其他字符。先在 Cloudflare Worker 中实际绑定并确认域名正常，再使用它。该变量**只供发布后的健康检查使用**，不是鉴权域名或 Cookie 的配置。留空时检查脚本会尝试通过 Cloudflare API 获取账号子域，并检查 `https://babymemo.<workers.dev-子域>.workers.dev`。

## 3. 第一次部署

打开仓库 `Actions → Deploy BabyMemo to Cloudflare → Run workflow`。

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `dry_run` | `true` | 只读核对已有远端 D1/R2、类型检查、构建、`wrangler deploy --dry-run`；不迁移、不发布、不同步 Secrets |
| `provision` | `true` | 仅在正式运行且 `dry_run=false` 时创建缺失的 D1、R2；已存在同名资源则复用 |

**第一次账号还没有 D1 / R2 资源时，默认 Dry Run 会报“Missing D1/R2”，这是预期现象。** 可先通过 Cloudflare 控制台创建同名资源后重新试跑 Dry Run；也可以在明确选择正确账号后，将 `dry_run=false` 且 `provision=true` 运行首次正式部署。

正式运行按下列顺序执行：

1. 检查 Cloudflare Token、Account ID 是否存在。
2. `npm run provision:remote`：根据 [`wrangler.jsonc`](../wrangler.jsonc) 查找或创建 D1 `babymemo`、R2 `babymemo-media`，并将解析出的 `database_id` 写入**本次 Actions 工作目录**，不会回写 GitHub。
3. `npm run verify`：执行 TypeScript 检查、单元测试与 Vite 构建。
4. `node scripts/reconcile-birth-time.mjs` 先只读检查 `babies.birth_time` 与 D1 迁移历史：仅当字段已经存在、满足文本类型兼容性（允许历史可空定义）、且前置迁移已记录时，补记 `0012_birth_time.sql`；绝不重建字段或删除数据。然后 `npx wrangler d1 migrations apply DB --remote` 继续运行真正尚未执行的迁移。
5. `npx wrangler deploy --keep-vars`：发布 Worker、静态资源以及 `WechatSession` Durable Object 绑定，并保留控制台变量。若 GitHub Actions 已配置 `OPENROUTER_API_KEY`，则通过临时 0600 权限 JSON 文件与 `--secrets-file` 在同一次发布中写入 Worker Secret；文件执行后删除，日志不打印密钥。
6. **仅手动正式发布**：验证并同步 GitHub Secrets 中的 `SESSION_SECRET`、`DATA_KEY` 到 Worker。**CI 自动发布绝不重新写入这两项密钥**，保持 Cloudflare Worker 中既有值；必须确保首次安装时已经通过手动发布或控制台配置好密钥。
7. `npm run smoke:check`：检查 `/api/health`（包含 D1 可用性）和 `/api/bootstrap/status`（只验证两项 Secret 是否配置，不泄露其值）。

**重要：** 当前仓库的 `npm run deploy` 脚本与上述工作流的顺序不同（先发布，再迁移）。生产环境建议使用此工作流，或严格按 [Agent Runbook](./agent-deploy.md) 给出的迁移优先顺序逐条执行。

## 4. 第一次初始化

正式工作流通过后，打开部署后的 Worker 首页（`/`）；BabyMemo 会根据 `GET /api/bootstrap/status` 自动显示初始化表单，**没有单独的 `/setup` 路由**。

在浏览器 HTTPS 页面中填写：家庭管理员名称、家庭登录密码（至少 10 位）、宝宝名字、出生日期、性别和家庭时区；过敏信息可选。完成后进入家庭空间。

**注意：** 公开的新实例在初始化前可能被其他访客抢先注册管理员；请立即完成，或提前使用 Cloudflare Access 限制访问。

再按以下顺序手工验证：

1. 退出并以家庭管理员名称、密码重新登录。
2. 新增、查看、删除一条测试成长记录；确认只在当前宝宝下显示。
3. 上传一张照片，在手机浏览器打开相册并确认可读取；再测试视频和弱网络上传。
4. OpenRouter Key 二选一：推荐管理员预先设置 GitHub Actions Secret `OPENROUTER_API_KEY` 再运行正式发布（页面会显示「部署 Secret 管理」）；或部署后在网页设置中填写 Key（加密保存在 D1）。填写模型 ID 后点击连接测试。不要把 Key 写入工作流输入框或日志。
5. 如需微信 Bot，在设置中扫码绑定 iLink，确认授权后再**手动启用**，检查运行状态和白名单单聊；iLink 可能因第三方协议变化而失效。

## 5. 后续升级及自定义域名

普通代码升级：检查 PR 与数据库迁移 → 确保有数据备份 → 合并到 `main` → 等待完整 CI（TypeScript、单元测试、本地 Worker E2E、Chromium 浏览器 E2E）成功 → 自动发布现有 Cloudflare Worker → 线上健康检查。失败 CI 不部署；如果较新的提交已经进入 `main`，旧 CI 的发布会被跳过。若自动流程异常，可在 Actions 手动运行 Dry Run 后选择 `dry_run=false` 恢复发布。自动流程固定 `provision=false`，不会新建或重建 D1/R2；只有显式手动部署才允许 "provision=true"。

自定义域名：Cloudflare Dashboard → Worker → Custom Domains 先完成绑定；在仓库 Variable 中填写真实的 `BABYMEMO_PUBLIC_URL`；确认 Cloudflare Dashboard 和 DNS 已可用再运行正式工作流。不要为了更换域名轮换 `SESSION_SECRET` / `DATA_KEY`，也无需配置额外的认证 Origin 环境变量。

只更新 Worker Secret 可以在 Cloudflare Dashboard 的 Worker → Settings → Variables and Secrets 中手动操作；**不要覆盖不知道原值的生产 `DATA_KEY`**。

## 6. 自动发布的触发与安全约束

- 触发机制：`Deploy BabyMemo to Cloudflare` 监听 `Check BabyMemo` 的 `workflow_run.completed`。只接受同一 GitHub 仓库、`main` 分支、由 **push** 启动且**结论为 success** 的 CI；PR、fork、失败/取消的 CI 不能发布。
- 提交一致性：部署固定 checkout **成功 CI 的 commit SHA**，不会用新的未测试 HEAD 替代；开始和真正发布前都会对比远端 `main`，如果不是最新提交则跳过，防止慢速 CI 把新版覆盖成旧版。
- 凭据边界：生产 job 仍采用 `environment: production`。如 GitHub 为该 Environment 设置必需审批，自动发布需先获得审批。Cloudflare Token 权限仍限定生产账号。
- 数据与密钥：自动任务只调用 `provision:remote -- --check` 检查并解析已有 D1/R2，**先增量 D1 migration 后发布**，使用 `wrangler deploy --keep-vars` 保留控制台变量，并**跳过 `secret put`**，既有 `SESSION_SECRET` 与 `DATA_KEY` 不会自动轮换；成功发布后执行健康检查。项目手动发布仍允许按需创建资源与首次同步 Secrets。
- 避免双重发布：如果 Cloudflare Dashboard 另行开启了 Workers Builds/Git 自动部署，同一 `main` push 可能同时触发两条部署链，应关闭其中一条。建议以 GitHub Actions 为唯一生产发布入口。
- CI 自动发布**不支持自动回滚 D1 migration**。变更数据库结构前必须检查迁移向前兼容并确认备份。HTTP 健康检查通过也不代表真实 iPhone Safari / 微信 / OpenRouter 的完整验收。

## 7. 常见故障

| 现象 | 排查要点 |
| --- | --- |
| Actions 中找不到部署工作流 | Workflow 文件须存在于默认分支，检查 GitHub Actions 设置与工作流是否启用 |
| Dry Run 提示缺 D1 或 R2 | `--check` 不会创建远端资源；首次正式运行需 `provision=true`，或先手动建资源 |
| Cloudflare API / R2 / D1 返回权限错误 | 检查 Token 所属账号和编辑/读取权限，避免跨账号操作 |
| D1 ID 不一致 | 脚本会拒绝切换到另一个同名数据库；先人工确认现有数据库，不能靠清空数据库解决 |
| Smoke Check 报 Secret 缺失 | 核对 GitHub Secrets 或 `production` Environment Secrets、Worker Secrets 是否同步 |
| Smoke Check 域名不可访问 | 确认绑定已生效；Variable 可暂留空检查 workers.dev，国内可访问性需要单独实测 |
| 初始化页一直显示无法连接 | 检查 `/api/health`、D1 迁移、`/api/bootstrap/status`，不要通过重置数据库绕过 |
| 登录后报 `ORIGIN_REJECTED` 或反复掉线 | 确认访问使用同一 HTTPS 域名，浏览器 Cookie 与请求 Origin 对应，清除旧域名 Cookie 后重登 |
| iPhone MOV 无法播放 | 现阶段不提供 HEVC/MOV 转码，分片成功不等于所有浏览器可解码 |
| 微信 Bot 不响应 | 检查扫码绑定、是否手动启用、Bot 状态和第三方 iLink 协议 |

## 8. 生产安全边界

部署会修改远端 Cloudflare 资源、运行 D1 migration。**不能**将 Dry Run 当成数据库备份，也不能把 D1 migration 当成可自动回滚的步骤。发布前先备份现有数据和 R2 媒体；失败时优先排查并前向修复，不要随意删除 D1、R2 或直接重建 Worker。

本流程**不会**自动迁移旧 MyBaby 的 Vercel、Neon 或 R2 生产数据，也尚未完成真实生产端到端验收。参考 [Agent 部署指南](./agent-deploy.md) 与 [项目 README](../README.md)。


## 自动部署遇到 Cloudflare API 504

2026-10-12 发布日志出现 Cloudflare Workers API `GET /accounts/.../workers/services/babymemo` 及 `.../scripts/babymemo/secrets` 返回 `504 Gateway Timeout`。这是服务端网关超时；该次 D1 增量迁移已成功，但 `wrangler deploy` 返回非零，不能视为 Worker 已更新。

新增 `scripts/deploy-worker-with-retry.sh`：仅针对 502/503/504、429 和短时网络错误，最多尝试 3 次，失败后等待 15 秒、45 秒。每次自动重试前校验待部署 SHA 仍等于远端 `main`，阻止旧版覆盖新提交；权限/配置错误不重试。数据库迁移只在部署前执行一次，**重试阶段只重新执行 `wrangler deploy --keep-vars`**，不删除 D1/R2、不重写 `SESSION_SECRET` 或 `DATA_KEY`。发布成功后仍执行 Smoke Check。

如果三次均失败，应查看 [Cloudflare Status](https://www.cloudflarestatus.com/) 并保留 Actions 错误信息；不要用重建数据库或轮换密钥的方式处理 Cloudflare 网关异常。

## 迁移记录修复说明（0012）

如果线上 `babies.birth_time` 已经由其他发布或人工操作创建，但 `d1_migrations` 未记录 `0012_birth_time.sql`，旧流程会报 `duplicate column name: birth_time`。新版部署先只读检查文本类型兼容性、默认值和 `0011_wechat_photo.sql` 记录，符合条件时仅向 `d1_migrations` 添加对应的迁移名称，再由 Wrangler 正常处理其他迁移。若不符合精确条件，部署会明确失败，禁止直接删列、重建数据库或手动跳过整批迁移。修复不等同于生产数据备份。
