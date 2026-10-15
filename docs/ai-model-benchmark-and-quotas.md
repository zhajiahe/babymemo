# 模型配置、额度与 Benchmark

**生产默认**为 Cloudflare Workers AI `@cf/qwen/qwen3.8-27b`，OpenRouter 是可在设置中手动启用的可选提供方（其默认模型 ID 为 `deepseek/deepseek-v4.1-flash`）。模型配置、实际 Key 优先级以代码和 [部署指南](github-action-deploy.md) 为准。

## 成本边界

Workers AI Neurons、Durable Objects duration、OpenRouter 美元余额是**三套独立额度**，不可互换。最新定价与限制直接查：[Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) · [Qwen 模型](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/) · [OpenRouter](https://openrouter.ai/)。

不要根据单次评测推断「一天可用多少次」。微信不回复也可能是消息接收链路故障，而非模型调用失败。网页不声称能实时读取 Cloudflare 剩余额度；「测试当前模型」会消耗额度且只证明模型接口可达。

## 运行对比（以 Actions 为事实来源）

[Manual Harness Deep E2E](https://github.com/zhajiahe/babymemo/actions/workflows/harness-deep-e2e.yml) 只有 `workflow_dispatch` 手动入口，不随 push、PR 或定时任务调用真实模型。

1. `mode=offline`：本地确定性合成场景，不调用真实模型。
2. `mode=live` 且 `confirm_live=true`：选择 `provider=openrouter` / `workers-ai` / `both`。OpenRouter 通过 `model_ids` 指定 1–6 个模型（留空使用 `model_preset`）；`repetitions` 选择 1 或 3。
3. 每个真实模型在独立 Matrix Job 中执行 **V2 相同 30 条虚构家庭任务**（含照片后的独立文字、多轮确认、切换宝宝与失败回执）。评分同时检查工具、参数、拒绝误写及回答事实。题目使用生产微信系统提示词，但历史消息和工具结果均为合成数据，**不访问真实微信、D1 或 R2**；真实媒体时序、上传并发和重放由独立 Worker E2E 验证。
4. `max_usd` 和 `max_neurons` 是**每个 Job 的软阈值**，不是硬封顶；实际费用以提供商账单或有报告的 `usage.cost` 为准，缺失费用数据不得写成零。
5. Run Summary、Job Logs 和 JSON Artifacts 是成绩、用量、失败原因与逐题轨迹的**唯一结果存放处**；比较 Artifact 名为 `baby-model-benchmark-comparison`，默认保留 7 天。失败的认证/权限请求不是模型答错。

工作流所需 Secrets：OpenRouter 使用 `OPENROUTER_API_KEY`；Workers AI REST 评测使用 `CLOUDFLARE_ACCOUNT_ID` 和有 Workers AI 权限的 `CLOUDFLARE_AI_API_TOKEN`（普通部署 Token 可能无权推理）。日志、报告只用合成信息，不包含任何真实 Key。

V2 使用独立版本号和固定用例集合指纹；旧版成绩不得与 V2 通过率直接比较。具体成绩及费用以该次 Actions Run 和平台账单为准，文档不保留历次结果快照。

离线验证：`node --test scripts/model-benchmark.test.mjs scripts/model-benchmark-matrix.test.mjs scripts/openrouter-retry.test.mjs`。评测实现见 `scripts/model-benchmark.mjs` 和 `scripts/model-benchmark-cases.mjs`。
