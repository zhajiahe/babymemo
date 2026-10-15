# 微信轮询与额度

主 Worker 每分钟通过 Cron 为所有已启用微信连接发起最长 35 秒的 iLink 长轮询，结果转交对应 Durable Object 执行去重、消息处理、回复、媒体持久化和游标提交。**无需第二个 Worker、账号 Secret 或手工切换。** 现有每日数据清理 Cron 保留。

安全性：同一连接领取短期租约时旧 DO Alarm 暂停轮询；Cron 消失、失败或超时后，Alarm 看门狗自动恢复原先的 8 秒监听 / 22 秒等待；游标仅在消息处理完成后更新。iLink 返回 `-14` 时冷却一小时。

Cloudflare 免费计划每次 Cron 的 CPU 限制是 10 ms，等待外部网络不计 CPU。部署后关注 Worker 的 CPU 超限、实际 DO GB-s、消息延迟和微信收发；若异常，去掉 `wrangler.jsonc` 中的 `* * * * *`，按原有 CI → 自动部署流程回滚 Cron；最长 120 秒租约结束后 DO 自动接管。不要删除 D1/R2/DO、不要更换密钥。
