# BabyMemo

Cloudflare 原生家庭成长记录系统。参考 MyBaby 的宝宝档案、成长记录、里程碑和相册功能，并借鉴 FlareMo 的部署向导与轻量设计。当前为 v0.1 开发预览，不要替换旧 MyBaby 生产环境。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zhajiahe/babymemo)

## 功能

- 首次初始化必须填写家庭名称、密码、宝宝名字、出生日期、性别和时区。
- 家庭密码登录；PBKDF2 哈希、HttpOnly/Secure/SameSite Cookie、D1 登录限流和同源保护。
- D1 中的成长记录、里程碑、分页相册；R2 私有媒体、8 MiB 分片上传和视频 Range 读取。
- 网页配置 OpenRouter Key 和模型，测试连接并通过 AI 对话。
- 网页获取微信 iLink 二维码，扫码配对并手动启用 Durable Object Alarm Bot。只处理绑定微信用户的一对一文字消息。
- React + Vite + Hono + Workers + D1 + R2 + Durable Objects；不需要 VPS、Next.js、Neon 或 OpenClaw。

## 一键部署

点击上方 Deploy to Cloudflare：Cloudflare 会克隆仓库并尝试自动部署 Worker、D1、R2、Durable Objects；deploy 脚本包含数据库迁移。首次上线后**必须人工添加 Secrets**，不能通过公共网页匿名占用新实例。

在 Cloudflare Workers → BabyMemo → Settings → Variables and Secrets 中添加三个类型为 Secret 的值：

- BOOTSTRAP_SECRET：终端运行 openssl rand -hex 32
- SESSION_SECRET：单独再次运行 openssl rand -hex 32
- DATA_KEY：再单独运行 openssl rand -hex 32（必须保留，轮换将导致原有加密凭据无法解密）

完成后访问 Worker 域名，根据 /api/bootstrap/status 状态进入初始化界面。绑定自定义域名后不用修改认证 Origin 环境变量，仍要测试完整登录。


## FlareMo 风格的安全发布

推荐先在 GitHub Actions → **Deploy BabyMemo to Cloudflare** 中运行默认的 **Dry Run**：它只读取并验证现有 D1、R2 资源，执行类型检查、构建及 Wrangler 发布预演，**不会触碰远端数据库或发布生产版本**。首次部署还没有资源时，Dry Run 将有意失败，此时需要取消 Dry Run、保持 Provision 开启执行首次正式发布。

正式发布会依次：幂等创建/核对 D1 和 R2 → 执行远端迁移 → 发布 Worker → 同步已配置的 Secrets → 检查 Worker、D1 和密钥配置。不会自动发布每次提交。

如使用自定义域名，可在仓库 Actions Variables 设置 `BABYMEMO_PUBLIC_URL=https://your-domain.example`，它只用于**发布后健康检查**，**不参与登录 Cookie 或 Origin 生成**；域名需要事先在 Cloudflare 中绑定 Worker。留空时尝试检查 `https://babymemo.<workers-subdomain>.workers.dev`。

`SESSION_SECRET` 和 `DATA_KEY` 一定要在升级时**保持不变**；改变前者会使现有登录失效，改变后者会使数据库中已有的加密 OpenRouter/微信凭据无法解密。不要将密钥或生产数据提交 GitHub。

### 手机端相册上传

图片与视频采用至多三个 8 MiB 分片并行上传、失败分片最多重试三次；放弃上传时主动清理 R2 multipart 会话。对已经失败而遗留的旧上传、对 iPhone MOV 的视频转码和跨设备断点续传仍未实现，需要后续专项处理。

## 部署文档

- [GitHub Actions 部署指南](./docs/github-action-deploy.md)：Secrets、Dry Run、资源创建、生产发布与故障排查。
- [Coding Agent 部署 Runbook](./docs/agent-deploy.md)：Codex / Claude Code / Pi 的只读预检、受控部署、初始化与验收。

## GitHub Actions 部署

在仓库 Settings → Secrets and variables → Actions 配置：

| Secret | 来源 |
| --- | --- |
| CLOUDFLARE_API_TOKEN | Cloudflare API Token（部署、D1、R2、DO 所需权限） |
| CLOUDFLARE_ACCOUNT_ID | Cloudflare Account ID |
| BOOTSTRAP_SECRET | 随机十六进制 32 字节 |
| SESSION_SECRET | 独立随机 32 字节 |
| DATA_KEY | 独立随机 32 字节 |

Actions → Deploy BabyMemo to Cloudflare → Run workflow。首次正式部署时关闭 Dry Run；后续升级建议先运行默认开启的 Dry Run。正式部署先迁移 D1 后发布 Worker，最后同步密钥与健康检查，不随 Push 自动发布。

本地开发（Node.js 22+）：先 npm install、npm run build，再执行 npx wrangler d1 migrations apply DB --local；另开终端启动 npx wrangler dev 和 npm run dev。把上面的密钥写入仅供本地使用、已被 .gitignore 忽略的 .dev.vars。登录及 Secret 不要提交到 Git。

## 网页配置微信与 AI

先初始化 → 设置 → OpenRouter，填写 sk-or-v1- 开头的 Key 和有效模型 ID并测试；然后设置 → 微信 ClawBot，扫描二维码完成授权；手动启用 Bot。微信 iLink 适配依赖第三方协议，可能随协议变更失效。暂时只处理白名单微信单聊文字，不支持群聊、微信语音、自动推送或第三方 AI 供应商。

OpenRouter 与微信凭据使用 DATA_KEY 经 AES-GCM 加密存放于 D1，UI 不读取明文。消息处理仅保存去重 ID 和状态；用户文字及宝宝上下文可能传给 OpenRouter，请评估家庭隐私。

## 性能与限制

D1 日期索引 + 有界分页，Cloudflare Assets 静态托管；照片懒加载，视频 Range，浏览器最多并行上传 3 个 8 MiB 分片。暂未做 iPhone HEVC/MOV 转码或自动缩略图；上传上限 200MB，最终可播放性依客户端解码器。未完成上传的自动垃圾回收、微信失效自动恢复、生产数据导入/备份、跨站隐私与端到端验收仍未完成。

**数据安全**：新仓库不会读取或修改 MyBaby 的生产 Neon、R2、Vercel；迁移旧数据需要另外做只读导出、哈希核验、媒体复制和最终切换流程。不要用空的新 D1 覆盖旧数据。

## 验证

先运行 npm install、npm run check、npm run build，再在隔离 Cloudflare 环境验证初始化、登录、记录 CRUD、相册上传/读取、OpenRouter、微信配对和持续轮询。当前尚未真实验收，不宣称可直接用于生产。

许可证见 LICENSE；旧 MyBaby 项目及其版权保持不变。
