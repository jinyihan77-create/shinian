# 补充修复任务（第二轮）

第一轮修好了语音按钮的**状态逻辑**（`src/components/studio-ui.tsx` 已改成待机/请求权限/聆听/错误四态），但**样式没跟上**。以下是实测确认的缺口。

---

## 任务 1（P0）：`.last-thought` 仍然完全没有样式

**现状核实**：全仓搜索 `src/**/*.css`，**仍然 0 条 `.last-thought` 规则**。第一轮没有修这个。

**位置**：`src/components/echo-app.tsx:374`

```tsx
{recent[0] && <button className="last-thought" onClick={() => navigate("note", recent[0].id)}><span>上一次记下</span><span>{recent[0].title}</span><ArrowUpRight size={14} /></button>}
```

**线上实测的计算样式**（手机端 390×844）：

| 属性 | 实测值 |
|---|---|
| `display` | `block`（三个子元素没有布局关系） |
| `padding` | `0px` |
| `border-radius` | `0px` |
| `background` | `transparent` |
| `border-width` | `0px` |
| `text-align` | `center`（继承来的，导致文字被迫居中） |

**实测到的子元素几何**（说明布局是散的）：
- `span` "上一次记下"：`x=29, y=789, w=79, h=21`（16px 常规字重）
- `span` 标题：`x=108, y=789, w=253, h=47`（换行到第二行）
- `ArrowUpRight` 箭头：单独落到 `y=843` 最左侧

**要的效果**：
- flex 横排容器：左侧文字区（竖排两行），右侧箭头按钮
- "上一次记下" → 小字号（11-12px）+ 低对比度（`opacity ~0.6`）作为标签
- 标题 → 较大字号 + 高对比度，**单行省略号截断**（`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`）
- 卡片自身：淡背景 + 圆角 + 内边距，风格与页面其他卡片一致（参考 `.voice-siri-dock` 的玻璃质感）
- 建议加在 `src/app/studio.css` 或 `aero-theme.css`（与同类卡片放一起）

**验证标准**：`node scripts/night-watch-auto.mjs` 跑完后，`test-results/night-watch/auto-report.md` 里
`.last-thought 无任何样式` 这条**必须消失**。

---

## 任务 2（P1）：语音按钮的新状态没有对应样式

**现状核实**：`src/components/studio-ui.tsx:214` 现在会输出这三个新 class：

```tsx
className={`voice-siri-dock ${recording ? "is-recording" : ""} ${requesting ? "is-requesting" : ""} ${hasError ? "is-error" : ""}`}
```

但 `src/app/aero-theme.css` 里**只有 `.voice-siri-dock.is-recording`**（992-1030 行附近），
**`.is-requesting` 和 `.is-error` 都没有定义**（已 grep 确认）。

**后果**：用户点击语音按钮后，按钮进入"正在请求权限"或"错误"状态，但**视觉上完全没变化**——和修复前"点了没反应"的体验一样。这正是用户抱怨的核心问题。

**要的效果**：
- `.voice-siri-dock.is-requesting`：明确表达"正在等待授权"，例如脉动边框/呼吸光效（注意 `prefers-reduced-motion: reduce` 下要有静态可辨识的替代表现，不能只靠动画）
- `.voice-siri-dock.is-error`：明确的错误色（偏红/暖橙），与正常态明显区分
- 两个状态都要保证在**手机上**一眼可辨（截图验证）

**顺便**：`.voice-input-wrap` 现在也输出 `has-error` class，检查它是否也需要样式。

---

## 任务 3（P1）：手机端同步状态文字

**线上实测**：`.sync-indicator` 按钮宽 28px，内部文字 span「已同步」为 `display: none`，
只剩一个 6×6px 的小圆点。用户不知道那是什么。

**要的效果**：手机上至少可辨识状态。失败状态（`syncState === "error"`）**必须**在视觉上明显区别于正常态。

---

## 任务 4（P2）：两处可点区域过小

| 元素 | 实测 | 位置 |
|---|---|---|
| "先看看界面预览" | 94×17px（桌面）/ 86×15px（手机） | `src/app/page.tsx` |
| "画作出处 · 大都会艺术博物馆" | 340×15px | 打卡页 |

增加垂直 `padding` 使可点高 ≥ 44px（文字视觉大小可不变）。

---

## 重要：不要动这些

1. **不要跑 `npm run ship`**（发布由用户决定）
2. **不要改「行动票」(task-tickets) 相关代码** —— 另一个会话正在改那部分，`tests/cloud-client.test.ts`、`tests/cloud-notes.test.ts`、`tests/data.test.ts` 目前各有 1 项失败，是那边在改导致的，**不是你的任务**
3. 不要改 `.last-thought` 的 JSX 结构（只补 CSS），除非确实需要
4. 文件里标注「已排除的问题」不要动

---

## 完成后

跑 `npx tsc --noEmit` 确认类型通过，然后**只看** `tests/source-voice-ui.test.tsx` 是否仍然通过
（其他测试文件的失败属于并行会话的范围，不用管）：

```bash
npx vitest run tests/source-voice-ui.test.tsx
```

最后用中文说明：改了哪些文件、每处改了什么。
