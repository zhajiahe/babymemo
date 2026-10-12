# 从 MyBaby 迁移到 BabyMemo（保守计划）

> 已提供只读导出、媒体清单、增量导入和校验工具。**真实迁移须逐次得到部署者授权，工具存在不等于迁移已经完成。** 旧 Vercel/Neon/R2 环境保持运行。禁止直接清空任何线上库。

## 旧系统现状

旧仓库 `zhajiahe/my-baby` 使用 Next.js + Prisma + PostgreSQL（Neon），媒体主要位于 Cloudflare R2。BabyMemo 的数据库是新的 D1，图片和视频在独立私有 R2 `babymemo-media` 中。

## 核心映射

| MyBaby / Prisma | BabyMemo / D1 | 说明 |
| --- | --- | --- |
| `Baby.id` | `babies.id` | 新宝宝保留源 ID；已初始化的同一宝宝按姓名、生日、性别唯一匹配，保留目标 ID，保存映射；身份不匹配或有歧义就停止 |
| `Baby.name`、`birthDate`、`gender` | `babies.name`、`birthday`、`gender` | 旧站编辑表单使用 ISO 时间戳的日期部分，迁移默认保留该日历日期，原时间戳另行保留；不能直接按时区转换导致偏移 |
| `Baby.allergies`、`notes` | `babies.allergies`、`notes` | 防止空值覆盖 |
| `GrowthRecord` | `growth_records` | weight kg，height 和头围 cm |
| `Milestone` | `milestones` | title、description、day |
| `MediaItem` | `media` + R2 | 原 URL 必须定位底层对象；严禁仅迁移缩略图 |
| `owner` | 新实例独立管理员 | 不复用旧系统认证 Cookie 或凭据 |

`0005_my_baby_import.sql` 增量保留出生时间、出生体格、血型、私有头像对象键、里程碑标签，以及媒体描述、格式、时长和缩略图对象键。四张源表的每条原始数据（包括源 ID、完整时间戳、原 URL 和所有标量字段）还会保存至受认证数据库中的 `legacy_import_rows`，不新增公开读取入口。**存储保留不代表现有 UI 已支持这些字段的展示/编辑**；标签、出生体格、头像等 UI 扩展尚未完成，不能声称用户体验完全等同旧站。

## 迁移原则

1. 从 Neon 对四张表做只读导出，记录行数、ID、数据哈希与宝宝之间的关联。
2. 枚举原 R2 对象，建立媒体 URL 与私有对象键的映射；不要假设公开 URL 与底层对象 1:1。
3. 给新 D1 增加缺失字段后，在临时库执行幂等导入；验证外键、数量、日期及时区。
4. 复制媒体至新 R2，通过对象大小、ETag 或 SHA-256 校验；验证 JPEG / HEIC / MOV / MP4 浏览器实际访问。
5. 两个站并行只读核验一段时间，完成数据比对与恢复演练后再安排正式切换。
6. 回滚预案：保留旧站、Neon 数据库与原 R2 对象不变；优先回切流量，而不是删库重来。

## 数据质量和验收

- 宝宝档案、成长记录、里程碑与媒体对象的数量完全匹配。
- 成长日期正确，记录的身高体重单位一致。
- 相册覆盖最长的 MOV 和 HEIC、横图/竖图，以及长视频 Range 请求。
- 严格检查所有上传 R2 对象只能由登录后的 API 读取。
- 不在 SQL 文件、日志、GitHub Actions artifact 中泄漏家庭数据。
- 迁移程序必须支持 dry-run、断点续传及幂等重试，再允许用于生产。

## 只读准备工具

`scripts/mybaby-migration.mjs` 是仅在操作员本机执行的 Node.js 22+ 工具，不进入 Worker，不包含生产导入、媒体复制、删库或发布功能。它通过旧项目已有的 Prisma 和 AWS SDK 依赖访问旧数据源，工具内部读取旧仓库 `.env` 的数据库与 R2 配置，不回显凭据。不要将 `.env` 内容发送给 Agent 或粘贴到命令参数。

```bash
# 在 BabyMemo 仓库执行；旧仓库需要已经安装其依赖。
node --test scripts/mybaby-migration.test.mjs
node scripts/mybaby-migration.mjs export ../my-baby

# 将上一条输出的私有快照目录替换到这里。
node scripts/mybaby-migration.mjs inventory ../my-baby .migration-private/mybaby-<timestamp>
```

- `export` 在 PostgreSQL `RepeatableRead` 事务中先执行 `SET TRANSACTION READ ONLY`，一致性导出四张业务表的全部字段；不迁移登录账号、密码、Agent 凭据或会话。
- 校验 ID 唯一性、宝宝关联、日期、标签和媒体类型，并保存表级内容哈希。日期映射沿用旧站 `date.split('T')[0]` 的语义。
- 引用清单包含媒体原文件、缩略图及宝宝头像，按对象键去重；公开 URL 必须匹配配置中的原 R2 域名与路径前缀，也支持旧站 `/api/media/` 引用。未批准的外部地址会停止处理，不直接下载未知 URL。
- `inventory` 仅对被引用的原 R2 对象执行 HEAD，缺失对象则停止。大小和 ETag 是元数据核验，**不代表复制后的完整 SHA-256 校验已通过**。
- `.migration-private/` 已加入 Git 忽略；目录权限为 `0700`，文件为 `0600`，每次生成独立不可覆盖的快照。文件含真实家庭数据，不上传至 PR、CI artifact 或聊天。日志仅输出路径、数量、总字节数和脱敏状态，不输出原始 SDK 错误。
- 在正式导入前必须核对实际生产 Worker 的 D1/R2 绑定，备份新站并明确初始化宝宝的 ID 映射；保持新管理员不变。下一节的操作工具逐阶段执行这些动作。
- 旧站仍可能有新增记录。当前快照仅用于准备，在双方暂停录入的最终窗口重新只读导出，不能把早期快照当作最终切换数据。

## 获准后的目标备份、复制与增量导入

`scripts/mybaby-import.mjs` 配合 `scripts/mybaby-import-plan.mjs` 使用。默认 dry-run；只有显式 `--execute` 才执行对应阶段的备份或写入。不要跳过本地测试或以导入授权代替 Worker 发布授权。

操作员先在 `.migration-private/target.json` 写入非秘密目标标识（均从实际部署核对，不使用下列占位值）：

```json
{
  "version": 1,
  "origin": "https://baby.example.com",
  "worker": "babymemo",
  "accountId": "<Cloudflare account ID>",
  "databaseId": "<D1 database UUID>",
  "databaseName": "babymemo",
  "bucket": "babymemo-media"
}
```

在操作员终端完成 `npx wrangler login`。工具仅在子进程内捕获 `wrangler auth token --json`，当前 Cloudflare 授权令牌只在内存使用，不回显、不保存，也不读取或轮换 Worker 的 `SESSION_SECRET` / `DATA_KEY`。需要先安装 BabyMemo 的 npm 依赖。

```bash
npm install --no-audit --no-fund
npm run verify

RUN=.migration-private/mybaby-<timestamp>
INVENTORY=$RUN/inventory-<timestamp>.json

# 核对账号、D1 名称、实际 Worker 绑定及自定义域名；纯规划。
node scripts/mybaby-import.mjs prepare "$RUN" "$INVENTORY"

# 以下命令仅在获得本次生产迁移授权后运行。
# 导出当前新 D1 的完整备份；固定源、目标、清单哈希及不可变导入计划。
node scripts/mybaby-import.mjs prepare "$RUN" "$INVENTORY" --execute

# 检查已有迁移历史，再由 Wrangler 增量应用迁移；不发布 Worker。
node scripts/mybaby-import.mjs schema "$RUN" "$INVENTORY" --execute

# 复制所有引用对象，最多 2 并发；源/目标完整文件 SHA-256 一致才写断点。
node scripts/mybaby-import.mjs copy "$RUN" "$INVENTORY" --execute

# 缺少任何复制断点时拒绝导入；目标 ID/内容冲突时拒绝覆盖。
node scripts/mybaby-import.mjs import "$RUN" "$INVENTORY" --execute

# 重读所有目标对象并校验 SHA-256，逐字段验证 D1 与源归档。
node scripts/mybaby-import.mjs verify "$RUN" "$INVENTORY"
```

### 执行约束

- 源桶与目标桶必须独立。绝不修改旧 Neon、旧 R2、旧站流量、测试环境或管理员认证数据。
- 初始化宝宝仅合并空字段或相同字段，更新带有完整的预检值条件，防止覆盖并发编辑；已有记录只插入，不执行冲突覆盖。中途失败允许重跑同一份不可变计划；源数据变更需另行核对，不自动覆盖旧导入记录。
- 目标对象键采用 `private/import-my-baby/<源对象键的SHA-256>`，这是命名摘要而不是文件内容校验。文件内容另外全量计算 SHA-256。已有同名对象必须与源完整哈希一致，不能以大小相同或 ETag 相同代替校验。
- 文件经本机 `0600` 临时文件流式中转，不在 Worker 内全量读取，不公开 bucket。传输有网络重试、空闲超时与断点检查；恢复时核对源 ETag、大小与已完成校验的断点，独立 `verify` 阶段再次完整读取所有目标文件。进程强制中断可能遗留 `transfer-*.bin`，恢复后处理同一对象会清理该文件。复制记录保存在私有 `copy-checkpoints.ndjson`。
- 旧 JPEG 图片缩略图如存在，会额外复制到现有受保护缩略图路由使用的对象键；视频缩略图和头像保存为私有对象键，目前 UI 不自动展示。缺失旧缩略图继续安全回退原图。不能只复制派生图而遗漏原文件。
- `legacy_import_rows` 保留精确源 JSON、内容哈希与源/目标 ID 映射。导入不会操作 `owner`、`app_settings`、会话或微信凭据。D1 备份可能包含加密配置和认证哈希，因此禁止查看/回显正文、提交 Git 或上传 CI artifact。
- 校验报告保存在私有快照目录中，含数量、内容哈希、外键结果及未登录访问拒绝结果。真实登录后的照片浏览、MOV/HEIC、长视频 Range 和真实 iPhone Safari 仍需要人工验收；完整哈希校验不等于设备兼容性验收。
- 本工具不发布 Worker，不改变公开 R2 权限，不切换旧站；失败回退优先使用保持不变的旧站，不能自动清库或把备份直接覆盖生产。

仍需完成 UI 扩展和真实设备验收，因此 **不要把 BabyMemo 当作已完全替代 MyBaby**。