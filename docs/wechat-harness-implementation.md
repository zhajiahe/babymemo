# 微信 Harness：当前行为与安全边界

当前链路为 **iLink → Durable Object → 有界 ReAct → 服务端白名单工具 → D1/私有 R2**。默认使用 Workers AI Qwen，可选 OpenRouter；模型无任意 SQL、代码执行或公开媒体链接权限。

## 消息与执行

- `src/wechat.ts` 负责成员绑定、消息去重和回复；`src/wechat-agent-loop.mjs` 最多 4 次模型决策、8 次工具调用、90 秒软预算，工具结果以 `role=tool` 反馈模型。
- `src/wechat-harness.mjs` / `src/wechat-orchestrator.mjs` 只执行授权工具；`src/wechat-memory.mjs` 保存同连接短期上下文（最多 20 轮、20 分钟（按上下文预算裁剪））。模型负责自然语言理解与规划，**不是**模型拥有数据库写权限。
- 决策先使用 `DATA_KEY` 加密写入 D1 `wechat_agent_rounds`，再执行稳定步骤 ID 对应的工具。重放复用已保存决策；写入还依赖业务幂等。部分步骤成功后发生失败，不假称全局回滚。
- `src/wechat-context-snapshot.ts` 从当前宝宝、D1 记录、lastQuery/lastMedia 及上传状态生成带来源与时间的可信快照；消息开始冻结引用，后续每次工具调用重新读取快照并只回传给 Agent。查询本身不是修改授权。
- `src/wechat-capabilities.ts` 是媒体元数据能力的共享判断：`processing` 已有占位记录，可改描述和归档日期但不能声称原文件已保存；`ready` 可编辑且原件已保存；`failed` 不可编辑。工具查询、快照和写入条件共用此语义。明确设置的拍摄日期在原件上传完成时不会被 EXIF 改回。
- “第 N 条”的旧查询引用被冻结在本条消息开始时；只有用户明确要求在本条消息先查询再修改时，才能使用本条消息的新查询。跨宝宝、过期、记录失效或编号不一致都拒绝替代引用。
- 服务端仍检查身份、宝宝归属、参数类型/日期/数值范围、记录是否存在且唯一及写入成功事实。明确的「不要保存/删除/修改」应阻止写操作，模糊目标需澄清；本地模拟测试不能证明所有自然语言表达都安全。
- 自然回复只可基于真实工具观察声明写入；年龄等可靠事实按服务端计算核验。日记/里程碑保存、确认与语音文字只在有效会话/宝宝范围内处理，不能根据历史转发内容自动写入。

## 媒体与独立文字

- 微信媒体使用可信 CDN / AES，最多 4 项/消息、50 MiB/项。媒体任务先持久化再确认，按绑定成员/宝宝隔离，失败可重试；暂停保留队列，重绑使旧上下文失效。
- 微信 `file_item` 附件仅接收 JPG/JPEG、PNG、WebP、HEIC/HEIF、GIF、MP4/MOV/WebM，先验证文件名/格式，再在受限 CDN 域名上解密并按字节保存原件；不解析任意文档，也不将文件内容交给模型。文件本身如果没有拍摄日期，不会伪造 EXIF。
- **上传与文字不强制串行**：接收图片时先在 D1 创建固定 ID 的 `processing` 媒体占位。之后的文本始终交给**同一个 Agent 判断**：可能描述照片，也可能是体重查询、成长事件或普通对话；系统**不会默认截取下一句话作为图片描述**。
- 如用户明确修改那张照片，Agent 对目标媒体记录写描述或日期；上传完成仅补原件元数据和未被修改的 EXIF 日期，**不覆盖用户的描述和显式日期**。失败则显示 `failed`，成功为 `ready`；网页按宝宝版本刷新。
- 私有 R2 有界范围读取照片 EXIF、JPEG XMP（包括 `exif:DateTimeOriginal`、`photoshop:DateCreated`、`xmp:CreateDate`）及其他可支持的元数据日期；仅使用可验证的有效日期，冲突时不猜测。普通微信照片若已被 iLink 压缩且删净全部拍摄元数据，仍只能回退为微信发送日期；不能靠像素可靠复原拍摄日。保存的媒体字节不被修改。语音原生转写可作文本；无转写时支持格式受限的可选识别。合并转发/引用内容受上游协议数据限制，不可信的历史文字不自动成为新指令。

## 测试与未验收事项

代码落点：`src/wechat-context-snapshot.ts`、`src/wechat-capabilities.ts`、`src/wechat-prompt.mjs`、`src/wechat-agent-loop.mjs`、`src/wechat-orchestrator.mjs`、`src/wechat-media.mjs` 与 `scripts/wechat-worker-e2e.mjs`。隔离 Worker、Node、Chromium/WebKit 的覆盖和实际结果见 [QA / Actions](qa-regression-matrix.md)。

真实微信扫码、转发/语音格式、长会话、上传与后续消息交错、DO 重启及模型实际费用仍需人工/真实账号验证。
