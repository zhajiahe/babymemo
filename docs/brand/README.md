# BabyMemo 品牌图标 · Warm Archive

主题是「把成长，好好收藏」。与 `docs/design-system.md` 一致，主色沿用暖珊瑚 `#A94B39`、正文色 `#263342`。

## 候选方案

- [A · 暖心书页](./options/a-warm-archive.svg)：**现用**。书页代表成长记录，爱心代表家的珍藏。建议作为正式形象。
- [B · 时光轨道](./options/b-little-orbit.svg)：抽象小写字母 b 与时光圆环，现代、简洁。
- [C · 成长初芽](./options/c-first-sprout.svg)：新芽、小爱心与太阳，强调自然成长。

## 实际启用资源

- `public/brand/mark.svg`：桌面侧边栏及登录页共用的方形品牌图标。
- `public/brand/wordmark.svg`：包含 BabyMemo 品牌字样及标语的横版 Logo；SVG 文字字体依赖系统回退字体。
- `public/favicon.svg`：浏览器标签页简化版图标；另含 32px PNG 回退及 ICO。
- `public/apple-touch-icon.png`：iOS 添加到主屏幕图标（180px）。
- `public/icon-192.png` 和 `public/brand/mark.svg`：Web App Manifest 图标（192px PNG + 任意尺寸 SVG）。
- `public/site.webmanifest`：可安装网页的名称、主题色、图标入口。

设计源文件保留 SVG 以便继续调整。不要将家庭真实照片或宝宝个人资料放入品牌资源。图标及文字为原创抽象矢量设计。

## 验收

PR 仅调整静态品牌资源及 Logo 引用；不修改业务接口、D1、R2 或身份验证。合并后通过部署流程发布，再清理浏览器 favicon 缓存并检查 iOS 添加到主屏幕的真实外观。
