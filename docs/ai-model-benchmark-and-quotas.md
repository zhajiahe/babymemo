# AI 模型选型、统一 Benchmark 与 Cloudflare 免费额度

> 更新：2026-10-14。BabyMemo 当前生产默认 `@cf/qwen/qwen3.8-27b`（Workers AI、关闭思考）；可在「设置 → 微信 AI 模型」手动切回 OpenRouter。本文不包含任何家庭真实数据。

## 1. 三种额度完全独立

| 资源 | 免费计划 / 收费模式 | 本项目用途 | 额度用尽的影响 |
| --- | --- | --- | --- |
| [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) | **全 Cloudflare 账号共享，每天 10,000 Neurons 免费**，UTC 00:00 重置（北京时间 08:00）；Workers Paid 超额按 **$0.011 / 1,000 Neurons** 收费，且有 Workers Paid 基础订阅费 | `@cf/qwen/qwen3.8-27b` 推理、微信自然语言工具调用 | Free 达到当日 AI 额度后不能继续进行新推理；不会自动切至 OpenRouter |
| [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) | Workers Free 包含 **13,000 GB-s/天** 的 DO 时长配额，且有请求次数等其他限制，所有 DO 共享 | 微信 iLink 轮询、报警调度、D1 状态/消息处理 | 超额会导致 DO 请求/Alarm 失败，即使 Workers AI 还有大量 Neurons 也无法正常收到微信消息 |
| [OpenRouter](https://openrouter.ai/) | 独立的 OpenRouter 余额、模型单价与限流政策；不占 Workers AI 的 10k Neurons | 手动切换的备用服务和公平 Benchmark | OpenRouter 模型调用受其自身余额/限流影响，Cloudflare 的免费 Neurons 不能代付 |

**Cloudflare AI Gateway 第三方模型**（如 `anthropic/claude-haiku-5.5`）使用其独立的预付费 AI Gateway credits，**不是 Workers AI 免费 Neurons**。避免把免费托管模型、第三方统一支付和 Durable Objects 混淆。

Cloudflare Dashboard 中的 [Workers AI 用量](https://dash.cloudflare.com/?to=/:account/ai/workers-ai) 才是当天真实余额/用量依据；本项目没有读取 Cloudflare 管理 API 的长期凭证，也不在网页展示无法验证的“剩余额度”。在设置页手动点击 **测试当前模型** 本身也会消耗少量 Neurons 或 OpenRouter 调用费用，仅证明模型接口连通，不验证微信 iLink 是否收取消息。

## 2. Qwen3.8 的测量、预算与边界

[Qwen3.8-27B 模型信息](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/)：输入 **$0.45/百万 tokens**、输出 **$3.20/百万 tokens**（缓存输入另计）；Workers AI 平台仍以 Neurons 作为额度核算基础。

2026-10-14 已完成的 **10 个真实 Qwen 推理、虚构家庭工具结果** 的历史观察值：

- **9/10 任务达到当次预期**；第 1 项重复查询，未在设定轮数内结束；并非真微信完整端到端测试。
- **输入 41,562 tokens、输出 1,000 tokens、实际返回 1,991.17 Neurons**。
- 平均约 **199.1 Neurons/场景**，占全天 10,000 Neurons 的 **19.91%**；假设复杂度完全一样、没有其他项目用量，理论约 **50 场景/天**，不是保底或并发保证。
- 按当时官方标价折算约 **$0.0219 的推理等值成本**，**不等于产生收费账单**。若升级 Workers Paid，仍有免费额度及超出部分的账单规则。

注意：这 10 题测试使用的工具描述较简化，系统提示也略有差异，不可直接拿来与旧 Muse 的工具路由成绩比较。新 Benchmark 会统一工具定义和评分。

## 3. Durable Objects 的独立故障与风险

2026-10-13 Cloudflare DO 曾出现 `Exceeded allowed duration in Durable Objects free tier`，当日使用量接近/超过免费 13,000 GB-s。**这属于 DO duration 超额，不是 Workers AI Neurons 耗尽**。新模型部署、额度日重置或网站健康检查通过，均不保证已经故障的微信 DO Alarm 自动恢复。

当前 BabyMemo 的 DO 仍承担微信轮询以及一定的处理流程，网络等待和模型请求时间可能继续贡献 DO duration。即使模型 Qwen 免费推理成功，只要消息接收通道停止，微信仍不会得到回复。

降本与接收架构计划见 [微信 DO 预算](wechat-do-budget.md) 和 [微信轮询架构 ADR](wechat-transport-architecture.md)。需要另行完成普通 Worker 长轮询迁移、Alarm/游标修复以及真实微信验收。

## 4. Muse 旧记录 vs Qwen 旧记录（不是公平比较）

旧模型 **`meta/muse-spark-1.3-contributor`** 在 2026-10-13 的实际 OpenRouter 工具调用评估中：

- [5 场景](https://github.com/zhajiahe/babymemo/actions/runs/38332556011)：5/5。
- [16 场景](https://github.com/zhajiahe/babymemo/actions/runs/38358363103)：14/16。
- [60 轮](https://github.com/zhajiahe/babymemo/actions/runs/38345072426)：55/60，约 91.7%；**60 轮重复的是原先 16 种任务，而非 60 个不同任务**。
- 多次未完成的任务集中在“查询后更新过敏备注”及“查询后更正体重”。旧评分主要要求命中工具名，部分**重复查询也会判通过**。

旧 Qwen 的 9/10 成绩用不同场景、较简单的工具定义，并对最终回复提出要求。因此新旧结果不能直接做优劣或成本判断；它们仅作为已观察的基线事实保留。

## 5. 新的公平 Benchmark：相同 10 题、工具和评分

`scripts/model-benchmark-cases.mjs` 定义十道虚构家庭微信任务；`scripts/model-benchmark.mjs` 采用生产使用的**同一套完整 `wechatTools` schema**、同一条中文 system prompt、模拟工具结果与 ReAct 引擎，单次最多 4 轮及 8 次工具调用；从真实模型响应中记录：

- 任务成功率；不仅检查调用了目标工具，还检查**查询→修改/恢复的顺序**、更改值、已查询到的真实记录编号、禁止的写入和重复调用。
- 是否返回可用的**模型自然语言最终回复**（不能将回退/轮数不足或原始工具 JSON 算作完成）。
- 模型请求次数、每题耗时、输入/输出 tokens，以及 Workers AI 的实际 `usage.neurons`；OpenRouter 只有提供 `usage.cost` 时才显示“报告的美元费用”，没有就为“未报告”，**绝不填 0 冒充免费**。
- 每题是否符合预期、错误类型；所有 D1/R2 增删改查都只在内存中返回虚构观察，**零生产家庭记录读取或写入**。

两家服务端部署参数**不完全相同**：Qwen 使用 `enable_thinking=false`、`temperature=1`；Muse 沿用 OpenRouter Harness `temperature=0`。这是一项**真实生产配置下的任务表现对比**，并非控制所有采样因素的纯模型能力科学实验。

目前这套统一题库**没有运行过付费/真实模型两模型对照**，其结果应该由新的 GitHub Actions 人工触发产生，不能沿用 9/10 与 14/16 拼凑“10 题对比”。

## 6. 如何从 GitHub Actions 手动运行

进入 GitHub 仓库 **Actions → Manual Harness Deep E2E → Run workflow**，选 `mode=live`，指定：

1. `provider=both`（或者只运行 `workers-ai` / `openrouter`）。
2. `repetitions=1`：每种模型 10 题；可设为 3 做每题三次复测。
3. `max_neurons`：Workers AI 消耗预算软上限（默认 **3,000**）；`max_usd`：OpenRouter 返回费用的累计软上限（默认 **$0.10**）。
4. `model_id=meta/muse-spark-1.3-contributor`（默认旧 Muse）。
5. 显式选择 `confirm_live=true` 才会进行真实推理。未确认会拒绝启动，**不会自动测试、自动充值或生产部署**。

Actions 使用仓库 `production` Environment 的 GitHub Secrets `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 和 `OPENROUTER_API_KEY`。工作流把每模型成绩写入 Run Summary，详细 JSON 结果保留 **7 天 Artifact**。如果没有正确 Secret，工作流直接失败，不会降级成只模拟的模型得分。

**预算是软上限，不是硬账单封顶**：额度检查在每次请求前按已收到的用量进行，最后一笔请求可以超出限额；并且 OpenRouter 若不返回 `usage.cost`，脚本无法可靠控制其美元费用。真正的账单限制应在云端提供方设置。

命令行：

```sh
MODEL_BENCH_CONFIRM=YES MODEL_BENCH_PROVIDER=both \
MODEL_BENCH_REPETITIONS=1 MODEL_BENCH_MAX_NEURONS=3000 \
MODEL_BENCH_MAX_USD=0.10 \
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
OPENROUTER_API_KEY=... npm run test:model:benchmark
```

不要将凭证、家庭记录或账号账单放进 PR、截图或公开 Artifacts。普通 `npm run verify` 只执行离线回归，完全不访问第三方模型。

## 7. 当前设置页的可见信息

- 直接展示当前**生效**的模型、服务商和是否关闭思考；支持折叠打开 OpenRouter Key/模型 ID 配置。
- **尚未保存的模型变更不能测试**：先保存，再点“测试当前模型”，防止 UI 选择 Qwen 却实际测试数据库里已保存的 OpenRouter。
- 测试反馈会验证 `ok` 和回传的提供方，并且标注“只测试模型接口”。
- 微信成员下方另外显示实际**最近轮询状态**，不把“已启用”误认为“连接健康”。
- 不显示未接入 Cloudflare 管理 API 的实时 Neurons 剩余量。
