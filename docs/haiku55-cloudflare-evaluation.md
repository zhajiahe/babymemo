# ADR：Claude Haiku 5.5 作为 BabyMemo 默认模型的预备验证

> 2026-10-14 · 状态 **Blocked — AI Gateway 无余额，尚未做任何成功的 Haiku 推理** · 这份 PR **不切换当前生产默认模型**，也不自动部署。

## 已确认的模型与计费方式

- 模型 ID：`anthropic/claude-haiku-5.5`。官方 [模型页面](https://developers.cloudflare.com/ai/models/anthropic/claude-haiku-5.5/) 明确标为 **Third-party**，输入格式是 **Anthropic Messages**，可用 `env.AI.run('anthropic/claude-haiku-5.5', ...)` 或 Cloudflare 统一 `/ai/run` 路由。**不是 Cloudflare-hosted `@cf/...` Workers AI 模型**。
- 使用 Cloudflare [AI Gateway Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/) 的**预付费余额**，不占 Workers AI 每天免费 10,000 Neurons。
- 短上下文标价：输入 **$0.10/M tokens**、输出 **$0.50/M tokens**、缓存读取 **$0.01/M tokens**、缓存写入 **$0.125/M tokens**。长上下文：输入 $0.50/M、输出 $2.50/M；跑本项目的短对话测试应避免超过长上下文门槛。
- 充值账户还会有 Cloudflare **5% 购买手续费**（比如购买 $5 credits，信用卡收费 $5.25），本地按 tokens 估算的 provider 费用**不包括**该次充值手续费。以 Cloudflare 实际 Usage/Invoice 为准。
- **2026-10-14 账号检查**：Cloudflare AI Gateway 余额 **$0.00**、首次充值未完成。用纯虚构的 `只回复 OK` 请求尝试 `/ai/run`，Cloudflare 返回 **Error 2021: Insufficient balance; add money to your gateway or use BYOK**。这次尝试未成功推理，无法得到 provider `usage`。

## 本 PR 新增内容与真实测试边界

- `src/haiku-gateway.mjs`：纯函数的 **OpenAI Chat Completions ↔ Anthropic Messages** 适配层，用于复用原微信 ReAct Harness 的 assistant/tool-call/工具观察。工具选型结果仍须先经现有 write-ahead journal 保存后才能执行。
- `scripts/haiku-gateway.test.mjs`：**10 个 fixture/mock 的家庭微信场景**，包括查询、新增、里程碑、先查后改、删除、否定输入、估计值拦截、相册查询、刚发图片日期更正、回收站恢复。仅验证协议转换与现有 Harness 对**预先写死的模型响应**能否安全运行；没有调用 Haiku，没有真实额度消耗；**不得宣称测试了模型准确率**。
- `scripts/haiku55-live-e2e.mjs`：充值后**人工执行**的真实 Haiku 模型测试，同样取十种虚构场景，向真实 Cloudflare `/ai/run` 发起请求，使用同一套工具定义、ReAct 循环与**模拟工具反馈**（绝不访问家庭 D1/R2、发送真实微信、修改云端数据）。按请求累加 provider 返回的 input/output/cache tokens，并输出按官方短上下文单价估算的美元成本及工具匹配率。
- 只有明确设置 `HAIKU55_LIVE_CONFIRM=YES` 时才允许付费实测；不进入 CI、没有自动充值、最多 60 次模型请求、按 `HAIKU55_MAX_USD` 指定的本地累计费用软上限（非 Cloudflare 网关硬预算，可能因单次请求超过阈值）。建议 Cloudflare AI Gateway 同时设置**网关级 Spend Limit**，以防止高于预计的费用。

### 十个场景（目前全为合成，非实际模型测试结果）

| # | 用户测试输入（均使用虚构“测试宝宝”） | 预期模型选择 |
| -- | -- | -- |
| 1 | 查最近五次体重记录 | `list_growth` |
| 2 | 今天体重 10.5kg、身高 82cm，帮我记录 | `create_growth` |
| 3 | 今天第一次独立走五步，记成里程碑 | `create_milestone` |
| 4 | 查最近的里程碑 | `list_milestones` |
| 5 | 汇总 10 月 1–10 日体重变化 | `growth_summary` 或 `list_growth` |
| 6 | 把昨天 10.5kg 先查出再更正为 10.2kg | `list_growth` → `update_growth` |
| 7 | 不要保存，10.5kg 只是估计 | **不得执行写入** |
| 8 | 看 10 月 1 日的照片 | `list_media` |
| 9 | 将刚发送照片的拍摄日期更正为昨天 | `update_recent_media` |
| 10 | 从回收站查找并恢复 10 月 1 日的体重 | `list_trash` → `restore_trash` |

离线 fixtures 的 10 组输出全部由代码中构造的 `tool_use` / `text` 响应驱动；**即使 10/10 测试通过，也不能说明 Haiku 5.5 的模型实测通过率是 100%**。

## 本次实际额度记录

| 指标 | 实际 |
| -- | -- |
| 真实 Cloudflare Haiku 请求尝试 | 1 次 |
| 真实 Cloudflare Haiku **成功**推理 | **0 次** |
| 计划真实场景测试 | 10 次，**0 次完成** |
| Gateway 响应 | `2021 Insufficient balance` |
| 当前可归因于本次成功推理的 tokens | **0；无 usage 返回** |
| Workers AI 免费 Neurons | **0**（本模型不使用这一额度） |
| 本次成功模型推理费用 | **$0.00**；没有可结算的 tokens 记录 |

不能通过离线生成 10 组假模型输出来推断“真实”用量。以下只是**计划预算示例**，不作为实测：假设每个案例总计调用 2 次、总输入 4,000 tokens、总输出 500 tokens；十例合计约 40,000 输入、5,000 输出 tokens，按短上下文价约 **$0.0065**，但复杂工具任务可能有更多调用、思考/缓存开销或长上下文收费。

## 充值后如何手动完成正式验收

1. 在 Cloudflare 的 [AI Gateway Billing](https://dash.cloudflare.com/?to=/:account/ai/ai-gateway) 购买 credits，建议少量充值并设置 Gateway Spend Limit。账户余额必须实际显示大于零。
2. 在**本地机器**配置 `CLOUDFLARE_ACCOUNT_ID`、权限受限的 `CLOUDFLARE_API_TOKEN` 和 `HAIKU55_LIVE_CONFIRM=YES`；不得提交 token，也不得把控制台日志公开展示给外部人员。
3. 执行 `HAIKU55_MAX_USD=0.10 node scripts/haiku55-live-e2e.mjs`；脚本输出每个案例真实模型请求数、各类 tokens 和估算美元成本。拿 Cloudflare Billing/Logs 对账并审查工具行为。
4. **Go/no-go**：真实十例至少 8/10 符合预期，且未发生未经授权的数据写入、错误工具参数、模型凭空宣称已成功提交；测试正常结束并能统计 tokens；再做独立灰度 PR 设置 Haiku 为**新安装默认模型**，现有用户 OpenRouter 选择不强制覆盖，失败能显式切换回 OpenRouter。
5. 切换前继续修复 DO Alarm 恢复机制：即使模型切换，**轮询不应长期占用 DO 等待时长**。更换模型不能解决原先 DO 免费额度耗尽故障。

## 当前生产状态

BabyMemo 正式网站仍使用原有 `meta/muse-spark-1.3-contributor`（OpenRouter）及已配置模型。**不能在 Cloudflare AI Gateway 余额为零时直接将 Haiku 5.5 部署为唯一默认模型**，否则真实微信指令将返回无法推理。
