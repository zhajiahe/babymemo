# BabyMemo Design System 2.1 · Calm Editorial

**原则**：家庭成长日记，不是管理后台。照片和完整故事是主角；界面克制、温暖、可信。借鉴 [Apps SDK UI](https://openai.github.io/apps-sdk-ui/?path=/docs/overview-introduction--docs) 的 Token、一致状态与无障碍思想，**不安装其组件库或 Tailwind**。

## 代码入口

- `src/design-system.css`：唯一的 CSS Token 和共用交互状态来源，**必须先于** `styles.css` / `editorial.css` 加载，应用和 `/demo.html` 均遵守此顺序。
- `src/components/ui.tsx`：`Button`（primary / secondary / quiet / danger，含 loading）、`IconButton`、`StatusMessage`、`SegmentedControl`、`Field`、`Card`、`Notice`、`Pager`。设置、相册操作、离线重试与筛选等按钮共享相同交互约定。新交互先复用组件，不重复创建样式。
- `src/styles.css`：布局、表单与功能状态；`src/editorial.css`：首页、成长、相册、故事阅读、移动端视觉；`src/demo/demo.css`：只读演示专属内容。
- 保留 `--bm-*` 兼容变量名。不要在页面中重新定义品牌色、触控尺寸、动画时长，也不要在样式表末尾反复覆盖规则。

## Token 与视觉语言

| 语义 | Token | 默认值 |
| --- | --- | --- |
| 画布 / 卡片 / 故事页 | `--bm-page` / `--bm-surface` / `--bm-story-surface` | `#F8F8F6` / `#FFFFFF` / `#FFFEFC` |
| 正文 / 次要文字 | `--bm-ink` / `--bm-muted` | `#263647` / `#586B7B` |
| 主操作 / 柔和背景 | `--bm-brand` / `--bm-brand-soft` | `#245F91` / `#E9F2F9` |
| 分割线 / 封面占位 | `--bm-border` / `--bm-photo-bg` | `#E1E6E9` / `#E9EFF3` |
| 间距 | `--bm-space-{1,2,3,4,5,6,8}` | 4 / 8 / 12 / 16 / 20 / 24 / 32px |
| 圆角 | `--bm-radius-{sm,md,lg,xl}` | 8 / 12 / 18 / 24px |
| 触控 / 动效 | `--bm-touch-min` / `--bm-duration-fast` | 44px / 140ms |

文字优先使用系统字体；故事用 `--bm-font-story`、`--bm-leading-story`，保留换行，不截断内容。使用少量柔和阴影，不用虚假仪表盘、巨幅渐变欢迎卡、无意义数据徽章。

## 组件与页面约定

- **按钮**：主操作一屏尽量只有一个；次级操作弱化；危险操作需要明确动作和确认。全部保留 `disabled`、清晰 `focus-visible` 和 44px 触控目标。
- **分段选择器**：正式相册、只读 Demo 的「故事 / 照片墙」以及成长图表的「体重 / 身高」都用 `SegmentedControl`；`aria-pressed` 表示模式，不提交表单。
- **相册**：默认故事卡片（照片 → 拍摄日期 → 完整叙述）；紧凑照片墙仅作为备选。没有故事时提供补记入口，不生成虚构文案。
- **预览**：正式版与只读 Demo 使用相同的原生 `dialog`、故事排版和键盘退出语义；正式版继续提供照片横滑、原生视频控件、编辑、下载和封面设置。Demo 仅使用虚构数据且不得调用私有 API。
- **移动端**：原生感底栏、安全区与软键盘避让；不牺牲文字可读性。操作状态、网络断开、空页面、上传和失败均有真实反馈。
- **主题**：当前统一浅色；图表色、媒体占位色和输入焦点来自 Token。深色模式需要先审计遗留硬编码色，完成全页对比度与视频/图片测试后再开启，不能只改根变量。

## 产品预览同步

`docs/assets/product-preview.svg` 是根据当前首页结构绘制的**虚构静态示意**（不是截图），主要语义色须与 `src/design-system.css` 一致。正式可交互示例以 `/demo.html` 为准；Demo 不模拟写入或隐藏的微信聊天界面。README 不得将任何合成素材称为真实用户截图。

## 验收

`npm run verify`、`npm run test:e2e`；浏览器截图和页面溢出检查覆盖 320 / 375 / 390 / 768 / 1280px，首页、相册故事与照片墙、成长、设置、演示页。覆盖键盘、`prefers-reduced-motion`、空数据、长中文故事、视频封面缺失、上传中/失败、离线同步与 iPhone safe area。Chromium/Linux WebKit 不代表真实 iPhone Safari/HEIC/MOV 验收。

只有实际保存成功才确认写入；任何外观优化都不得暗示微信媒体已上传或封面已生成。
