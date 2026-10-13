# BabyMemo 微信 Harness：实施进度与测试边界

本文件描述当前 PR 分支的代码改动，不代表 main 已部署。原始问题见 [场景审查](wechat-harness-review.md)，详尽的用例设计见 [自动化测试方案](wechat-harness-test-plan.md)。

## 已实现的能力

| 阶段 | 主要实现 | 文件 |
| --- | --- | --- |
| S0 基础设施 | 日期/单位/否定策略单测、结构化记忆和多步骤模拟、离线手动长测 | src/wechat-policy.mjs、src/wechat-memory.mjs、scripts/wechat-policy.test.mjs、scripts/harness-deep-e2e.mjs |
| S1 正确性 | 防止否定命令误写、日期和测量单位来源校验、宝宝上下文和默认收图冲突拒绝、五分钟同值重复检测、过敏信息追加 | src/wechat-policy.mjs、src/wechat-orchestrator.mjs、src/wechat.ts |
| S2 会话 | pending task、服务端查询结果 ID、最近照片批次、最近操作、取消、跨宝宝引用失效 | src/wechat-memory.mjs、src/wechat.ts |
| S3 多步与审计 | 一条消息最多四个工具调用、步骤级持久化回复、操作日志、条件撤销、照片与里程碑关联、编辑/删除/恢复事务审计 | src/wechat-orchestrator.mjs、src/wechat-operations.mjs、migrations/0013_wechat_harness.sql |
| S4 查询 | 日期区间、关键词检索、成长测量趋势汇总、限制查询结果数；单消息最多两个并行加密媒体上传流，处理耗时统计 | src/wechat-harness.mjs |

## 自动化与手动触发

- PR/main 快速 CI：Node 单测、独立本地 Worker、Chromium、Linux WebKit；不接触真实 OpenRouter、iLink、生产 D1/R2。
- 长时间离线专项：GitHub Actions 的 Manual Harness Deep E2E 选择 offline，或本机运行 npm run test:harness:deep；至少 240 组合成场景。不会自动触发。
- 真实模型专项：同一个手动工作流选择 live，或本机设置明确确认环境变量后运行 npm run test:harness:live；只发送虚构中文案例，可能计费，默认不运行。
- 现有 Manual OpenRouter Live E2E 保持 workflow_dispatch only。真实微信私聊、真 iPhone、生产恢复演练不自动化执行。

## 未完成或需要人工验证

1. 每条微信消息内媒体最多两个并行流，但 Durable Object 的外层轮询消息仍串行处理，大视频可能阻塞后续文字消息。**本 PR 未实现独立持久媒体消费队列**，避免直接并行带来乱序、重复回复和数据丢失。
2. 多工具步骤逐步持久化，并非跨 D1 和 R2 的全局原子事务。后续步骤失败需告知已完成内容；不能保证自动回滚。
3. 同一消息的创建依赖 source_message_id 幂等。不同消息的相同测量仅有限时短窗去重，不应禁止正常的一天多次测量。
4. 审计与撤销对编辑、软删除和恢复通过 D1 batch 执行条件写入；业务级的宕机与重放、审计竞态、跨客户端更改需要再做完整的本地 iLink/Worker 故障注入。
5. 日期词法校验、数值来源规则无法对所有中文混合表达给出形式化正确性保证。实际 OpenRouter 模型可否稳定返回多个 tool_calls 尚未通过手动模型测试。
6. 微信 iLink 是第三方协议；真实照片/视频、真机 HEIC/HEVC、移动网络和模型隐私政策均需人工审查。
7. D1 LIKE/日期检索只是结构化查找，不是语义向量检索。成长汇总最多读取 500 条有界测量。

## 发布前要求

必须先通过四组自动 CI，随后主动执行 manual offline 深测和指定真实模型的 live 合成回归。生产发布涉及新增 0013 增量迁移：务必先完成 D1/R2 备份和部署审查，不重建资源、不轮换 SESSION_SECRET 或 DATA_KEY。真实微信与 iPhone 测试结果需单独记录，不能用模拟通过替代。

新增方案测试 T-001～T-024 仍不能全部声明覆盖：现有新增快速单测是核心正确性样例，长测属于合成属性验证，不是完整的生产协议端到端验收。
