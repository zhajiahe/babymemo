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

## GitHub Actions 部署

在仓库 Settings → Secrets and variables → Actions 配置：

| Secret | 来源 |
| --- | --- |
| CLOUDFLARE_API_TOKEN | Cloudflare API Token（部署、D1、R2、DO 所需权限） |
| CLOUDFLARE_ACCOUNT_ID | Cloudflare Account ID |
| BOOTSTRAP_SECRET | 随机十六进制 32 字节 |
| SESSION_SECRET | 独立随机 32 字节 |
| DATA_KEY | 独立随机 32 字节 |

Actions → Deploy BabyMemo to Cloudflare → Run workflow，依次构建、发布、迁移 D1、同步 Secrets。正式部署为手动触发，不随每次 Push 自动发布。

本地开发（Node.js 22+）：先 npm install、npm run build，再执行 npx wrangler d1 migrations apply DB --local；另开终端启动 npx wrangler dev 和 npm run dev。把上面的密钥写入仅供本地使用、已被 .gitignore 忽略的 .dev.vars。登录及 Secret 不要提交到 Git。

## 网页配置微信与 AI

先初始化 → 设置 → OpenRouter，填写 sk-or-v1- 开头的 Key 和有效模型 ID并测试；然后设置 → 微信 ClawBot，扫描二维码完成授权；手动启用 Bot。微信 iLink 适配依赖第三方协议，可能随协议变更失效。暂时只处理白名单微信单聊文字，不支持群聊、微信语音、自动推送或第三方 AI 供应商。

OpenRouter 与微信凭据使用 DATA_KEY 经 AES-GCM 加密存放于 D1，UI 不读取明文。消息处理仅保存去重 ID 和状态；用户文字及宝宝上下文可能传给 OpenRouter，请评估家庭隐私。

## 性能与限制

D1 日期索引 + 有界分页，Cloudflare Assets 静态托管；照片懒加载，视频 Range，浏览器每次仅上传 8 MiB 分片。暂未做 iPhone HEVC/MOV 转码或自动缩略图；上传上限 200MB，最终可播放性依客户端解码器。未完成上传的自动垃圾回收、微信失效自动恢复、生产数据导入/备份、跨站隐私与端到端验收仍未完成。

**数据安全**：新仓库不会读取或修改 MyBaby 的生产 Neon、R2、Vercel；迁移旧数据需要另外做只读导出、哈希核验、媒体复制和最终切换流程。不要用空的新 D1 覆盖旧数据。

## 验证

先运行 npm install、npm run check、npm run build，再在隔离 Cloudflare 环境验证初始化、登录、记录 CRUD、相册上传/读取、OpenRouter、微信配对和持续轮询。当前尚未真实验收，不宣称可直接用于生产。

许可证见 LICENSE；旧 MyBaby 项目及其版权保持不变。
