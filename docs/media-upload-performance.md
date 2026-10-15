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
