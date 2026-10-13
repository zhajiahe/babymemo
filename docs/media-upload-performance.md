# BabyMemo 媒体上传性能：实现、观测和验收

> 适用：PR #38，未合并前不代表线上已启用。上传原件始终保存在私有 R2，所有身份与宝宝空间检查保留。测试仅使用合成数据，不触碰生产照片。

## 1. 上传路径与本轮优化

### 网页 / iPhone Safari

| 类型 | 上传路径 | 耐久性 | 策略 |
| --- | --- | --- | --- |
| 1B～5MiB，无待续传会话 | `PUT /api/upload/direct/:id` → R2 private PUT → D1 | 相同随机 UUID 允许请求重放；同一 Safari 会话利用 `sessionStorage` 保存 fingerprint→UUID，成功后移除 | 单次请求，避免 Multipart start / finish 往返 |
| 超过 5MiB～200MiB，或之前有待续传会话 | `/start` → 8MiB parts → `/finish` | 已保存分片可按 fingerprint 恢复；原有 D1/R2 事务补偿与对象校验保留 | 有界 Multipart |
| 缩略图 | 原件确认后串行后台化的浏览器缩略图队列 | **最佳努力**：页面退出后不保证完成；原件不受影响，可按现有补全功能处理 | 不占原件上传的文件槽位 |

上传并发：单文件手机 2 条分片流、桌面 3；批量时最多 2 文件并行，手机每文件 1 条分片流、桌面每文件 2 条；视频和照片共享限制。**这不是 HTTP 上传速率保证**：中国大陆网络到 Cloudflare 的线路、运营商限速和 iPhone 后台停用都会影响实际耗时。

- `PUT /api/upload/direct/:id` 的 UUID 使用浏览器 `crypto.randomUUID()` 生成。服务端强制用户已登录、同源、babyId 存在、日期合法、MIME 白名单、body 长度上限；已完成相同 ID 只返回原结果，不覆盖；R2 写成功但 D1 失败时可用相同 ID 补写索引。
- 不公开 R2 Bucket，不给用户浏览器 R2 API Token 或无限期的公开签名链接。原有大文件断点续传与 200MiB 限制不变。
- **已提交**表示原始文件和 D1 索引写成功；**预览图就绪**单独显示，不阻塞用户上传下一张。无预览图时沿用相册 fallback，并可再次补全。

### 微信 iLink

既有 CDN URL allowlist、AES 解密、大小限制、原始字节保留、消息去重、最多两个同时处理的媒体项不变。单条大视频原本是“8MiB R2 写完 → 才读取下一片”，现在允许同一视频最多两个 8MiB R2 分片写入任务在途，在上限处反压 CDN 解密流；等待所有上传成功、按分片号排序后才执行 Multipart.complete。任意任务失败必须等待在途任务落定后 abort，绝不提前回复成功。

## 2. 服务端指标与隐私

Cloudflare Worker 已启用 observability，搜索事件 `MEDIA_TRANSFER_TIMING`。字段**仅包含**：

```json
{"level":"info","event":"MEDIA_TRANSFER_TIMING","channel":"web","stage":"client","status":"ok","sizeBand":"1-5MiB","durationMs":1824}
```

| channel | stage | 含义 |
| --- | --- | --- |
| web | client | 浏览器从开始读文件/元数据到收到保存确认，**包含手机→Cloudflare 网络及重试** |
| web | direct | Worker 接到小文件 PUT，到私有 R2 与 D1 完成为止 |
| web | part | Worker 接到单个 Multipart 分片到 R2 写完与 D1 分片状态更新 |
| web | finish | R2 Multipart 完成及 D1 媒体索引 |
| web | thumbnail | 浏览器生成并上传缩略图，包括 Safari 解码 |
| wechat | cdn | 微信 CDN 请求至取得响应头（TTFB；不代表媒体完全下载） |
| wechat | r2 | R2.put 或单个 uploadPart 的耗时 |
| wechat | finish | R2 Multipart.complete 的耗时 |
| wechat | index | 原始对象完成后 D1 索引及确认 |
| wechat | total | 单项微信媒体从消息接入到 D1 索引完成 |

注意：部分指标可能并行或包含其他阶段，**不能直接相加**；一次性成功、重试和并发也应分开看，别把 Cloudflare→R2 的耗时当作用户全部上传耗时。

指标没有：文件名、URL、宝宝名称或 ID、家庭文本、微信账号、图片内容、Token、精确文件大小和用户 IP。浏览器的 `/api/upload/metrics` 是会话保护的同源请求，只接收枚举 stage/status、大小和耗时数字，记录前按大小区间归一化。默认只利用 Cloudflare Workers Logs 观察，不新增 D1 明文历史日志表。

## 3. 性能验收

自动化验证逻辑与数据正确性，不将模拟耗时描述为线上真实加速倍数。

| 层次 | 命令 | 通过标准 |
| --- | --- | --- |
| Node | `npm run test:unit` | 有界队列最大并发，失败独立，原有媒体大小/隐私边界，指标字段白名单 |
| Worker+D1/R2 | `npm run test:e2e` | 小文件 201/重复 200、同源和登录拦截、原件逐字节读回、无 Multipart 会话、回收站路径不回归 |
| 微信媒体 | `node scripts/wechat-worker-e2e.mjs` | 9MiB 视频分片、CDN 解密、幂等、弱网模拟和失败恢复 |
| 微信大型媒体 Node | `node --test scripts/wechat-media.test.mjs` | 两个 R2 分片在途上限、错序完成排序、故障后 abort、无残留 |
| Browser | CI Chromium/WebKit E2E | 上传/预览/页面操作不回归；Linux WebKit **不是**真机 iPhone Safari |

上线后手动使用非敏感测试图片（1/3/8/30MiB）与视频（20/50MiB），在相同运营商/设备和相同网络下对比至少 5 次，记录 p50/p95、成功率、吞吐与重试率。给 Cloudflare Worker 日志分别计算 `web/client`、`web/part`、`wechat/cdn`、`wechat/r2`，区分上传线路慢和服务端慢。不得上传私人的家庭照片到测试/第三方测速平台。

## 4. 可选平台运维优化（此 PR 不擅自修改）

可在 Cloudflare Dashboard 审核 R2 Local Uploads / Bucket region 及路由；若可用，可用同一批非私有合成文件做开启前后对照。**不要假设该能力已启用或一定适用中国大陆网络**。只有实际数据证明“Worker→R2”是主要耗时，才考虑继续加大并发或 R2 签名直传（涉及同源会话与私有权限重设计）。

## 5. 未解决的限制

1. Safari 后台终止不能保证最佳努力缩略图队列继续运行。原件成功不等于缩略图已完成，仍需利用现有后续预览补全功能。
2. 浏览器多个文件并发在极差的上行网络下可能反而降低吞吐；后续应根据真实指标尝试自适应并发，不能默认无限调高。
3. 目前服务端不记录跨阶段 trace ID（避免日志中出现敏感关联字段）；按 channel、stage 和大小段做汇总，无法在日志里唯一串起一张家庭照片。
4. Local Worker 模拟、Linux WebKit 和真实微信协议的性能表现不等价；实际 iPhone Safari、国内跨境网络及真实微信 CDN 需要人工验证。
