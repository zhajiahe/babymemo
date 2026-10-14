# 一次性旧媒体缩略图维护（非产品功能）

> 此命令行脚本仅适用于 MyBaby 等旧系统迁移的历史图片，由维护者手动执行。BabyMemo 设置页另有用户主动启动的“后台修复全部封面”入口（涵盖缺失照片和视频），在浏览器中分批处理并保存进度；它不是此脚本，也不是 Cloudflare Cron 转码。

## 原则

- **默认 dry-run**，只有显式传入 `--apply` 且设置 `BABYMEMO_BACKFILL_CONFIRM=YES` 时，才创建缩略图。
- 只访问现有经过家庭管理员登录保护的 `/api/media/thumbnail-backfill`、`/api/media/:id/content`、`/api/media/:id/thumbnail`；不将 R2 公开、不修改或删除原图。
- 限制单次扫描数量（默认 20，最大 100），逐张处理；跳过超过 25 MiB 或浏览器无法解码的文件。生成最长边 512px、最大 512KiB 的私有 JPEG。
- 仅用于维护者手动启动，禁止放入 CI、Cron、前端按钮或普通用户文档的日常使用流程。
- 运行前做好正式 D1/R2 备份，使用独立终端环境变量输入凭据，不将 Secret / 密码 / 真实家庭数据提交 GitHub。
- 多宝宝必须指定 `BABYMEMO_BACKFILL_BABY_ID`，避免把一次性游标混到其他宝宝。

## 准备和 dry-run

在项目工作区 Node.js 22+ 环境临时安装浏览器自动化依赖：

```sh
npm install --no-save playwright@1.56.1
npx playwright install chromium
```

本地环境变量（不要保存到代码或工作流中）：

```sh
export BABYMEMO_URL=https://你的正式域名/
export BABYMEMO_USER=你的家庭管理员名
read -r -s -p "家庭密码: " BABYMEMO_PASSWORD
export BABYMEMO_PASSWORD
echo
# 多宝宝家庭另设 BABYMEMO_BACKFILL_BABY_ID=目标宝宝ID
node scripts/maintenance-thumbnail-backfill.mjs
```

dry-run 只返回匿名汇总数量；会使用登录凭据，但不更新记录或缩略图。只有确定好目标和备份后，才执行：

```sh
BABYMEMO_BACKFILL_CONFIRM=YES node scripts/maintenance-thumbnail-backfill.mjs --apply
```

一次处理后输出 `nextCursor`；若同一宝宝还有待处理旧照片，下一批通过 `BABYMEMO_BACKFILL_AFTER` 继续。跳过的文件不会标记成功，之后仍可换有兼容解码器的客户端重试。若运行中断，可以重新执行前一批；后端返回仍缺缩略图的项目，已经成功的会被自然跳过。

## 完成后

进入相册抽样验证照片显示、完整原图可访问和日期无变化；对 HEIC 和超大图保留原图回退，不强制转换。确认无遗漏后无需长期部署这个脚本，它属于迁移维护资产而不是产品能力。
