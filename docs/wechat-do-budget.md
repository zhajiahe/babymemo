# DO 轮询成本专项：有界微信监听（2026-10-14 已随 PR #57 部署，实机效果仍待验证）

## 真实账单症状（Cloudflare GraphQL，UTC 2026-10-13）

- `babymemo_WechatSession` 下两个活跃会话：`family` 约 **8,392 GB-s**，新连接约 **4,195 GB-s**。
- 两个微信会话均在 `WechatSession.alarm()` 内等待 `ilink/bot/getupdates`，旧请求超时 45 秒，消息处理完默认 2.5 秒后立即继续。
- Durable Objects **等待网络返回的墙钟时间**会产生时长消耗。免费计划计算时长预算为每天 13,000 GB-s（实际额度以 Cloudflare 为准），两个连接的空闲长轮询单日即可接近额度。

## 这轮做什么

不迁移微信状态、不替换 Worker、不修改 D1 游标及幂等机制，先降低空闲轮询占空比：

| 场景 | 原机制 | 优化后 |
| --- | --- | --- |
| 单次等待 iLink | 最多 45,000 ms | **最多 8,000 ms** |
| 成功取到消息 | 2,500 ms 后再请求 | **1,500 ms** |
| 无消息、正常完成 | 2,500 ms 后再请求 | **22,000 ms** |
| 到达客户端监听截止 | 原先可能作为网络错误 | **保留游标**，无写入/无伪造回复，22,000 ms 后重新监听 |
| 真正 HTTP 5xx、协议失败 | 30,000 ms 重试 | 保持 30,000 ms |
| 凭据过期、成员暂停 | 禁用及停止 alarm | 保持原行为 |

**理论上界模型（不是生产实测）**：2 个对象、每个按 128 MiB 计、全天空闲、8/30 秒监听占空比，则监听等待时长约 `2 × 86400 × (8/30) × 0.128 ≈ 5,900 GB-s/日`。需要再加实际消息处理、LLM、媒体队列、存储以及云端测量偏差。Cloudflare DO 的 128 MiB 计费规则见官方 [定价文档](https://developers.cloudflare.com/durable-objects/platform/pricing/)。

## 不变式

- iLink 返回完整批次、发送回复完成，才推进 `get_updates_buf`；遇到客户端超时不提交新游标，所以下一轮能从原游标继续。
- D1 源消息唯一键、ReAct 决策日志、回复的 client_id、媒体队列的去重和重试保持不变。
- 启用/暂停/重置仍控制各自 DO 的 alarm。两个成员的 DO 独立。
- 新增 `/status` 的 **pollOutcome** 和 **lastPollDurationMs**，仅暴露无敏感数据的运行诊断。
- 空闲超时只对自己主动取消的 `getupdates` 请求视作正常。微信认证失效、HTTP 5xx、其他异常仍按原规则记录错误。

## 上线前的验收门槛

1. `npm run check`、`npm run test:unit`、`npm run build` 与隔离 Worker E2E 均通过；Chromium/WebKit 不回归。
2. 用真实绑定微信验证：空闲超过 5 分钟后发送文本、语音、图片/视频，确认端到端可见且不重复。
3. 发布后观察 24 小时：分对象的 `durableObjectsPeriodicGroups.sum.duration`、`alarm` 调用数与错误数；关注 95 分位微信回复延迟。
4. 如果 iLink 服务端只在超过 8 秒之后才返回已到达的消息，**不得直接上线此策略**；先延长监听窗口或改用普通 Worker 的定时长轮询并保留 DO 处理和游标，避免丢失可用性。

由于 iLink 未提供正式的 Bot 消息推送 SLA，短监听+低频空闲轮询存在漏过即时唤醒窗口的可能；该 PR 后续已合并部署，但仍需真实微信验收；**不能将 CI 通过当作 iLink 协议安全性得到证明**。

## 长期目标：DO 管状态，普通 Worker 管微信长轮询

> **长期研究已形成单独 ADR**：[ADR-002：微信消息接收解耦及 DO 费用优化](wechat-transport-architecture.md)。最初 PR #57 不实施架构迁移；短期优化现已部署，但长期架构仍未实施。

已核验的结论：腾讯官方 [iLink 协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md) 仍采用 `getupdates` 长轮询，返回服务端建议的 `longpolling_timeout_ms`（示例约 35 秒）；`notifyStart/notifyStop` 不是消息推送 Webhook。Cloudflare [DO 生命周期](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) 明确未完成外部 `fetch` 阻止休眠并持续计费；[普通 Workers 的网络等待](https://developers.cloudflare.com/workers/platform/limits/) 不计入 CPU 时间（但免费 CPU 仅 10ms/调用）。

推荐先做**每分钟 Cron 触发 → 普通 Worker 在本次执行窗口内连续 iLink 长轮询 → 原 DO（单写者租约、游标、幂等、消息处理）**的小型 PoC。**Cron 每分钟启动一次，不代表消息一分钟才取一次**：窗口内每次 `getupdates` 完整返回后，先交 DO 确认并提交游标，再立即继续下一次等待。首轮可测试约 50–55 秒窗口（需按剩余窗口限制最后一次请求），不能假定 Cron 严格准点；轮与轮之间的空档、冷启动和租约接棒仍可能引起延迟。用真实微信测量 **入站接收 p95 < 5 秒**的研发目标，达不到就评估可靠的低空档调度方式，而不是默认接受一分钟等待。不采用“直接把 DO 的等待放进 `ctx.waitUntil`”的假优化。

Cloudflare [Queues 定价](https://developers.cloudflare.com/queues/platform/pricing/) 为免费账号共享 10,000 次操作/天，一条队列消息一般有 3 次操作；两个连接每分钟一条自循环任务约消耗 **8,640 次/天**，还未计算账号里其他 Queues、重试和 DLQ，因此 Queues 是**备选**而非默认最佳方案。

长期验收目标（**不是当前 PR 的性能承诺**）：两个成员无消息时 DO 不进行外部长轮询，空闲 DO 计算时长 < 1,000 GB-s/天；原游标与家庭数据不迁移、不重绑微信；零跨成员、零额外写入、失败可恢复；真实微信试点目标接收 **p95 < 5 秒（尚未验证，不是 Cron SLA）**，并重点验证执行窗口末尾、Cron 触发偏移、交接空档、旧租约失效及消息去重。方案选型、故障/成本模型、P0–P3 任务与官方参考链接见 [ADR-002](wechat-transport-architecture.md)。

**重要风险**：已上线的 8 秒客户端监听截止显著短于腾讯示例的 35 秒服务端长轮询。CI 模拟通过不能证明真实 iLink 的延迟或截断行为安全；如协议真机测试不通过，不能上线这套短轮询配置，应优先试验让普通 Worker 等待自然的长轮询响应。
