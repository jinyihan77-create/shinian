# 给 GPT 的修复任务：脱离腾讯云、恢复本地开发能力

> 写于 2026-09-25。以下每条都基于对磁盘源码和腾讯云 CLI 的真实核查，不是推测。
> **请按 P0 → P1 → P2 顺序做，每完成一条就把"自证"贴出来**（跑了什么命令、真实输出是什么）。
> 不要凭印象说"已修复"——此前发生过自报"已改成 86px"而源码仍是 18px 的情况。

---

## 先读这两份，不要重复劳动

1. **`迁移到Vercel-Supabase-操作手册.md`**（项目根目录，2026-09-25 写的）——已有迁移方案，
   **本任务书的 P2 与它有重叠，以它为准**，不要另写一份。
2. **`给GPT的修复任务.md`** / `-第二轮.md` / `-移动端布局.md`——界面修复类任务，与本次无关，
   但**不要回退**它们已完成的改动。

**另外两件事已经做过了，不要再做**：
- 「拾念-自动发布」和「拾念-夜间监工」两个计划任务**已停用**（`Disabled` 状态，可一键恢复）。
  本次只需改配置文件把总开关也关掉（见 P0-1）。
- 用户已明确说过「腾讯云里的笔记不要了，我没有喜欢的笔记」。
  所以 **P0-2 的导出脚本属于"备选"**：优先做本地模式（P1-1），导出脚本只在用户明确要求时再做。

---

## 背景：为什么脱离

腾讯云环境 `echo-77-d3gm5g3t081337d79`（上海体验版）**已被隔离**，实测证据：

| 检查项 | 实测结果 |
|---|---|
| 线上访问 | `HTTP 503` + `SERVICE_FORBIDDEN` / `Your server is isolated` |
| `tcb db execute` | `instance status must be Running to execute SQL, current: Isolated` |
| 网关登录 | `HTTP 429` + `RESOURCE_EXHAUSTED` |
| 资源点 | 3000 / 3000 **已超额**（本期消耗 3298.62 点，其中云托管 2771 点，占 84%） |
| 环境到期日 | 2027-03-22（**不是到期问题，是额度烧光**） |

**结论**：不是代码问题，是额度问题。根因是**我们自己的自动化**——「自动发布」每 5 分钟访问一次线上站，
每次触发云托管冷启动，3 天烧光一个月额度。

**绝对不要删除腾讯云环境**，也不要执行 `tcb env delete` 等销毁命令。

---

## P0-1：止血 —— 关掉自动发布总开关

计划任务已停用，但配置文件里的总开关还是开的，两者都要关：

改 `auto-publish.config.json`：

```json
{
  "enabled": false,
  "quietMinutes": 5,
  "retryCooldownMinutes": 30,
  "healthCheckRetries": 3,
  "autoRollback": true
}
```

脚本已支持这个开关（`scripts/auto-publish.mjs:438` 有 `if (!config.enabled)` 分支），**改一行即可，不要改脚本逻辑**。

**顺带**：`scripts/ship.mjs:235` 无条件执行 `deploy-tencent.mjs`。请改成部署前先探测云端可用性，
不可用时打印「云端不可用，已跳过部署，本地检查全部通过」并**正常退出（退出码 0）**。
`deploy-tencent.mjs` 保留不删。

**自证**：贴出 `npm run auto:status` 输出，确认显示「总开关：已关闭」。

---

## P1-1：加本地模式，让开发能继续（本次重点）

**问题**：现在 `npm run dev` 能启动，但**登录页会卡住**——它去打腾讯云网关 → 429 → 进不了工作区。
`src/components/private-workspace.tsx:82-93` 有"云端未接通"分支，但只显示"你的空间正在准备中"，没有出口。

**注意**：`/design-preview` 页面不需要登录、不碰云端（实测 HTTP 200），改纯界面的活可以直接用它。
但涉及记录、保存、检索、闪卡的改动，就必须有登录后的完整环境——这就是本地模式的用途。

**要做的**：加环境变量开关 `ECHO_LOCAL_MODE=1`，为真时走完全本地的通道：

1. **跳过登录**：`src/app/api/auth/session/route.ts` 在本地模式下直接返回
   `{configured: true, authenticated: true, user: {id: "local-owner", email: "local@localhost"}}`。

2. **数据落本地 PostgreSQL（PGlite）**——**不要手写 IndexedDB 业务逻辑**：
   项目已有 `@electric-sql/pglite` 依赖，测试就是这么用的：`tests/cloud-notes.test.ts:24` 起，
   用 `new PGlite()` 跑 `supabase/migrations/` 的完整 SQL，然后直接调 8 个 RPC。
   **照抄这个模式**：

   - 服务端启动时初始化一个 PGlite 实例，数据目录放项目内 `private-data/pglite/`
     （`private-data/` 已在 `.gitignore` 里，无需再改）。
   - 跑 `supabase/migrations/` 下的 3 个 SQL（**用这套，不要用 `cloudbase/migrations/` 那套**，
     两套函数名一样但这是"回退到原设计"的方向）。
   - 实现一个最小的 `DataClient` 适配器（接口定义在 `src/lib/server/data-client.ts`：`{from, rpc}`），
     内部转成 PGlite 的 SQL。**RPC 调用样板见 `tests/cloud-notes.test.ts:41` 的 `call()` 函数**，
     含每个函数需要的类型转换（`casts` 映射表）。
   - 在 `src/lib/server/supabase.ts:29` 的 `createPrivateClient()` 里加本地模式分支，返回这个适配器。

   **这样做的理由**：`src/lib/server/cloud-notes.ts`（203 行）里的版本冲突、AI 状态机、
   导入去重逻辑**一行都不用改**，全部复用。8 个 RPC：`echo_create_note` / `echo_update_note` /
   `echo_delete_note` / `echo_import_notes` / `echo_begin_ai` / `echo_finish_ai` /
   `echo_fail_ai` / `echo_recover_ai`。

3. **`.env.local` 加一行** `ECHO_LOCAL_MODE=1`，并把 `CLOUD_PROVIDER` **注释掉（加 `#`）**，
   **不要删除**该行。

4. **AI 在本地模式下**：`src/lib/server/access.ts:9` 的 provider 判断在非 cloudbase 时走
   OpenAI 分支（`https://api.openai.com/v1/responses`，需要 `OPENAI_API_KEY`，本机没有）。
   所以本地模式下 AI 整理应**明确提示"AI 未配置"**，同时保证记录可保存、可编辑。
   `access.ts:56` 的 `serviceStatus()` 已处理该降级，确认它正常工作即可——
   **不要为了"让 AI 能用"去接任何付费服务**。

**验收（逐条贴真实输出）**：

```bash
npx tsc --noEmit    # 必须 0 错误
npm test            # 必须 26 文件 / 230 用例全过（当前基线）
npm run dev         # 浏览器打开 http://localhost:3000
```

浏览器里必须做到：登录页**直接进入工作区**（不再卡"正在准备中"）→ 新建记录 → 刷新后**记录还在**
（证明真落盘）→ 改标题 → 删除。每步截图或文字描述真实结果。

---

## P1-2：硬编码地址收口

以下位置硬编码了已死的 `https://inspiration-echo-318255-10-1492602203.sh.run.tcloudbase.com`：

- `scripts/health-check.mjs:15`（`ORIGIN` 常量）
- `scripts/night-watch*.mjs`（6 个文件的 `DEFAULT_ORIGIN` / `origin` 默认值）
- `scripts/probe-landing-scroll.mjs:7`
- `scripts/ship.mjs:248`、`:273`（提示文案里的命令示例）
- 文档：`README.md:7`、`:11`、`验收记录.md:5`、`部署配置清单.md:7`、`页面体检-使用说明.md:33`

要求：脚本里的默认值改成**从 `.env.local` 的 `APP_ORIGIN` 读取，读不到就明确报错退出**，
不再硬编码域名。文档类文件在开头加一行：
`> 2026-09-25 起腾讯云环境已因额度超额被隔离，本文件记录的地址当前不可访问。`

**不要改** `s.json`（腾讯云 CLI 的原始返回存档）。
**另外**：监工类脚本在地址不可达时，**不要把"连不上"当成"页面有 bug"写进报告**。

---

## P2：迁移文档（**不要执行任何注册或部署**）

`迁移到Vercel-Supabase-操作手册.md` 已经写好，**以它为准，不要新写一份**。
你只需补充或订正其中缺失的技术细节：

1. 代码现状：数据协议层是 `src/lib/server/data-client.ts` 的 `DataClient = {from, rpc}`，
   全仓只有 **2 个构造点**——`src/lib/server/supabase.ts:32` 的 `createServerClient()`（Supabase，已就绪）
   和 `src/lib/server/tencent-auth.ts:213` 的 `PostgrestClient()`（腾讯，待废）。
2. **两套迁移 SQL 已核对完全等价**：`supabase/migrations/*.sql` 与 `cloudbase/migrations/*.sql`
   各含 **15 个同名函数**，`diff` 无差异。所以换到 Supabase 只需跑 `supabase/migrations/`，
   **业务代码零改动**。
3. 切换只需把 `CLOUD_PROVIDER` 从 `cloudbase` 改成 `supabase`
   （判断逻辑在 `src/lib/server/supabase.ts:12` 和 `src/lib/server/tencent-auth.ts:33`）。

**不要执行**：不要注册账号、不要部署、不要跑 `setup:cloud`。用户还没决定何时迁。

---

## 不要改（重要）

1. **`supabase/migrations/` 下的 3 个 SQL**——这是换新家的资产，一字不改。
2. **`src/lib/server/cloud-notes.ts` 的 8 个 RPC 调用与语义**——本地模式要复用它，改了会连锁破坏。
3. **`tests/` 目录**——不许为了让测试变绿而修改断言或删用例。
   **当前基线：26 文件 / 230 用例全过**（2026-09-25 11:26 实测）。
4. **`.env.tencent-owner.local`**——含网站登录密码与数据库导出凭据，**不许删、不许改、不许读出来打印**。
5. **`.env.local` 的腾讯配置项**——可以注释掉，**不要删除**。
6. **腾讯云环境**——不要删除或销毁。

---

## 验收清单

```bash
npx tsc --noEmit                       # 0 错误
npm test                               # 26 文件 / 230 用例全过
npm run dev                            # http://localhost:3000 直接进工作区
npm run auto:status                    # 显示总开关「已关闭」
```

**每条都要贴真实输出，不接受"应该可以了"这类描述。**
