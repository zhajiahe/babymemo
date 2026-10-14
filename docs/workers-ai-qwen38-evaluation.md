# Qwen3.8-27B 作为 BabyMemo 微信默认模型：实测与迁移

> 2026-10-14 · 本变更**尚未合并/部署**；不读取或写入生产家庭记录。
> 与旧的 `anthropic/claude-haiku-5.5` 不同，本方案使用 **Cloudflare-hosted Workers AI**，无需 AI Gateway 充值或 OpenRouter Key。

## 接入决策

默认 `@cf/qwen/qwen3.8-27b`，保留 OpenRouter 为可选手动切换的提供方。使用 `wrangler.jsonc` 的 `"ai":{"binding":"AI"}` 和 `env.AI.run()` 调用模型，沿用原有 `runWechatAgentLoop`、工具定义、决策写前日志及 D1/R2 权限，不增加新的 MCP 服务器、外部调用或 Vercel AI SDK 依赖。用户提供的 MCP + `streamText` 示例是可选调用方式，BabyMemo 已有完备内部工具闭环，无须引入外部 MCP 权限。

```ts
await env.AI.run('@cf/qwen/qwen3.8-27b', {
  messages,
  tools,
  tool_choice: 'auto',
  parallel_tool_calls: false,
  temperature: 1,
  max_completion_tokens: 1200,
  chat_template_kwargs: { enable_thinking: false },
  reasoning_effort: 'low'
});
```

**关闭思考**：Cloudflare 当前 [模型 schema](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/) 把 `reasoning_effort` 规定为 `low|medium|xhigh`，不允许 `none`；但 `chat_template_kwargs.enable_thinking=false` 是明确提供的关闭思考开关。因此后者为实际控制，前者用 `low` 作为保守值。需以真实模型输出与用量验收。

**设置与向后兼容**：新增 `ai_provider` 偏好，默认 `workers-ai`。设置页可切至 `openrouter` 使用现有加密 Key、模型 ID，所有既有 Key/配置继续保存，但不再成为默认入口。微信连接不再强制必须配置 OpenRouter Key 才能启用。提供当前模型测试接口，测试 Worker AI 会消耗少量 Neurons。

**基础设施与可靠性**：配置 AI Binding 不会修复微信 DO Alarm 因额度耗尽而停止的问题。当前模型调用仍发生在处理微信批次的 DO 上，等待模型可能继续消耗 DO duration。需要另行按 `docs/wechat-transport-architecture.md` 实施 Worker 处理链路与 DO 只负责状态提交，生产切换前重点回归微信能否实际回复。若 Workers AI 免费额度不足，必须显示明确错误，不能静默重复执行有副作用的工具。

## Cloudflare 官方配额与价格

- Workers AI Free 每天 **10,000 Neurons**（00:00 UTC 重置，所有使用该账号 Workers AI 的项目共享）。
- Qwen3.8-27B 价格：**每百万输入 tokens $0.45、输出 $3.20、缓存输入 $0.05**。账户若仍在免费额度内可以使用模型；不代表免费请求不限量。
- 模型支持工具调用、视觉、262,144 tokens 上下文。参见 [模型介绍](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/) 和 [Workers AI 定价](https://developers.cloudflare.com/workers-ai/platform/pricing/)。

## 2026-10-14：10 个真实模型推理的虚构微信场景

这不是 mock 模型：测试中向 Cloudflare 的 `/ai/run/@cf/qwen/qwen3.8-27b` **确实发出了真实推理请求**，关闭了 thinking，并取回真实的 `usage.neurons`。但测试使用约 20 个与 BabyMemo 内部工具同名、简化描述的函数 schema，并对工具提供**虚构结果**，没有真正执行 BabyMemo D1/R2、媒体上传或微信 Bot；因此结果仅证明 Qwen 的工具路由与对话能力，**不是完整线上应用 E2E**。第 1、2 场景与其余 8 场景的系统提示词略有区别。

| # | 场景 | 模型实际选择的工具 | 输入 tokens | 输出 tokens | Neurons | 结果 |
| -- | -- | -- | --: | --: | --: | -- |
| 1 | 查询最近体重 | `get_runtime_context → list_growth → list_growth` | 5,513 | 88 | 251.13 | **未完成最终回复**（3 轮内重复查询） |
| 2 | 新增身高体重 | `create_growth` | 3,712 | 133 | 190.55 | 通过 |
| 3 | 新增里程碑 | `create_milestone` | 3,800 | 105 | 186.00 | 通过 |
| 4 | 查询成长瞬间 | `list_milestones` | 3,743 | 80 | 176.40 | 通过 |
| 5 | 区间体重汇总 | `growth_summary` | 3,818 | 119 | 190.81 | 通过 |
| 6 | 先查再改 | `list_growth → update_growth` | 5,838 | 141 | 279.85 | 通过（正确读后写） |
| 7 | 否定写入 | 无工具调用 | 1,848 | 21 | 81.71 | 通过（无数据修改） |
| 8 | 相册查询 | `list_media` | 3,767 | 118 | 188.43 | 通过 |
| 9 | 最近照片日期 | `update_recent_media` | 3,757 | 58 | 170.57 | 通过 |
| 10 | 查询并恢复 | `list_trash → restore_trash` | 5,766 | 137 | 275.74 | 通过 |

- **10 场景通过 9 个**，未通过 1 个，不能宣传“10/10 全通过”。其中全部写入为合成的工具成功观察结果，**没有实际执行数据库写入**。
- 模型累计 **输入 41,562 tokens、输出 1,000 tokens、1,991.1726 Neurons**。这只是这 10 个场景的用量，不含之前 `OK` 与单工具试探请求（额外用了约 25 Neurons）。
- 按官方 tokens 公示价换算，`41562 × 0.45 / 1e6 + 1000 × 3.20 / 1e6 ≈ $0.02190` 等值推理费用。免费额度实际剩余/扣费应以 Cloudflare Dashboard 账单为准。
- **消耗免费日额约 19.91%**：这类多工具、多轮对话并不便宜，不能按“每天能免费处理数百条复杂微信指令”宣传。在相同复杂度下约只能跑 `10000 / (1991/10) ≈ 50` 个场景，具体取决于工具列表、上下文增长、并发和其他账号调用。
- **第 1 条异常**：重复调用 `list_growth` 且三轮内未完成最后一条自然语言回答，未来需测试真实工具结果和长对话上下文下的继续/终止边界，并记录是否重复请求；禁止为了得到看起来更高的通过率而跳过失败案例。

## 可重复的生产隔离测试与验收

`scripts/qwen38-live-e2e.mjs` 是**手动**付费/额度消耗测试（无自动执行），直接加载实际 `wechatTools` 和 `runWechatAgentLoop`，走 REST 相同模型，仍只模拟工具返回。运行方式：

```sh
QWEN38_LIVE_CONFIRM=YES \
QWEN38_MAX_NEURONS=3500 \
CLOUDFLARE_ACCOUNT_ID=... \
CLOUDFLARE_API_TOKEN=... \
node scripts/qwen38-live-e2e.mjs
```

它统计每条场景的 modelRequests/inputTokens/outputTokens/neurons，限制 50 次模型请求，耗尽本地预算后停止；**这是软限额，不替代 Cloudflare 平台级额度控制**。所有密钥必须只保留在本机私有环境变量，不提交到 GitHub。

另有 `scripts/qwen-workers-ai.test.mjs` 离线单测：模型参数必须关闭思考、默认路由正确、ReAct 工具执行与真实工具观察转发正确、无 AI binding 时明确报错、限额异常屏蔽底层消息。离线测试不是新增的真实模型测试。

## 上线前必须满足

- [ ] TypeScript、完整 unit/Worker/browser CI 均通过。
- [ ] 网页设置默认显示 Workers AI，用户不用 OpenRouter Key 能正常启动微信连接；可选 OpenRouter 切回。
- [ ] 首次发送消息（DO Alarm 正常时）能够真实收取、调用 Qwen、执行有限工具并回复；不要通过在线家庭数据做破坏性测试。
- [ ] 测试较长的多轮对话、模型重复工具调用、429/配额不足、空模型答复、网络超时、DO Alarm 重启。
- [ ] 监控 Neurons 和 DO duration，尤其模型调用仍运行在 DO 的现有架构限制。只有经过真实微信验收后才适合正式部署为生产默认。
