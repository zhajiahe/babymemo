# BabyMemo 品牌资源 · 宝宝与成长日记

现用品牌图标是宝宝从蓝色成长日记本探出头的插画，保留黄色书签、粉色爱心与蓝色主色。**Web Logo 与 favicon 透明；iOS 主屏幕、maskable 图标使用浅蓝底。** 这一差异是为了适应主屏幕裁切，不是额外的网页背景。

## 单一源图

- `public/brand/baby-journal-source.png`：用户选定图案，经透明边裁切与 192px 优化的 8 位调色板 PNG；它是唯一需要手动更新的位图资源。
- `scripts/build-brand-assets.mjs`：只使用 Node.js 内置模块生成全部尺寸，不添加依赖。每次 `npm run dev`、`npm run test:unit`、`npm run build` 自动执行。
- 自动生成：`favicon.svg`、`favicon-32.png`、`favicon.ico`（16/32/48）、`apple-touch-icon.png`（180）、`icon-192.png`、`icon-512.png`、`icon-maskable-512.png`，以及 `brand/mark.svg`、`brand/wordmark.svg`。
- 生成文件不提交 Git，避免部分更新导致 PWA 与页面 Logo 不一致。部署构建在复制 `public/` 前生成全部资源。

## 配色

| 使用场景 | 色值 |
| --- | --- |
| 页面 | `#F7FAFD` |
| 品牌蓝 | `#2165A8` |
| 品牌浅蓝 | `#E9F2FB` |
| 文本 | `#243448` |
| 次要文字 | `#586D80` |
| 线条 | `#DDE6EF` |
| iOS / maskable 背景 | `#EAF4FC` |

正文和操作按钮保持可读性，不用大量蓝色铺满照片或卡片。

## 上线验证

构建后检查首页、登录页 Logo，favicon 的 16/32px，Safari「添加到主屏幕」、Android PWA 标准与 maskable 图标。主屏幕旧图标可能由系统缓存，必要时删除旧快捷方式后重新添加。当前变更不触碰数据库、照片、微信连接或业务 API。
