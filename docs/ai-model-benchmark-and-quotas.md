# AI 模型选型、统一 Benchmark 与 Cloudflare 免费额度

> 更新：2026-10-14。当前手动 Benchmark 为 **30 题、1~6 个 OpenRouter 模型并行矩阵、优先关闭推理（拒绝时回退最低档）**；文中历史 10 题成绩不代表新题库成绩。BabyMemo 当前生产默认 `@cf/qwen/qwen3.8-27b`（Workers AI、关闭思考）；可在「设置 → 微信 AI 模型」手动切回 OpenRouter。本文不包含任何家庭真实数据。

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

## 5. 新的公平 Benchmark：相同 30 题、工具和评分

`scripts/model-benchmark-cases.mjs` 定义三十道虚构家庭微信任务；`scripts/model-benchmark.mjs` 采用生产使用的**同一套完整 `wechatTools` schema**、同一条中文 system prompt、模拟工具结果与 ReAct 引擎，单次最多 4 轮及 8 次工具调用；从真实模型响应中记录：

- 任务成功率；不仅检查调用了目标工具，还检查**查询→修改/恢复的顺序**、更改值、已查询到的真实记录编号、禁止的写入和重复调用。
- 是否返回可用的**模型自然语言最终回复**（不能将回退/轮数不足或原始工具 JSON 算作完成）。
- 模型请求次数、每题耗时、输入/输出 tokens，以及 Workers AI 的实际 `usage.neurons`；OpenRouter 只有提供 `usage.cost` 时才显示“报告的美元费用”，没有就为“未报告”，**绝不填 0 冒充免费**。
- 每题是否符合预期、错误类型；所有 D1/R2 增删改查都只在内存中返回虚构观察，**零生产家庭记录读取或写入**。

**高难度扩展（第 21–30 题）**：同句矛盾测量选择最终实测、斤转千克与日期归一、汇总→查询→定向更正、同日两条测量 ID 消歧、相册描述中的 prompt injection、两类记录使用同一搜索工具进行两次不同参数筛选、无匹配时禁止删除、只修改里程碑日期、回收站按类型和 ID 精确恢复、跨里程碑与相册的条件写入。这些题目除了工具名称，还检查输入参数、先查后改顺序、禁止冗余写入、必需事实以及重复调用。相关数据全部是隔离的合成观察，不依赖真实用户记录。

两家服务端部署参数**不完全相同**：Qwen 使用 `enable_thinking=false`、`temperature=1`；Muse 沿用 OpenRouter Harness `temperature=0`。这是一项**真实生产配置下的任务表现对比**，并非控制所有采样因素的纯模型能力科学实验。

### 2026-10-14 首次同题实测结果

[Manual Harness Deep E2E #38511146287](https://github.com/zhajiahe/babymemo/actions/runs/38511146287) 已人工触发，使用真实模型及虚构工具观察：

- **Muse Spark 1.3 Contributor：10/10 完成**，23 次模型请求，输入 63,728 tokens、输出 6,618 tokens；OpenRouter 实际报告成本约 **$0.006449252**。
- **Qwen3.8：未测出成绩**。GitHub Actions 部署 Token 访问 Workers AI REST API 连续返回 `10000`（认证／权限不足），推理成功 **0 次**、没有有效的 Qwen 测试样本。**不是模型 0/10 答错，也不能据此声称模型免费额度用完。**
- 该次对比因此不能判定 Muse 比 Qwen 更强。生产 Worker 使用 `env.AI` Binding，和 GitHub 的 REST Token 权限不同。

## 5.1 新增 DeepSeek V4.1 Flash（2026-10-14）

[OpenRouter DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash) 的准确模型 ID 为 `deepseek/deepseek-v4.1-flash`，标价参考输入 **$0.13/M tokens**、输出 **$0.52/M tokens**；路由提供方可能有差异，实际以 OpenRouter `usage.cost` 为准。模型支持工具调用与推理控制。

**关闭思考**：OpenRouter Chat Completions 支持 `"reasoning":{"enabled":false}`，BabyMemo 的 OpenRouter 客户端在选择 **DeepSeek V4.1 Flash** 时默认发送这个参数；Muse 不受影响，保持原有采样配置。旧版 Benchmark 曾可选择推理模式；**新版测试固定请求 `reasoning.enabled=false`**。只有上游明确拒绝关闭时，才重试一次最低推理档位（通常为 `low`，GPT-6 Luna 为 `minimal`）。生产端的原有 Muse 自动推理配置不变。`reasoning.enabled=false` 是**接口请求配置**，只有真实模型成功返回并确认用量中 `reasoning_tokens=0`（若提供）才能验证该次调用的推理开销；未报告推理 tokens 不自动视为 0。

**当前状态**：已准备代码和手动测试入口，**尚未实际运行 DeepSeek 的 10 题**。不得虚构准确率或费用，也不应为这项测试修改 BabyMemo 线上默认模型。

## 5.2 OpenRouter 模型统一优先 Relace，可自动回退（2026-10-14）

**统一 Provider 路由**：所有 OpenRouter 模型（包括自定义 ID、Muse、DeepSeek、GPT-6 Luna、Haiku）统一使用 `provider: {order: ['relace'], allow_fallbacks: true}`：若 Relace 能提供该模型且满足请求条件则优先选用；若 Relace 不支持、不可用或拒绝请求，OpenRouter 允许按其路由策略改用其他提供同**一个模型**的服务商。**不使用 `only`，也不进行跨模型回退**。其他服务商可能具有不同价格、延迟和行为，实际费用以 OpenRouter 返回的用量为准。

**默认模型**仍为 `deepseek/deepseek-v4.1-flash`，默认优先 `reasoning.enabled=false`；Muse 保留为手动可选。原有用户保存的模型 ID 不受影响；无 `ai_provider` 偏好的用户仍默认使用 Workers AI Qwen。如需切换已有生产 Muse 配置，可在设置页手动修改。


| OpenRouter 模型 ID | 服务商选择 | 思考设置 |
| --- | --- | --- |
| `deepseek/deepseek-v4.1-flash` | 优先 Relace，可自动回退其他提供方 | 优先 `reasoning.enabled=false` |
| `openai/gpt-6-luna` | 优先 Relace，可自动回退其他提供方 | 优先关闭；若上游明确拒绝关闭思考，自动重试一次 `reasoning.effort='minimal'` |
| `anthropic/claude-haiku-5.5` | 优先 Relace，可自动回退其他提供方 | 优先关闭；若上游明确拒绝关闭思考，自动重试一次 `reasoning.effort='low'` |
| `meta/muse-spark-1.3-contributor` | 优先 Relace，可自动回退其他提供方 | 保持以前默认请求参数 |

参见 [OpenRouter Provider 排序与回退说明](https://openrouter.ai/docs/guides/routing/provider-selection)、[DeepSeek 服务商列表](https://openrouter.ai/deepseek/deepseek-v4.1-flash/providers)、[GPT-6 Luna](https://openrouter.ai/openai/gpt-6-luna)、[Haiku 5.5](https://openrouter.ai/anthropic/claude-haiku-5.5) 和 [OpenRouter 推理配置](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)。

兼容性重试**只**在服务商返回与 `reasoning` 参数直接相关的 HTTP 400 时发生；认证错误、工具参数错误、余额不足、一般模型错误不重试，并限制最多一次。若实际输出 `reasoning_tokens>0` 且没有发生合法最低思考回退，Benchmark 将标为思考配置未生效；**缺少该字段不等于零思考**。实际最低思考回退状态、请求首选 Provider 与服务商实际返回的 Provider 信息（若上游提供）将写入日志和 JSON Artifact。Provider 回退由 OpenRouter 服务端处理，**不保证 Relace 支持所有模型，也不保证每个响应都报告真实服务商**。

**目前新增两款模型尚未实测**。测试入口为 GitHub Actions 的 `Manual Harness Deep E2E`，只发送虚构家庭指令，不读写真实数据，也不更改默认 Qwen 模型。留空 `model_ids` 则使用单个 `model_preset`；填写 1–6 个模型 ID 则并行评估。

## 5.3 更丰富、可审计的 Actions 日志

- 每条场景开始/结束：`provider/model/caseId/iteration`、通过与否、实际工具调用顺序、模型轮数、时延、输入/输出和推理 tokens、Neurons / USD、简短最终回答。
- 每次真实模型请求的前后：模型、场景、消息与工具数量、思考开关、完成原因、返回的工具名与 tokens；每个模拟工具执行打印工具名、有限长度参数和拒绝原因。
- Cloudflare REST 认证返回 `10000`、OpenRouter 401/402 等明确权限或支付错误时，**立即停止该模型作业的后续场景，其他模型作业独立继续**，减少无意义模型调用和误导性 0% 成绩。保留 JSON Artifact，Run Summary 中显示**逐题表格**。
- 日志只处理虚构家庭测试数据；不打印 API Key、HTTP Authorization 头或原始上游响应体；长文本截断并过滤类似凭证的值。


## 6. 如何从 GitHub Actions 手动运行 30 题并行模型对比

进入 GitHub 仓库 **Actions → Manual Harness Deep E2E → Run workflow**。该工作流只有手动入口，没有 push、PR、cron 或部署触发。

1. 设置 `mode=live`，`provider=openrouter`（或 `both`，另测 Qwen Workers AI）；`confirm_live=true` 才会调用真实接口，未确认不推理。
2. 要测试多个 OpenRouter 模型，填写 `model_ids`，例如 `deepseek/deepseek-v4.1-flash, meta/muse-spark-1.3-contributor, openai/gpt-6-luna`。支持逗号、空格、换行分隔，自动去重，**最多 6 个**。留空时使用单个 `model_preset`；选择 `workers-ai` 时忽略 OpenRouter 模型列表。
3. 每个模型在独立的 GitHub Actions Matrix Job 中并行执行**相同 30 题 × repetitions 次**，使用同一生产工具 schema、系统提示、模拟工具观察与评分器。每模型分开计费、分开记录失败，不能把某个模型的认证失败当作模型得分 0%。
4. **OpenRouter 思考固定优先关闭**：发送 `reasoning.enabled=false`。只有模型服务商以明确的关闭推理不支持错误拒绝时，才重试一次 `effort=low`（GPT-6 Luna 的最低档 `minimal`）。回退详情以及实际上报的 reasoning tokens 均在报告；没有 token 字段不代表实际为 0。
5. `max_usd`（默认 $0.10）是**每个 OpenRouter 模型作业**的用量软阈值，不是所有模型合计；同时测 3 个模型时，理论软预算可达 $0.30 以上。`max_neurons` 是 Workers AI 作业单独的软阈值（默认 6,000）；OpenRouter 不消耗 Workers AI Neurons。
6. 每个模型的 JSON artifact 单独保留 7 天；`compare` Job 汇总各模型的通过率、工具轨迹、tokens、报告美元费用以及逐题结果，产出 `baby-model-benchmark-comparison`。若某模型没有产出结果，汇总会明确标为缺失，而不是算作失败的 30 题。

所需 Secrets：`OPENROUTER_API_KEY`；当包含 Workers AI 时还需 `CLOUDFLARE_ACCOUNT_ID`、推荐独立 `CLOUDFLARE_AI_API_TOKEN`（Account → Workers AI → Read），可尝试 `CLOUDFLARE_API_TOKEN` 但部署令牌可能无 AI REST 权限。选择 `provider=openrouter` 不需要 Workers AI 凭据。测试只使用虚构宝宝和模拟工具结果，不接触真实家庭 D1/R2/微信数据。

**费用限制不是账单硬封顶**：最后一次请求仍可超出阈值，OpenRouter 未返回 `usage.cost` 时无法准确统计美元支出；模型间同时请求也会受到模型服务商的并发/429 限制。真正硬限制应配置在服务商账户。多模型整体花费上限不能由目前各作业的软阈值保证。

本地仅测试一个模型：

```sh
MODEL_BENCH_CONFIRM=YES MODEL_BENCH_PROVIDER=openrouter \
MODEL_BENCH_OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash \
MODEL_BENCH_REASONING_MODE=off MODEL_BENCH_MAX_USD=0.10 \
OPENROUTER_API_KEY=... npm run test:model:benchmark
```

本地离线断言（不会消耗模型 credits）：`node --test scripts/model-benchmark.test.mjs scripts/model-benchmark-matrix.test.mjs scripts/openrouter-retry.test.mjs`。无需也不应在 PR 中写入真实凭证。

## 7. 当前设置页的可见信息

- 直接展示当前**生效**的模型、服务商和是否关闭思考；支持折叠打开 OpenRouter Key/模型 ID 配置。
- **尚未保存的模型变更不能测试**：先保存，再点“测试当前模型”，防止 UI 选择 Qwen 却实际测试数据库里已保存的 OpenRouter。
- 测试反馈会验证 `ok` 和回传的提供方，并且标注“只测试模型接口”。
- 微信成员下方另外显示实际**最近轮询状态**，不把“已启用”误认为“连接健康”。
- 不显示未接入 Cloudflare 管理 API 的实时 Neurons 剩余量。
