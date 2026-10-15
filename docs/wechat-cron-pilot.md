# 微信 Cron Worker 实验（默认不开启）

目的：验证将 iLink `getupdates` 的长时间网络等待从按时长计费的 Durable Object 移至按 CPU 计量的普通 Worker，能否降低免费额度消耗。**这是单账户实验，不是已经验证可降低多少成本的生产承诺。**

## 启用方式（务必按顺序）

1. 先合并并部署主 Worker `babymemo`，提供仅通过 DO 绑定调用的 `/pilot/claim`、`/pilot/complete` 内部接口。未部署实验 Worker 时，旧 Alarm 完全照常运行。
2. 准备一个已启用且有有效微信绑定的**测试账号** UUID。该连接必须先由正常启动流程写入 DO 的 `connectionId`。不要拿正式家庭账户直接测试。
3. 单独部署 `npx wrangler deploy -c wrangler.wechat-pilot.jsonc`，然后设置 `npx wrangler secret put PILOT_CONNECTION_ID -c wrangler.wechat-pilot.jsonc`，输入**仅一个**测试连接 UUID。没有有效 UUID 时 Cron 不调用任何 DO。
4. 验证真实账号测试：文字、照片后独立文字、重复消息、网络中断、服务端 `-14`、撤销/重新启用、90 秒以上的长 AI 处理、Cron 中断恢复。重点比较 Cloudflare DO `duration`、请求量、Worker CPU 超时和消息延迟 P95/P99。Cron 仅每分钟运行一次，天然存在监听空窗。
5. **回滚：** 移除实验 Worker 的 `PILOT_CONNECTION_ID` secret（或禁用/删除该 Worker）。最后一次租约 120 秒内到期，原 DO Alarm 自动继续；执行回滚后检查至少一轮微信消息，确认没有遗漏。主 Worker 无需删除 DO / D1 数据。

## 安全与一致性

- Cron Worker 没有 D1、R2 和 DATA_KEY 权限，凭证仅通过内部 DO 绑定在单次轮询中短暂交接，不写日志。
- DO 原子性由同一个对象负责：租约期间 Alarm 只作 watchdog，不读取微信；每次 Cron 提交必须匹配随机租约 ID，过期包不会推进游标。新旧处理仍用原 `pollOnce`、D1 消息去重和“处理完成后更新 cursor”顺序。
- 如果 Cron 崩溃、未提交、或执行过长，租约到期自动恢复旧 Alarm；可能有延迟，不应丢消息。不要同时创建第二个用于同一账号的实验 Worker。
- 腾讯 iLink `-14` 触发 60 分钟请求冷却，不会每隔 30 秒继续重试，也不会直接删除连接；401/403 仍沿用原先的重新绑定行为。
- 免费 Workers 单次 CPU 10ms，真实验证不能仅靠单元测试。只在验收后逐账户开启；不要提前修改主 Worker 的 `wrangler.jsonc` 默认 Cron。
