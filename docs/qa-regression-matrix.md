# BabyMemo 回归测试矩阵

本文件记录的是**自动化覆盖范围和边界**，不是生产环境验收证明。测试必须使用隔离数据，不使用用户照片、真实微信凭据或线上 D1/R2。

## 微信 Harness 新场景测试（设计中）

新增的真实场景问题编号 H-01～H-22、待实现的自动化案例 T-001～T-024，分别见 [微信 Harness 场景审查](wechat-harness-review.md) 与 [Harness 自动化测试计划](wechat-harness-test-plan.md)。部分场景已经实现，详见 [Harness 实施对照](wechat-harness-implementation.md)。**原规划的 T-001～T-024 不等于全部已有独立断言或已经通过；应以实际测试名称和 CI 结果为准。** 当前已有的单元测试与模拟 E2E 覆盖范围仍以本文件下文为准。

## 自动化入口

| 入口 | 环境 | 覆盖内容 |
| --- | --- | --- |
| `npm run test:unit` | Node，离线 | 微信工具和记忆、OpenRouter 429/5xx 重试、微信加密媒体、上传最终化和回收、备份包完整性 |
| `npm run test:e2e` | 本地 Wrangler + 独立 D1/R2/DO | 认证与 CSRF、同请求并发幂等、多宝宝隔离、私有媒体读写、视频分片、Range、删除和恢复 |
| `BROWSER_E2E=1 npm run test:e2e` | Chromium / WebKit | 登录持久性、添加宝宝、上传与私有相册、编辑及删除、多视口、草稿隔离、可访问性基础断言 |
| GitHub Actions `Check BabyMemo` | 四个隔离 Job | 检查和构建、Worker E2E（包括部署 Key 模拟）、Chromium、Linux WebKit；截图保存在 Artifacts |

CI 使用自动生成的本地测试密钥与临时 D1/R2 存储，不连接生产 Cloudflare 资源。截图只含虚构数据。

## 关键场景与期望

| 风险场景 | 自动化断言 | 现状 |
| --- | --- | --- |
| 同一个用户请求并发提交两次 | 最终只有一个记录 ID，跨宝宝重用同一请求 ID 被拒绝 | Wrangler E2E |
| 不同宝宝的记录与照片 | 分宝宝列表互不混入，删除与恢复保持目标不变 | Wrangler E2E |
| 使用外站 Origin 伪造写入 | 403，且数据库中没有伪造记录 | Wrangler E2E |
| 分片不完整或尺寸不合法 | 拒绝提前完成和错误大小的分片 | Wrangler E2E |
| 视频上传及断点读取 | 原始字节保存，206 Content-Range 与原文件一致 | Wrangler E2E |
| 未登录直接读取媒体 | 原件和缩略图均返回 401 | Wrangler E2E |
| R2 已提交、D1 曾失败 | 再次 finalize 不重复完成 Multipart | Node 故障注入 |
| 超时和 429 | 仅模型选择可有限重试，修改数据工具不重复执行 | Node 模拟测试 |
| 微信图片与视频 | AES 解密、CDN 域名白名单、内容嗅探、50MB 上限、幂等入库 | Node 模拟测试 |
| 家庭备份文件被篡改 | SQL/照片 checksum、缺失对象、重复 key、路径异常导致校验失败 | Node 离线 CLI |
| 320 / 375 / 390 / 768px 屏宽 | 各主页面没有横向滚动；移动底部操作区最小 44px | Chromium 与 WebKit |
| 宝宝之间的未提交草稿 | 切换宝宝/页面后仍只显示对应草稿 | Chromium 与 WebKit |
| 图片预览与减少动效 | modal 在屏幕内、Escape 关闭、偏好减少动效生效 | Chromium 与 WebKit |

## 尚未被自动化证明的事情

1. **真机**：实际 iPhone Safari（尤其 HEIC、HEVC/MOV、系统相册选择器、键盘、后台中断、PWA 离线）仍需要设备测试。Linux WebKit 不是 iOS Safari。
2. **真实微信**：扫码授权、账号限额、消息发收延迟、视频/照片协议变种及持续轮询需要专用测试账号；当前测试以模拟对象和本地私有存储为主。
3. **真实外部模型**：不执行产生费用的 OpenRouter 现场回归；工具调用功能是否符合具体模型契约需要在受控测试 Key 下单独验证。
4. **生产容灾一致性**：本轮只能验证一个*已经生成*的备份包没有损坏；不能证明运行期间 D1 导出和 R2 复制处在同一快照。须做暂停写入/一致性点检查、隔离恢复演练及媒体对象清点。
5. **黄金截图与性能预算**：截图作为人工证据，并未配置像素差分；未设置真实网络的 Lighthouse/LCP/INP、图片流量或 R2 费用性能阈值。
6. **任意时刻宕机**：云端发生断电、网络分区、跨区域持久化异常等仍无法仅靠本地 Mock 证明安全。

## 发布门槛

- 四个 GitHub Actions Job 全绿，不能以「已启动」或「已提交 PR」代替通过。
- 新增场景如发现缺陷，应先修复生产代码或在 PR 中记录明确的阻塞项，不能简单删除失败断言。
- 核验截图，并进行真实 iPhone、微信账号和完整离线恢复演练后，才可声称相关功能通过生产验收。
- 合并测试 PR 时不要轮换 SESSION_SECRET / DATA_KEY，也不要运行生产数据迁移之外的破坏性脚本。

## 手动真实模型验证（不随 CI 自动触发）

| 测试 | 入口 | 自动执行 | 访问真实家庭数据 |
| --- | --- | --- | --- |
| OpenRouter Tool Calling E2E | GitHub Actions `Manual OpenRouter Live E2E` 或设置确认变量后执行 `npm run test:openrouter:live` | **否** | 不访问 Cloudflare D1/R2 或微信，仅向外部模型发送一条虚构指令 |

本地 Worker E2E 与 Chromium/WebKit E2E **继续自动执行**，它们使用假 Key 和临时存储，不会产生 OpenRouter 调用费用。手动模型测试需要管理员配置真实 Key，可能产生小额 API 费用；可验证目标模型当前是否返回标准工具调用，而不是验证真实微信授权或用户家庭数据。
