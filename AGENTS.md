<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:shinian-design-workflow -->

# 拾念 · 界面与视觉工作约定

用户对界面的一切口语化意见（"颜色太恐怖""太满了""不够高级""卡片戳眼睛"）
都是设计需求原文。不要要求她改用专业术语或补触发词。

## 视觉需求必须走的流程（不用用户点名 skill）

1. **先读设计基线**：`设计督导标准.md`、`UI设计说明.md`。已定义的颜色、圆角、
   材质、命名一律沿用，只补空缺；不引入新的装饰语言。
2. **调用 `design-terminology` skill** → 把口语翻译成术语 + 参数。
3. **调用 `ui-design-spec` skill** → 给出本次 token / 动效参数。
4. 然后才改代码。改前说明"哪些不动"（布局 / 文案 / 交互），
   改后用一两行说明"改了哪里、为什么"。

输出体量随改动大小自适应：小改动（单个颜色、间距）一行给出术语 + 参数即可；
大改动（布局、整页、多模块）完整输出《设计需求单》《设计规范单》。
功能、逻辑、数据类需求不走此流程。

## 项目速查

- 结构：首页 `src/app/page.tsx`｜工作区 `src/app/workspace` → `private-workspace.tsx`｜
  预览路由 `design-preview` / `layout-preview` / `orb-preview` / `pixel-card-preview`
- 核心页面：记录 / 灵感集 / 详情；灵感集卡片 = `InspirationCollection` + BorderGlow
- 视觉基线：深墨紫 `#120F17`、珍珠白、浅薰衣草；
  边缘光 紫 `#c084fc` / 粉 `#f472b6` / 蓝 `#38bdf8`；卡片圆角 28px、卡面 24% 不透明度
- 星球页「今夜跃迁」：`daily-orbit.tsx` + `orbit-planet-3d.tsx`，
  材质定义在 `src/lib/star-materials.ts`（七种柔和珠光材质）；
  注意着色器会把 baseColor 压暗（约 0.46 倍），颜色发黑先查这里
- 用户口语 → 术语对照：见 skill `design-terminology` 的术语词典

<!-- END:shinian-design-workflow -->
