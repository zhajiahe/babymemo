# 从 MyBaby 迁移到 BabyMemo（保守计划）

> 本阶段仅描述数据映射和验收，**还没有自动执行生产迁移**。旧 Vercel/Neon/R2 环境保持运行。禁止直接清空任何线上库。

## 旧系统现状

旧仓库 `zhajiahe/my-baby` 使用 Next.js + Prisma + PostgreSQL（Neon），媒体主要位于 Cloudflare R2。BabyMemo 的数据库是新的 D1，图片和视频在独立私有 R2 `babymemo-media` 中。

## 核心映射

| MyBaby / Prisma | BabyMemo / D1 | 说明 |
| --- | --- | --- |
| `Baby.id` | `babies.id` | 尽量原样保留，避免外键重映射 |
| `Baby.name`、`birthDate`、`gender` | `babies.name`、`birthday`、`gender` | 日期统一转为宝宝时区下 YYYY-MM-DD |
| `Baby.birthTime` | `babies.birth_time`（迁移 0012） | 可选 HH:mm，本地时区时间；旧数据不自动推断，需要按真实资料回填 |
| `Baby.allergies`、`notes` | `babies.allergies`、`notes` | 防止空值覆盖 |
| `GrowthRecord` | `growth_records` | weight kg，height 和头围 cm |
| `Milestone` | `milestones` | title、description、day |
| `MediaItem` | `media` + R2 | 原 URL 必须定位底层对象；严禁仅迁移缩略图 |
| `owner` | 新实例独立管理员 | 不复用旧系统认证 Cookie 或凭据 |

暂不完整映射的字段：`avatar`、出生体格数据、血型，`Milestone.tags`，`MediaItem.description`、`format`、`thumbnailUrl`、`duration`。**在完成字段扩展前，不能称为无损迁移**。

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

目前没有迁移脚本，因此 **不要把 BabyMemo 当作已完整替代 MyBaby**。
## 已有正式数据的追加维护

- 生产已导入数据不应再使用此历史迁移计划进行第二次全量导入。
- `0012_birth_time.sql` 仅新增默认空字符串的出生时间列，已有宝宝 ID、记录、媒体索引保持不变。请在设置页手工录入原 MyBaby 中真实的 HH:mm；无法确认时保持空值，不做推测。
- 旧照片缩略图不属于产品常规功能。需一次性补图时，请通过 [媒体维护手册](MEDIA_MAINTENANCE.md) 执行操作者脚本；不动原图，明确确认后才写入衍生图。
