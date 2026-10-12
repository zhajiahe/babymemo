# BabyMemo

Cloudflare 原生家庭成长记录系统。参考 MyBaby 的宝宝档案、成长记录、里程碑和相册功能，并借鉴 FlareMo 的部署向导与轻量设计。当前为 v0.1 开发预览，不要替换旧 MyBaby 生产环境。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/zhajiahe/babymemo)

## 功能

- 首次初始化必须填写**家庭名称、管理员登录名、家庭密码、宝宝名字、出生日期、性别和时区**；全部完成后才开放数据录入。初始化后可在 **设置 → 宝宝资料 → 新增宝宝** 创建第二位及更多宝宝，创建成功自动切换；页面右上角选择宝宝即可查看各自的数据，无需创建第二个家庭账号。
- 家庭密码登录；PBKDF2 哈希、HttpOnly/Secure/SameSite Cookie、D1 登录限流和同源保护。\n- **持久在线**：登录一次后，同一浏览器内的家庭空间会自动恢复；签名会话 Cookie 最长保存 180 天，使用满 30 天后再次打开应用自动续期。已有未过期的旧 7 天 Cookie 首次访问会自动升级，不需要重新输入身份或密码。
- D1 中的成长记录、里程碑、分页相册；体重/身高 SVG 趋势图；相册原图/视频预览、名称与日期编辑、原文件下载；浏览器生成图片缩略图并存储在私有 R2，旧照片自动回退原图；8 MiB 分片、最多 3 路并发（触控设备默认 2 路），中断后重新选择同一文件可校验首尾内容指纹并续传已完成分片；支持视频 Range 读取。
- 网页配置用于**微信指令识别**的 OpenRouter Key 和模型；没有网页 AI 对话或数据分析助手。
- 网页获取微信 iLink 二维码并手动启用 Durable Object Bot。**微信是主要操作入口**：绑定用户通过私聊文字使用白名单工具，直接增删改查宝宝资料、成长测量、成长事件、相册元数据和回收站；不允许任意 SQL 或虚构写入结果。
- React + Vite + Hono + Workers + D1 + R2 + Durable Objects；不需要 VPS、Next.js、Neon 或 OpenClaw。

## 一键部署

点击上方 Deploy to Cloudflare：Cloudflare 会克隆仓库并尝试自动部署 Worker、D1、R2、Durable Objects；deploy 脚本包含数据库迁移。首次上线前必须由所有者设置两个 Secret。Cloudflare 部署向导会参考仓库内 `.dev.vars.example` 提供配置提示；若没有在向导中填写，务必到 Worker 控制台手动添加。注意：新实例在首次设置前可以被任何访客抢先创建管理员，请及时初始化或预先限制访问。

在 Cloudflare Workers → BabyMemo → Settings → Variables and Secrets 中添加两个类型为 Secret 的值：

- SESSION_SECRET：终端运行 openssl rand -hex 32
- DATA_KEY：单独再次运行 openssl rand -hex 32（必须保留，轮换将导致原有加密凭据无法解密）

完成后访问 Worker 域名，根据 `/api/bootstrap/status` 状态进入初始化界面，完成家庭名称、管理员及第一位宝宝的必填资料。首次设置无需额外密钥；部署后务必立即完成注册，或先启用 Cloudflare Access 限制访问，以免他人抢先创建管理员。绑定自定义域名后不用修改认证 Origin 环境变量，仍要测试完整登录。

**完整步骤及故障排查：见 [部署与初始化指南](docs/DEPLOY.md)。** 这是一键创建基础云资源的部署模式，两个私密 Secret 仍需要由所有者配置，不代表扫码后零步骤就能使用。

## GitHub Actions 部署

操作指南：[GitHub Actions 部署](docs/github-action-deploy.md) · [Coding Agent 部署 Runbook](docs/agent-deploy.md)。默认先运行 **Dry Run**，不触碰生产 D1。

在仓库 Settings → Secrets and variables → Actions 配置：

| Secret | 来源 |
| --- | --- |
| CLOUDFLARE_API_TOKEN | Cloudflare API Token（部署、D1、R2、DO 所需权限） |
| CLOUDFLARE_ACCOUNT_ID | Cloudflare Account ID |
| SESSION_SECRET | 独立随机 32 字节 |
| DATA_KEY | 独立随机 32 字节 |

Actions → Deploy BabyMemo to Cloudflare → Run workflow：默认 `dry_run=true`，检验已有 D1/R2、类型检查、单元测试、构建和发布预演；正式发布设置 `dry_run=false`，校验 Secrets、准备 D1/R2、迁移数据库、发布 Worker、同步 Secrets、健康检查。首次无资源时 Dry Run 失败是预期行为。后续合并到 `main` 将先自动运行包含浏览器 E2E 的完整 CI；**全部通过后自动部署到 Cloudflare**（不自动创建 D1/R2、不重新写入密钥、增量迁移先于发布，并进行线上健康检查）。如 CI 失败则不发布，较旧的 CI 结果也不会覆盖最新 `main`。仍支持手动 Dry Run 与手动正式发布。

本地开发（Node.js 22+）：先 npm install、npm run build，再执行 npx wrangler d1 migrations apply DB --local；另开终端启动 npx wrangler dev 和 npm run dev。把上面的密钥写入仅供本地使用、已被 .gitignore 忽略的 .dev.vars。登录及 Secret 不要提交到 Git。运行 `npm run test:unit` 可检查首次部署 D1 ID 解析逻辑。

## 微信操作入口（受限工具 Harness）

先初始化 → 设置 → **微信操作引擎 · OpenRouter**，配置 Key 和模型并测试连接；然后设置 → **微信操作** 扫描二维码、确认授权并手动启用。模型只负责把自然语言转换为允许的工具及参数；所有实际读写由 Worker 通过 D1 执行，结果由数据库产生。网页不提供 AI 助手。

微信私聊示例：

- 「小好今天体重 10.5kg」— 新增测量
- 「查询小好最近五条测量」「查询小好里程碑」「小好最近有哪些照片」— 查询
- 「把小好 10 月 1 日体重更正为 10kg」「给小好 10 月 1 日的照片加收藏」— 修改
- 「删除小好 10 月 1 日的里程碑」「查看小好回收站」「恢复小好编号 abcdef12 的记录」— 软删除/恢复

**误操作保护**：已有记录的修改、删除和恢复必须带日期或查询返回的记录编号；同日多条需要编号，目标不唯一时拒绝执行。删除保留 30 天回收期。多宝宝家庭须在指令中明确宝宝名字。

iLink 属于第三方非官方协议，可能变化。目前只支持绑定账号的私聊文字，不支持群聊、语音、自动推送或其他模型供应商。

OpenRouter 与微信凭据使用 DATA_KEY 经 AES-GCM 加密存放于 D1，UI 不读取明文。消息处理在 D1 保存去重状态、加密回复及客户端消息编号，已完成的去重记录会定期清理；用户指令、目标宝宝姓名和日期可能传给 OpenRouter，请评估家庭隐私。

## 性能与限制

D1 日期索引 + 有界分页，Cloudflare Assets 静态托管；照片懒加载，视频 Range，浏览器按设备使用最多 2–3 个 8 MiB 分片并行上传与单片重试，网络中断后保留未完成分片，重新选择同一文件即可尝试续传；相册内可取消未完成上传，退出不会自动中止远端分片。缩略图仅为新上传且可被浏览器解码的图片生成（最长边 512px；原图不变），旧照片或缩略图失败时会回退原文件；尚未做 iPhone HEVC/MOV 转码，视频封面仅支持浏览器可解码的格式；上传上限 200MB，最终可播放性依客户端解码器。未完成上传已有定时垃圾回收；生产级备份/回滚演练、微信协议失效后的完整恢复、实际跨站隐私和 iPhone 真机验收仍未完成。已支持照片/视频名称和日期编辑，并对兼容媒体生成视频封面；尚未恢复图片裁剪与旋转、HEIC 自动转换、出生体格编辑等旧 MyBaby 的全部功能。

**数据安全**：新仓库不会读取或修改 MyBaby 的生产 Neon、R2、Vercel；迁移旧数据需要另外做只读导出、哈希核验、媒体复制和最终切换流程。不要用空的新 D1 覆盖旧数据。详细字段映射和只读迁移验收清单见 [MyBaby 迁移计划](docs/MIGRATION.md)。

## 设计规范与 Agent 协作

- [AGENTS.md](AGENTS.md)：Codex / Claude Code / Pi 等 Agent 的技术边界、质量验证与安全规则。
- [BabyMemo 设计系统 · Warm Archive](docs/design-system.md)：暖珊瑚视觉、排版、移动端、组件和文案规范，并标明现状与待改造项。
- [Agent 部署 Runbook](docs/agent-deploy.md)：只读预检与受控 Cloudflare 部署（默认不发布）。

## 验证

先运行 npm install、npm run check、npm run build，再在隔离 Cloudflare 环境验证初始化、登录、记录 CRUD、相册上传/读取、OpenRouter 指令识别服务、微信绑定与持续轮询。当前自动化测试覆盖本地 Worker 与模拟浏览器，但不宣称已通过真实 iPhone 与完整生产灾备验收。

许可证见 LICENSE；旧 MyBaby 项目及其版权保持不变。

## 相册上传恢复与缩略图（新增）

- 已完成分片的会话保存在 D1 + R2，iPhone Safari 刷新/网络中断后，重新进入相册、**重新选择相同文件**，会按文件名、大小、MIME 和首尾内容采样指纹找到已有会话，跳过已成功上传的分片。指纹不是全文件 SHA-256；因此该机制用于正常掉线恢复，不是对抗篡改的完整性校验。
- 列表中的「待续传文件」可手动取消对应 R2 multipart；不会删除已完成的照片。无法从浏览器凭空恢复用户手机文件，重新选择仍是必需的。
- 新图片上传完成后由设备尝试生成最长边 512px 的 JPEG 缩略图（最多 512 KiB），保存在私有 R2 的另一对象，访问仍经过鉴权 Worker。图片太大、HEIC 无法解码或设备内存不足时跳过，原图照常可用。旧照片没有缩略图时自动回退原图，不会偷偷转码旧文件。
- 缩略图不会公开到 CDN 或匿名缓存，采用仅限私有客户端重新验证的 ETag / 304；这是**小文件派生存储**而非公开 CDN 缓存。视频列表不会预加载原始视频内容。

## 旧照片缩略图与过期上传管理（2026-10）

- 首次初始化的**家庭密码至少 6 位**，可用数字，也支持更长的混合密码。此变更不重置现有管理员的密码，也不修改登录哈希方式。
- 家庭相册出现「补全旧照片缩略图」后，可以在 Wi-Fi 下**手动**点击「开始补全」。浏览器分批下载旧原图、生成最长边 512px 的 JPEG，并保存到同一个私有 R2 中；历史原图保持不变。点击「停止补全」会在当前处理完成后停止。超过 25MB、浏览器无法解码的 HEIC/照片会跳过；之后仍可重试。**不会自动批量下载全部原图**。
- Worker 每天在 **北京时间 03:00**（UTC 19:00）检查最久未活动的 30 条 multipart 会话。超过 **14 天**未上传新分片的会话才进入清理候选；若 R2 里已经存在完整对象，则优先恢复 D1 相册索引而**不是删除照片**。失败会保留记录用于下次定时检查，不直接重建或清空 R2/D1。
- CI 新增 WebKit（Safari 引擎）移动端合成弱网测试，故意令一个上传分片失败，并验证重试与相册功能。**它不是物理 iPhone / iOS Safari 真机测试**；HEIC/MOV 编解码、真实后台挂起、蜂窝网络与国内访问仍须使用真机确认。

## 家庭数据保护与日常体验

- 记录和媒体移入 30 天回收站后可恢复，原始私有 R2 文件在到期定时任务中才清除。下线前须验证完整恢复流程。
- 设置支持管理员修改家庭密码，修改后所有会话失效。家庭记录可导出 JSON，但它**不含照片和视频原件**。\n- 主动「安全退出」会清除当前浏览器 Cookie，修改家庭密码会使所有旧会话失效。无痕浏览、主动清理网站数据、切换不同域名或 `SESSION_SECRET` 被更换后需要重新登录；必须保持 Worker 的 `SESSION_SECRET` 在部署间稳定。
- [完整 D1/R2 备份、离线校验和隔离恢复](docs/BACKUP.md)提供操作员脚本；它不会自动备份，也不等于已完成生产恢复演练。
- 相册支持名称搜索、收藏、按月展示、文件日期与 JPEG EXIF 拍摄日期推断，以及在设备支持时生成视频封面；原图/原视频不修改。
- 微信单聊对多宝宝要求明确宝宝名字；受限的增删改查工具执行后回写真实结果，去重与回复标识持久化，避免常见重放导致重复记录；仍需真实微信端验收。
- 成长趋势 X 轴按真实日期绘制，而非记录序号；成长表单在当前浏览器会话中保留草稿。**草稿尚不支持跨设备离线自动同步**。
- 已将相册、成长记录和设置业务从 App 中拆分到 `src/features/`；微信指令执行工具独立于模型实现，见 `src/wechat-harness.mjs`。Cloudflare、D1、R2、DO 架构未改变。

**发布限制**：WebKit 合成弱网测试不等于真实 iPhone Safari 测试。HEIC、HEVC/MOV、iOS 后台挂起与中国大陆蜂窝网仍须使用真实设备验证，不宣称自动转码已实现。
