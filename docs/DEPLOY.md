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

## 3. 三个必需 Secret（必须分别生成并保存）

终端连续执行三次，每次得到独立的 64 位十六进制值：

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

进入 Cloudflare Dashboard → Workers & Pages → `babymemo` → Settings → Variables and Secrets，添加：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `BOOTSTRAP_SECRET` | 首次初始化授权，一次性验证 |
| Secret | `SESSION_SECRET` | 登录会话签名，改变将导致已登录设备退出 |
| Secret | `DATA_KEY` | OpenRouter / 微信凭据的 AES-GCM 加密密钥，**改动后旧密文不可解密** |

密钥不要贴进 URL、Issue、日志或 README，不要提交 .dev.vars。建议保存在密码管理器。

## 4. 首次初始化

打开 `https://<你的 workers.dev 域名>/`：

1. 直到三项 Secret 状态均为已配置，才允许提交表单。
2. 输入 `BOOTSTRAP_SECRET`、家庭名称、管理员登录名和至少 10 位的家庭密码。
3. 输入第一位宝宝的姓名、出生日期、性别、时区；过敏信息可选。
4. 提交后自动登录。初始化是一次性操作，不能通过刷新页面重建另一个所有者。
5. 使用家庭管理员登录名 + 家庭密码再次登录，验证浏览器会话。

为保护隐私，默认仅允许一个家庭管理员；后续增加家庭多用户需要独立的角色设计。

## 5. 部署方式 B：GitHub Actions

在 Fork 的 Settings → Secrets and variables → Actions → Repository secrets 添加：

`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`BOOTSTRAP_SECRET`、`SESSION_SECRET`、`DATA_KEY`。

API Token 应仅允许目标 Cloudflare 账号中 Workers、D1、R2 及部署所需权限。永远不要把 Cloudflare Global API Key 上传到仓库。

打开 Actions → **Deploy BabyMemo to Cloudflare** → **Run workflow**。该工作流：

1. 安装依赖并构建前端。
2. 在部署前验证 5 个 Secret 均已提供且密钥格式正确。
3. 发布 Worker / 自动创建缺失资源。
4. 运行 `npm run db:resolve`，解决自动资源创建后 D1 ID 未持久化的问题。
5. 执行远端迁移，再同步三个 Worker Secret。

此工作流只可手动触发；日常 Push 和 PR 只执行代码检查，不会改动 Cloudflare 生产数据。

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
| 初始化按钮不可点 | 三个 Secret 是否存在，`DATA_KEY` 是否为 64 位十六进制 |
| 自定义域名登录失败 | Origin / Cookie、HTTPS、DNS，Network 中登录 API 返回状态 |
| 重新部署后所有设备登出 | `SESSION_SECRET` 是否误改 |
| OpenRouter / 微信无法使用 | `DATA_KEY` 是否被误改，Key 是否过期；查看服务端错误码 |
| 大 MOV 上传慢 | 启用并行分片；确认 iPhone 上行和 CF 连通性；当前尚不提供服务器视频转码 |
| 微信扫码成功但不收消息 | 先检查 Bot 是否启用、DO 状态及第三方接口可用性 |

不要通过删除 D1 / R2 来修复登录或部署问题。