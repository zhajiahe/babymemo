# ADR-002：微信轮询与 DO 成本优化（未实施）

**状态：研究提案，非现行生产架构。** 当前 iLink 接收仍依赖 DO 轮询。历史 PR #57 使用约 8 秒监听、空闲约 22 秒后重试的短期方案，**不等于**本文的 Worker/Cron 解耦已实现，也不证明真实微信延迟已验收。

## 问题与候选

iLink 的 [getupdates 协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md) 是长轮询，不是已确认的 Webhook。DO 等待外部网络请求可能持续计费，见 [Cloudflare DO 生命周期](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) 与 [定价](https://developers.cloudflare.com/durable-objects/platform/pricing/)。

候选方案：每分钟 [Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/) 启动普通 Worker，在一个有界窗口内**连续**执行 iLink 长轮询；DO 只负责成员状态、单写者租约、游标、去重和持久任务。Cron 每分钟触发**不是**每分钟只收一次消息。若交接造成高延迟，再单独评估 Queues 或其他调度，不能将未经证实的 Webhook 当作现有 API。

## PoC 必须满足

- 同一成员任何时刻只能有一个有效轮询者；租约带代次，**先持久化消息与游标，再推进确认**；异常重启可恢复，不重写已提交的日记/媒体。
- 不修改原有宝宝、成员、加密密钥和 D1/R2 归属；暂停/解绑/重绑必须停止旧任务，旧 DO alarm 与新 Worker 不能并行消费同一连接。
- 用两个以上测试成员和合成数据对比空闲 DO GB-s、Workers/Queues 总账单与实际 p50/p95 接收延迟；至少测冷启动、Cron 漂移、网络超时、消息突发、长媒体、断线重连。
- 必须提供默认关闭、渐进灰度、旧路径回退和真实微信验收。**没有 PoC 数据不宣称节省比例或稳定实时性**；不得使用生产家庭聊天或凭据公开测速。

详细平台限制以 [Workers](https://developers.cloudflare.com/workers/platform/limits/) 与 [Queues](https://developers.cloudflare.com/queues/platform/pricing/) 官方文档为准；当前实现和用户可见状态见 [微信 Harness](wechat-harness-implementation.md)。
