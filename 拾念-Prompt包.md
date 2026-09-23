# 拾念 · 可直接复制给 GPT 的 Prompt 包

日期：2026-09-23
用法：找到你需要的那一条，**整段复制**发给 GPT。每条都是自包含的，不需要额外解释背景。

**重要**：这套 Prompt 已经内置了三条安全约束——只允许改指定文件、必须跑检查、改完必须贴结果。这样能最大限度避免"改一个地方，别处坏了"。

---

## 目录

- [Prompt 1 · 术语统一（推荐先做）](#prompt-1--术语统一推荐先做)
- [Prompt 2 · 报错文案人话化](#prompt-2--报错文案人话化)
- [Prompt 3 · 长句拆分](#prompt-3--长句拆分)
- [Prompt 4 · 按钮文案统一](#prompt-4--按钮文案统一)
- [Prompt 5 · 补缺失文案](#prompt-5--补缺失文案)
- [Prompt 6 · 移动端动效性能排查](#prompt-6--移动端动效性能排查)
- [Prompt 7 · 无障碍补齐](#prompt-7--无障碍补齐)
- [Prompt 8 · 来源表单交互升级](#prompt-8--来源表单交互升级)
- [Prompt 9 · 保存反馈动效](#prompt-9--保存反馈动效)
- [Prompt 10 · 空白状态设计](#prompt-10--空白状态设计)
- [Prompt 11 · 灵感卡片悬停细节](#prompt-11--灵感卡片悬停细节)
- [Prompt 12 · 全局自检（可定时跑）](#prompt-12--全局自检可定时跑)

---

## Prompt 1 · 术语统一（推荐先做）

> **为什么先做这个**：纯文字替换，零逻辑风险，但用户感知最强。

```
请对「拾念」项目做一次术语统一。只改文案字符串，不要改动任何逻辑、组件结构、样式或测试断言。

工作目录：C:\Users\qiqi\Desktop\我的第一个项目

统一规则（严格按此表替换）：
1. 整个容器统一叫「灵感集」。禁止再出现：灵感空间、星图、资料库、第二大脑
2. 单条内容统一叫「灵感」。禁止再出现：记录、条目、念头、资料（指单条时）
3. AI 动作统一叫「AI 整理」。禁止再出现：AI 帮我整理、AI 帮你理一理、整理一下
4. 二次表达统一叫「我的理解」。禁止再出现：自己的输出、三句话、用自己的话再说一次
5. 卡片统一叫「闪卡」，收藏后叫「闪卡收藏」。禁止再出现：油画闪卡、小卡片
6. 待办统一叫「启程票」，已完成统一叫「终点票」。禁止再出现：待办、待行动、事项
7. 云端统一叫「云端」。禁止再出现：服务器
8. 本机统一叫「这台设备」。禁止再出现：此设备、本设备、当前设备、当前浏览器
9. 重试按钮统一叫「重试」。禁止再出现：重新尝试、重新检查、重新读取

允许修改的文件（只有这些）：
- src/components/echo-app.tsx
- src/components/studio-ui.tsx
- src/components/inspiration-collection.tsx
- src/components/note-detail.tsx
- src/components/checkin-panel.tsx
- src/components/pending-tickets.tsx
- src/components/art-flashcard.tsx
- src/components/task-journey-bar.tsx
- src/components/private-workspace.tsx

绝对不要修改：
- 任何 .css / .module.css 文件
- src/lib/ 下的任何逻辑代码
- tests/ 下的任何文件
- 任何变量名、函数名、className、aria-label 里的技术标识

注意：测试文件里有中文断言，如果某条测试因为文案变化失败了，不要改测试，而是停下来告诉我哪条失败了、原文是什么、你改成了什么，由我决定。

完成后必须依次运行并贴出每条的完整输出：
1. npm run typecheck
2. npx vitest run
如果任何一步失败，立刻停止，把失败的完整报错贴出来，不要继续修改。

最后给出一个表格：文件名 | 改动条数 | 典型例子（改前 → 改后）
```

---

## Prompt 2 · 报错文案人话化

> **为什么重要**：用户看到"同步中断"第一反应是"我是不是弄坏了什么"。每句报错都在伤害信任。

```
请把「拾念」项目里所有面向用户的报错和状态提示，改写成普通人一眼能懂的中文。只改文案字符串，不动逻辑。

工作目录：C:\Users\qiqi\Desktop\我的第一个项目

原则：
- 先说发生了什么，再说用户能做什么
- 不用技术词：服务器 → 云端、确认 → 存好了吗、状态已变化 → 进度变了、版本 → 内容、覆盖 → 用上了、初始化 → 只有你一个账号
- 句子不超过 25 个字，超了就拆成两句
- 保留「星河 / 微光 / 回响」的温柔语气，不要变成公文

需要改写的具体位置（改前 → 改后）：
1. src/components/echo-app.tsx 里「同步中断，点此重试」→「连接断了，点一下再试」
2. src/components/echo-app.tsx 里「这次结果未覆盖新内容」→「这次整理用不上新改的内容，请重新整理」
3. src/components/echo-app.tsx 里「已不在最新云端列表中，可能已在另一设备删除」→「这条灵感已被删除（可能是在手机或电脑上删的）」
4. src/lib/task-tickets.ts 里「事项状态已变化，请刷新后再试」→「这件事的进度变了，刷新一下看看」
5. src/components/note-detail.tsx 里「缺少编辑开始时的版本，请重新打开记录后再修改」→「这条内容已经过期，请重新打开再改」
6. src/components/checkin-panel.tsx 里「服务器尚未确认有效的打卡记录，请保留文字并重新核对」→「还没确认今天的打卡是否存好，你的文字还在，请重试」
7. src/components/note-detail.tsx 里「本次整理依据：你的记录和你提供的来源片段」→「这次整理用了：你的想法 + 你贴的片段」
8. src/components/private-workspace.tsx 里「使用为你初始化的私人账号」→「这个站点只有你一个账号，不开放注册」
9. src/components/echo-app.tsx 里「拾念 · 一个慢慢长大的第二大脑」→「拾念 · 慢慢长大的灵感之地」
10. src/components/echo-app.tsx 里「AI 服务暂不可用，仍可记录和检索。」→「AI 暂时用不了，记录和找回都不受影响。」

另外请检查这两个地方，防止后端技术原文直接显示给用户：
- src/components/note-detail.tsx 中直接把 {note.aiError} 渲染出来的位置
- src/components/echo-app.tsx 中直接把 {bootError} 渲染出来的位置
给它们包一层中文前缀，例如「整理没成功：」+ 人话说明。技术原文只写进 console.error。

允许修改：上面提到的文件。
不要修改：任何 .css、tests/、变量名、函数名。

完成后必须依次运行并贴出完整输出：
1. npm run typecheck
2. npx vitest run
任何一步失败就停下并贴出报错，不要自行改测试。
```

---

## Prompt 3 · 长句拆分

```
请把「拾念」项目里过长的中文文案拆短。只改文案，不动逻辑。

工作目录：C:\Users\qiqi\Desktop\我的第一个项目

目标：中文界面上任何一句显示给用户的话，不超过 25 个字；超过的拆成两句。

需要处理的（都在 src/components/echo-app.tsx）：
1. 「手机和电脑使用同一邮箱及密码登录。退出后云端资料仍在；当前设备的捕捉草稿会在原账号重新登录后恢复。」
   → 「用同一个邮箱登录手机和电脑。退出后云端资料不丢，草稿会在重新登录后回来。」
2. 「点击保存后，资料写入私人云端灵感集。手机和电脑登录同一账号即可同步；未提交的草稿只留在当前设备。」
   → 「保存后会存进你的云端账号，手机电脑都能看到。没保存的内容只在这台设备上。」
3. 「只有点击"整理"时，才会将这条记录的文字发送给 AI。来源链接仅作为参考保存，不会自动读取正文。」
   → 「只有你点"整理"，才会把文字发给 AI。链接只是存个出处，不读正文。」
4. 「AI 未配置时，记录、搜索、自己的输出和备份都能正常使用。服务配置方法见项目使用说明。」
   → 「AI 没配好也能记录、搜索、写理解和备份。」
5. src/components/note-detail.tsx：「这条记录的想法、来源、整理和个人输出将一起删除，无法撤销。」
   → 「想法、来源、整理和你的理解会一起删掉，不能恢复。」
6. src/components/checkin-panel.tsx：「日期已进入新的一天。正在重新核对，文字仍保留；读取完成后请再次点亮。」
   → 「已经过了零点。正在重新读取，文字没丢，读完再点亮一次。」
7. src/components/inspiration-collection.tsx：「在一条灵感里写下自己的理解，再点「收藏闪卡」。已有收藏时，也可以清除搜索条件找回。」
   → 「在灵感里写下自己的话，再点「收藏闪卡」。」
8. src/components/task-journey-bar.tsx：「准备好时再启程。整理内容、写下理解都不会自动完成事项。」
   → 「准备好了再启程。整理和写理解不会替你完成它。」

请同时全文搜索这 9 个文件，找出任何一条超过 25 个字的用户可见中文，一并按同样风格改短。改完列出完整清单。

允许修改：src/components/ 下的 .tsx 文件
不要修改：任何 .css、tests/、逻辑代码

完成后必须运行并贴出完整输出：
1. npm run typecheck
2. npx vitest run
失败就停下报告，不要改测试。
```

---

## Prompt 4 · 按钮文案统一

```
请统一「拾念」项目的按钮文案。只改按钮显示的文字，不要改 onClick 逻辑。

工作目录：C:\Users\qiqi\Desktop\我的第一个项目

统一规则：
1. 保存灵感的按钮统一叫「记下」
   - 现在有：记下、记下新灵感、记下第一条灵感 → 全部改为「记下」
2. 开始做一件事的按钮统一叫「启程」
   - 现在有：启程 · 开始做、从一件小事开始、去启程 → 全部改为「启程」
3. 完成一件事的按钮统一叫「完成这件事」
   - 现在有：收下终点票、完成，收下终点票 → 全部改为「完成这件事」
   注意：note-detail.tsx 里的「保留记录」是错误处理分支，语义不同，不要改动它
4. 翻看理解的按钮统一叫「翻看我的理解」
   - 现在有：翻看三句话、翻看我的理解 → 全部改为「翻看我的理解」
5. 卡片背景开关改成动效开关，标签要说明点击后会发生什么：
   - src/components/inspiration-collection.tsx：现在是「动态背景」/「播放背景」
   - 改为：「暂停动效」/「播放动效」
   - aria-label 同步改为「暂停卡片背景动效」/「播放卡片背景动效」
   - 注意：这个按钮的显示文字由 motionPaused 状态决定，请保持这个逻辑，只换文字

允许修改：
- src/components/studio-ui.tsx
- src/components/inspiration-collection.tsx
- src/components/pending-tickets.tsx
- src/components/task-journey-bar.tsx
- src/components/art-flashcard.tsx

不要修改：任何 .css、tests/、onClick 函数体、状态变量名

完成后必须运行并贴出完整输出：
1. npm run typecheck
2. npx vitest run

测试里如果有中文按钮名断言失败，停下来列出失败详情，不要自己改测试。
```

---

## Prompt 5 · 补缺失文案

```
请给「拾念」项目里"只有图标没有文字"和"加载态显示破折号"的地方补上文案。

工作目录：C:\Users\qiqi\Desktop\我的第一个项目

需要补的位置：
1. src/components/art-flashcard.tsx 里有一个只显示 ↻ 符号的翻面按钮
   → 给它加上可见文字「轻触翻面」，保留图标
   → 同时确认它有 aria-label

2. src/components/art-flashcard.tsx 里的「查看 4K 画作」
   → 改为「看高清原画」（"4K"是参数，不是用户能感受到的好处）

3. src/components/checkin-panel.tsx 里加载状态显示「累计 — 天」「连续 — 天」
   → 改为显示「正在读取…」，不要让用户看到破折号（看起来像加载失败）

4. src/components/checkin-panel.tsx 里画作加载失败时只显示心情和金句，不告诉用户失败了
   → 补一行提示：「这张牌暂时画不出来，文字仍可保存」

5. src/components/studio-ui.tsx 里字数统计只显示「123 字」
   → 补 aria-label="已输入 123 字"，让读屏软件能念出来
   → 注意：可见文字保持「123 字」不变，只加 aria-label

允许修改：src/components/art-flashcard.tsx、src/components/checkin-panel.tsx、src/components/studio-ui.tsx
不要修改：任何 .css、tests/、其他组件

完成后必须运行并贴出完整输出：
1. npm run typecheck
2. npx vitest run
```

---

## Prompt 6 · 移动端动效性能排查

> **背景**：我在 390×844 尺寸下加载录入页时，页面截图反复超时，桌面尺寸正常。这可能是移动端动效负载过重。请在真机上确认。

```
「拾念」的录入页在窄屏下可能有性能问题，请排查并优化。不要改变任何视觉效果的设计意图，只降低不必要的开销。

工作目录：C:\Users\qiqi\Desktop\我的第一个项目

现象：在 390×844（iPhone 尺寸）下加载录入页，页面持续重绘，截图工具反复超时。桌面 1280×720 下正常。

请先诊断，再动手：
第一步（诊断，不要改代码）：
- 阅读 src/components/aero-scene.tsx 和 src/components/aero-scene.css
- 阅读 src/app/aero-theme.css
- 找出在窄屏下仍然全速运行的动画：requestAnimationFrame 循环、CSS animation、filter: blur、backdrop-filter、大量 DOM 粒子
- 特别注意：是否有动画在页面不可见或输入框聚焦时仍然运行

第二步（报告）：
把发现的问题列出来，每条包含：文件:行号、这是什么开销、在手机上大概多贵、建议怎么改。先给我看这份报告，等我确认后再改。

如果确认要改，遵守这些原则：
- 优先用已有的 prefers-reduced-motion 分支思路，给窄屏也降级
- 输入框聚焦时（capture-space[data-writing="true"]）应该降低背景动效，这是设计文档里已经写的意图，检查是否真的生效了
- 不要删除动效，而是降低帧率、减少元素数量或降低模糊半径
- 保留桌面端和宽屏的完整体验

允许修改：src/components/aero-scene.tsx、src/components/aero-scene.css、src/app/aero-theme.css
不要修改：任何 .tsx 里的业务逻辑、tests/、其它组件

改完后必须运行并贴出完整输出：
1. npm run typecheck
2. npm run build
3. npx vitest run
```

---

## Prompt 7 · 无障碍补齐

```
请对「拾念」项目做一次无障碍检查与修复。

工作目录：C:\Users\qiqi\Desktop\我的第一个项目

检查并修复这些方面：
1. 所有 icon-only 按钮（只有图标没有文字）必须有 aria-label，且用中文描述动作
2. 所有表单输入必须有对应的 label（可以是 sr-only 的）
3. 所有异步状态提示（保存中、已保存、出错）必须有 role="status" 或 role="alert" 和 aria-live
4. 所有可点击元素必须能用键盘 Tab 到达、回车触发
5. 检查 tabIndex={-1} 的元素是否真的应该被跳过
6. 检查模态框和抽屉打开时是否有焦点管理

重点文件：
- src/components/studio-ui.tsx
- src/components/echo-app.tsx
- src/components/note-detail.tsx
- src/components/inspiration-collection.tsx
- src/components/checkin-panel.tsx
- src/components/pending-tickets.tsx

输出格式：先给一份问题清单（文件:行号、问题、修法），再执行修复。

允许修改：上面列的 .tsx 文件
不要修改：任何 .css、tests/、逻辑代码

改完后必须运行并贴出完整输出：
1. npm run typecheck
2. npx vitest run
```

---

## Prompt 8 · 来源表单交互升级

```
请改进「拾念」录入页的「添加来源」表单交互。保持现有视觉风格（深墨紫、珠光玻璃、低饱和），不要引入新的设计语言。

工作目录：C:\Users\qiqi\Desktop\我的第一个项目
主要文件：src/components/studio-ui.tsx（CaptureComposer 组件）

现状：来源类型（播客/文章/书籍/视频/生活/其他）已经是图标分段选择器，链接输入和「补充名称、时间点或原文」折叠区也已经存在。

请做这些改进：

1. 选中某个来源类型后，链接输入框的 placeholder 应该立刻跟着变，并且要具体
   - 现在：播客 →「粘贴节目链接」、文章 →「粘贴文章链接」、书籍 →「豆瓣、微信读书或书籍链接（选填）」
   - 改进：让每个 placeholder 都提示"这里可以放什么"，例如书籍 →「豆瓣、微信读书链接，或只写书名」
   - 生活/其他 →「有链接就放，没有也行」

2. 「添加来源」按钮展开后，如果用户已经填了内容但没保存，要有一个明显的"已填"状态
   - 现在有 source-dot 小圆点，请确认它足够明显

3. 折叠区收起来时，要让用户看得见已经选了什么来源类型和链接
   - 现在有 source-current 显示类型名，确认它包含链接时也显示出来

4. 所有输入框在聚焦时要有清晰的焦点环（符合 4.5:1 对比度要求）

5. 检查窄屏（360px）下来源类型六选项是否换行正常、不误触，每个触摸目标至少 44×44px

允许修改：src/components/studio-ui.tsx 和它对应的样式文件（如需微调）
不要修改：src/lib/ 下的任何逻辑、tests/、其他组件

改完后必须运行并贴出完整输出：
1. npm run typecheck
2. npx vitest run
```

---

## Prompt 9 · 保存反馈动效

> **设计依据**：好的微交互是"在触发点附近给出即时反馈"。现在草稿状态只是一行小字，缺一个"被接住"的感觉。

```
请给「拾念」的保存动作加上即时、克制的反馈动效。不要做成炫技动画，目标是让用户感到"我说的话被接住了"。

工作目录：C:\Users\qiqi\Desktop\我的第一个项目
主要文件：src/components/studio-ui.tsx（CaptureComposer 里的 draft-state 和 capture-submit）

现状：草稿保存时显示一行小字「正在保存本机草稿…」→「草稿已留在此设备」；点击「记下」后跳转到详情页并弹出 toast。

请实现：

1. 「记下」按钮点击后，按钮本身要有反馈
   - 现在的 ArrowUpRight 图标可以做一个短促的向上位移再归位（150-200ms）
   - 或者按钮边框短暂亮起后再淡出
   - 关键：动效时长不超过 250ms，不能延迟页面跳转

2. 草稿状态变化要有过渡，不要文字直接跳变
   - 「正在保存…」→「草稿已留在这台设备」之间加一个 120ms 的淡入淡出
   - 「草稿已留在这台设备」出现时，前面那个 ✓ 图标可以做一次轻微的缩放脉冲（1 → 1.15 → 1）

3. 保存成功的 toast 出现方式：从底部轻微上移 + 淡入，不要突然弹出

4. 全部动效必须遵守 prefers-reduced-motion：用户开启减少动效时，直接切换状态，不做任何过渡

5. 动效不能影响输入焦点：用户在输入框打字时，这些动效不得导致光标跳动

允许修改：src/components/studio-ui.tsx、src/app/studio.css（或对应样式文件）
不要修改：src/lib/、tests/、其他组件

重要：现有测试会检查保存状态文案，所以不要改「正在保存本机草稿…」和「草稿已留在此设备」这两句文字，只加动效。

改完后必须运行并贴出完整输出：
1. npm run typecheck
2. npx vitest run
```

---

## Prompt 10 · 空白状态设计

```
请改进「拾念」的空白状态（empty state）。现在多数空白态是图标 + 标题 + 说明 + 按钮，结构对，但文案和视觉可以更贴合产品意象。

工作目录：C:\Users\qiqi\Desktop\我的第一个项目

需要处理的位置：
1. src/components/inspiration-collection.tsx 里的 empty 分支（多个场景）
2. src/components/echo-app.tsx 里的空状态（记录不存在、加载失败）
3. src/components/inspiration-collection.tsx 的闪卡橱窗空态

设计原则：
- 空白态不是错误，不要说"没有数据"这种话，要用引导性的语言
- 每种空白场景要说清"为什么这里是空的"和"怎么让它不空"
- 保持「星河 / 微光 / 拾起」的意象，不要变成通用后台的空状态

请检查现有的这些空态文案是否做到了上面两点：
- 「这里等着你的第一张闪卡」/「终点票，留给完成的那一刻」/「这一程，都完成了」/「还没找到这个念头」/「从一个念头开始」
- 对应的说明和按钮文案

如果某条不符合原则，给出改法并执行。如果都符合，明确告诉我"现有文案已符合，无需修改"——不要为了改而改。

允许修改：src/components/inspiration-collection.tsx、src/components/echo-app.tsx
不要修改：任何 .css、tests/、逻辑代码

改完后必须运行并贴出完整输出：
1. npm run typecheck
2. npx vitest run
```

---

## Prompt 11 · 灵感卡片悬停细节

```
请检查并改进「拾念」灵感集卡片的悬停/聚焦反馈。

工作目录：C:\Users\qiqi\Desktop\我的第一个项目
主要文件：src/components/inspiration-collection.tsx 里的 NoteCard、以及 inspiration-collection.module.css

检查项：
1. 卡片是否有清晰的键盘焦点环（不只是鼠标悬停效果）
2. 悬停时卡片标题和正文的可读性是否下降（背景动效可能影响文字对比度）
3. 已有 BorderGlow 边缘光效，确认它在触屏设备上不依赖 hover 也能看到卡片内容
4. 卡片右上角的箭头图标（openArrow）在悬停时的位移是否有过渡时间，是否过长
5. 是否遵守 prefers-reduced-motion

输出格式：先给问题清单（文件:行号、问题、影响、修法），再执行修复。

允许修改：src/components/inspiration-collection.tsx、src/components/inspiration-collection.module.css
不要修改：其他组件、src/lib/、tests/

改完后必须运行并贴出完整输出：
1. npm run typecheck
2. npx vitest run
```

---

## Prompt 12 · 全局自检（可定时跑）

> **这条适合定时任务用**。它只读不改，跑完给报告。

```
请对「拾念」项目做一次只读的全面自检。不要修改任何文件，只输出报告。

工作目录：C:\Users\qiqi\Desktop\我的第一个项目

请依次执行并报告：

1. 运行 npm run typecheck，报告是否通过
2. 运行 npx vitest run，报告测试数量和通过率
3. 运行 git status --short，列出所有未提交的改动
4. 检查 src/components/ 下所有 .tsx 文件，找出：
   - 超过 25 个字的用户可见中文句子（列出文件:行号和原文）
   - 同一个概念用了不同叫法的情况（术语不一致）
   - 直接渲染后端错误信息的位置（{xxxError} 这类）
5. 检查是否有 TODO、FIXME、console.log 残留在 src/ 下
6. 检查 .env 相关文件是否意外被 git 跟踪（应该只在 .gitignore 里）
7. 检查是否有测试文件被修改但源码没改（可能说明有人在"改测试让它通过"）

报告格式：
- 开头一句话总结：项目当前是否健康
- 每个检查项一节，包含：状态（通过/有问题）、证据、建议
- 如果发现任何"会威胁线上稳定性"的问题，用⚠️标出并放在最前面
```

---

## 附：怎么用这套 Prompt 最省事

### 用法一：你手动复制（最稳）

1. 打开 GPT 对话
2. 按上表顺序，从 Prompt 1 开始
3. 每次只发一条，等它改完、跑完检查、给你结果
4. 拿到结果后**叫我来验收**（我可以跑 `npm run ship -- --check-only` 确认真实状态）

### 用法二：让我直接派活给 GPT（已经验证可行）

我已经实测确认：**我能通过命令行直接给这台电脑上的 GPT（Codex）派活**，包括：
- 让它读你的项目文件并回答（已实测成功）
- 给它完整的改造任务
- 让它跑检查和测试

这意味着你不在的时候，我可以自动执行上面这些 Prompt。

**但有一个前提**：我不会在没告诉你的情况下改动代码。我会先跑 Prompt 12（只读自检）这类安全任务，把发现的问题写成报告等你决定。

### 用法三：定时任务

可以设置成每天/每周自动跑一次「Prompt 12 全局自检」，把报告留给你看。这样即使你没开口，也能知道项目有没有出问题——比如 GPT 改坏了什么、测试有没有挂、有没有未提交的改动堆积。

---

## 附：安全提醒

这 12 条 Prompt 都遵守同一套安全约束：

1. **限定改动范围**：每条都写明"允许改哪些文件""绝不要改哪些文件"，避免 GPT 顺手重构核心逻辑
2. **要求跑检查**：每条都要求 `npm run typecheck` + `npx vitest run`，并贴出完整输出
3. **失败即停**：写明"任何一步失败就停下报告，不要自行改测试"

**最重要的一条**：这些 Prompt 都只让 GPT 改代码，**不让它发布**。改完之后由你来决定要不要上线——发布走 `发布上线.cmd` 或 `npm run ship`，检查不过就不会覆盖线上。
