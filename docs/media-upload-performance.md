# 媒体上传与观测

## 路径与边界

| 入口 | 行为 |
| --- | --- |
| 网页 ≤5 MiB | `PUT /api/upload/direct/:id`，R2 原件 + D1 索引，稳定 ID 可重试 |
| 网页 >5 MiB～200 MiB | 8 MiB 分片续传；并发有上限，完成前不报告成功 |
| 微信 ≤50 MiB / 项 | 可信 CDN + AES 解密、最多 4 项/消息；大视频最多 2 路 R2 分片在途 |

全部原件位于**私有 R2**；视频/照片封面为可稍后修复的私有派生物，不阻塞原件保存，但「原件成功」不等于「封面就绪」。网页缩略图处理受浏览器生命周期限制，后台离线不保证持续执行。

## 观测与验收

Worker 日志事件 `MEDIA_TRANSFER_TIMING` 只记录 `channel`、`stage`、`status`、`sizeBand`、`durationMs` 等枚举/桶化字段。`web/client` 才包含客户端上行网络与重试；`web/direct`、`web/part`、`wechat/cdn`、`wechat/r2` 等服务端阶段**不可直接相加**。日志不得含文件名、URL、宝宝 ID、Token 或媒体正文。

自动测试验证权限、内容字节、分片排序/abort、幂等、失败恢复、大小限制和并发上界。现场测速应使用**虚构媒体**、固定设备/网络、比较 p50/p95 与失败率；本地 Worker / Linux WebKit 无法证明真实 iPhone、跨境链路或微信 CDN 的吞吐。平台路由和 R2 存储策略变更需独立批准。

## 浏览优化（私有媒体）

- 缩略图采用 `/api/media/:id/thumbnail?v=<updated_at>` 版本 URL；`PUT` 封面时更新媒体版本。服务端仍返回 `Cache-Control: private, no-store`，禁止不经鉴权的公共缓存。
- 已解锁会话的 Service Worker 仅自动缓存版本匹配、服务端确认派生的 JPEG（单项 ≤128 KiB，最多 160 项）；原图和视频只在用户点击“离线保存”后永久存储。登出清理所有私有缓存。
- 照片详情先显示缩略图，同时加载原图；只在当前照片加载成功后预取相邻两项缩略图。不自动预取原图或视频。
- 线上事件 `MEDIA_READ_TIMING` 记录允许枚举及阶段耗时 `d1Ms`、`r2Ms`、`totalMs`（毫秒），不包含 ID、URL 或文件内容；耗时不包含完整的客户端传输和解码。按网络与地区检验效果后再决定是否迁移 R2/D1。
