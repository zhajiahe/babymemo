# BabyMemo 部署和初始化

> 本指南面向个人自托管。当前仍是开发预览；不要直接替换运行中的 MyBaby。

## 1. 架构和边界

- Cloudflare Worker（Hono）：前端、API、认证、OpenRouter。
- D1：账号、宝宝、成长记录、里程碑、附件索引、凭据密文。
- R2：私有照片和视频，所有媒体读取均由已登录的 Worker 代理。
- SQLite-backed Durable Object + Alarm：微信 iLink Bot 消息轮询，无需 VPS。
- 所有账号登录和变更 API 都是同源请求；**绑定新域名无需更改固定的 PUBLIC_URL**。

## 2. 部署方式 A：Deploy to Cloudflare

在 [仓库主页](https://github.com/zhajiahe/babymemo) 点击 **Deploy to Cloudflare**，授权 Cloudflare 对你的 GitHub 账户创建部署仓库。

首次部署由 Wrangler 自动创建缺失的 D1 `babymemo`、R2 `babymemo-media` 和 Durable Object 类 `WechatSession`。项目脚本在部署后解析 D1 的远端 ID，然后执行 migrations。脚本 **只查找和复用名称完全匹配的 D1，不会删除或重建已有数据库**。

若自动部署脚本在 `wrangler d1 migrations apply DB --remote` 失败，可在部署项目的控制台运行 `npm run db:resolve` 验证是否正确查找到 `babymemo`；不要自行删除数据库。

部署向导可读取 `.dev.vars.example` 显示必填 Secret 的名称与说明；如果部署过程中没有出现密钥表单，请按下节到 Worker 控制台设置。

**重要**：在配置 Secret 并完成数据库迁移之前，网站可能尚不能进入初始化。

## 3. 两个必需 Secret（必须分别生成并保存）

终端连续执行两次，每次得到独立的 64 位十六进制值：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

进入 Cloudflare Dashboard → Workers & Pages → `babymemo` → Settings → Variables and Secrets，添加：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `SESSION_SECRET` | 登录会话签名，改变将导致已登录设备退出 |
| Secret | `DATA_KEY` | OpenRouter / 微信凭据的 AES-GCM 加密密钥，**改动后旧密文不可解密** |

密钥不要贴进 URL、Issue、日志或 README，不要提交 .dev.vars。建议保存在密码管理器。

## 4. 首次初始化

打开 `https://<你的 workers.dev 域名>/`：

1. 直到两项 Secret 状态均为已配置，才允许提交表单。
2. 输入家庭名称、管理员登录名和至少 10 位的家庭密码。
3. 输入第一位宝宝的姓名、出生日期、性别、时区；过敏信息可选。
4. 提交后自动登录。初始化是一次性操作，不能通过刷新页面重建另一个所有者。
5. 使用家庭管理员登录名 + 家庭密码再次登录，验证浏览器会话。

**安全提示：** 首次注册不再要求初始化密钥。公开空实例允许第一个访问者创建唯一管理员，存在被抢先注册的风险。请部署后立即完成初始化，或先使用 Cloudflare Access 限制访问。已有管理员不能因重部署被覆盖或重置。

为保护隐私，默认仅允许一个家庭管理员；后续增加家庭多用户需要独立的角色设计。

## 5. 部署方式 B：GitHub Actions

在仓库 Settings → Secrets and variables → Actions 配置 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`SESSION_SECRET`、`DATA_KEY`，并确认作用于目标 Cloudflare 账号。详细说明见 [GitHub Actions 部署指南](github-action-deploy.md)。

Actions → **Deploy BabyMemo to Cloudflare** → **Run workflow**，默认 `dry_run=true`：

1. 只读核对已有 D1 / R2、执行类型检查、单元测试、构建及 Wrangler Dry Run。
2. **首次尚无 D1/R2 时，默认 Dry Run 因资源缺失而失败是预期行为**，不要通过删除或重建数据库绕过。
3. 得到明确的正式发布授权后，选择 `dry_run=false`、`provision=true`。工作流校验两项业务 Secret（包含 `DATA_KEY` 的 64 位 hex 格式）、创建或复用 D1/R2、**先应用 D1 migration、再发布 Worker**，随后同步 Secret 并检查健康状态。
4. 后续发布同样需要手动触发，Push 和 PR 不会自动更新 Cloudflare。

这一路径与一键 Cloudflare 模板部署路径不同。**当前 `npm run deploy` 仍采用“Worker 发布 → 解析 D1 ID → migration”的顺序**，不能把它的顺序当成此 GitHub Actions 工作流的顺序。Agent 受控部署细节见 [Agent Runbook](agent-deploy.md)。

## 6. 自定义域名

在 Cloudflare Worker → Settings → Domains & Routes → Add Custom Domain，输入自有域名，例如 `baby.example.com`，等待证书 Active；然后测试登录、创建记录和视频上传。

Browser Auth 使用 `window.location.origin` 发起同源请求，而非 FlareMo 的固定公开 URL 模式。旧域名和新域名如果都指向同一个 Worker，可以分别登录（会话 Cookie 不共享）。由于 Cloudflare 全球网络在中国大陆的访问情况受运营商等因素影响，自定义域名并不保证全国无代理稳定可用。

## 7. 微信 Bot 与 OpenRouter

登录网站 → 设置 → OpenRouter，填 API Key + 模型 ID，保存并点击测试。密钥只在服务端解密发起请求，不向浏览器回传。

设置 → 微信 ClawBot → 扫码绑定，确认后手动启用 Bot。Durable Object 用 Alarm 反复拉取消息；只接受绑定微信用户的单聊文字。重新绑定会重置旧游标，避免漏读或串号。

**微信 iLink 为第三方适配，可能失效**。首次运行前测试二维码、扫码确认、文字消息发送、去重、记录查询、新增、暂停、重新启用和凭证过期处理。宝宝信息可能作为上下文发送到 OpenRouter；不要把医疗隐私写入公开分享链接。

## 8. 排障

| 症状 | 检查 |
| --- | --- |
| 首页报 500 / 初始化状态失败 | D1 迁移是否完成，Worker 是否绑定到了正确的数据库 |
| 初始化按钮不可点 | 两个 Secret 是否存在，`DATA_KEY` 是否为 64 位十六进制 |
| 自定义域名登录失败 | Origin / Cookie、HTTPS、DNS，Network 中登录 API 返回状态 |
| 重新部署后所有设备登出 | `SESSION_SECRET` 是否误改 |
| OpenRouter / 微信无法使用 | `DATA_KEY` 是否被误改，Key 是否过期；查看服务端错误码 |
| 大 MOV 上传慢 | 启用并行分片；确认 iPhone 上行和 CF 连通性；当前尚不提供服务器视频转码 |
| 微信扫码成功但不收消息 | 先检查 Bot 是否启用、DO 状态及第三方接口可用性 |

不要通过删除 D1 / R2 来修复登录或部署问题。
## 9. 相册缩略图和续传升级检查

新迁移 `migrations/0003_upload_fingerprints.sql` 为现有 `media_uploads` 增加 `fingerprint` 字段，默认空字符串，**不会删除旧记录或重建 D1**。正式工作流先执行迁移，再发布 Worker；必须核对部署顺序。已完成上传的原始媒体不需要迁移。

上传中断后重新选择相同本地文件可以续传；旧版遗留的空指纹会话不可自动识别，但可从「待续传文件」中手动取消。新图片在浏览器内生成 JPEG 缩略图后才上传派生文件；失败不影响原图。旧图片自动回退原始媒体，未来可另行安排私有的批量补图任务。请在 iPhone Safari 测试弱网续传、登录过期、上传中途退出及相册切换宝宝的隔离性。

**升级已有实例时请保留原本 `SESSION_SECRET` / `DATA_KEY`，不要清空 D1/R2。**
