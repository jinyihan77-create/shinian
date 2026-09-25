# 给 GPT 的修复任务：脱离腾讯云、改成纯本地运行

> 写于 2026-09-25，**末尾附有修订记录**（原版有 8 处经核实不准确的地方，已逐条改正）。
> **按 P0 → P1 → P2 顺序做，每完成一条贴出真实命令输出作为自证。**
> 不接受"应该可以了"这类描述——此前发生过自报"已改成 86px"而源码仍是 18px 的情况。

> **给 GPT 的两条使用须知**：
> 1. 文中所有行号**仅供参考**，文件一直在被并行修改。**动手前请自己搜一遍定位**，以搜到的实际内容为准。
> 2. 文中标注 ✅ 的条目是**已经完成的**，不要重复做。

---

## 先读这段：目标已经变了

**用户 2026-09-25 明确决定：不需要其他人访问这个网站，自己一个人用就行。**

这意味着**放弃上云方案**，不做 Vercel、不注册 Supabase、不买域名、不管备案。
网站跑在本机浏览器里，数据存在本机。

**因此以下文件里的"上云"内容全部作废，不要执行**：
- `迁移到Vercel-Supabase-操作手册.md` —— **整份作废**，不要注册账号、不要跑 `setup:cloud`。
  但**不要删除**这个文件，保留存档。
- `腾讯云部署步骤.md`、`部署配置清单.md` —— 作废，保留存档。

**已经做过的、不要重复**：
- 「拾念-自动发布」「拾念-夜间监工」两个计划任务**已停用**（`Disabled`，可恢复）。
- 用户已说过「腾讯云里的笔记不要了，我没有喜欢的笔记」→ **不需要数据导出脚本**。

---

## 背景：为什么脱离腾讯云

环境 `echo-77-d3gm5g3t081337d79`（上海体验版）**已被隔离**，实测：

| 检查项 | 实测结果（2026-09-25 11:52 复现） |
|---|---|
| 线上访问 | `HTTP 503` + `SERVICE_FORBIDDEN` / `Your server is isolated` |
| `tcb db execute --sql "select 1"` | `[ExecutePGSql] instance status must be Running to execute SQL, current: Isolated` |
| `tcb env list` | 显示 `Status: Normal` ← **会骗人，别信这个字段** |

### 资源点（`npx tcb env usage` 实测，计费周期 2026-09-22 ~ 2026-10-22）

```
套餐内资源点：2504.81 已用 / 3000.00 总额
资源包用量：   0.00 点
按量计费：     298.63 点
合计消耗：     2803.44 点
```

按模块拆（**云托管是绝对主因**）：

| 模块 | 消耗 |
|---|---|
| **云托管** | **2771.3 点**（占合计的 98.9%）|
| API 调用 | 24.71 点 |
| HTTP 网关 | 7.43 点 |
| 其他（云函数/存储/AI/静态托管/认证） | 均为 0 |

⚠️ **注意**：先前文档里写的"消耗 3298.62 点"是**算错的**——那是把套餐总额 3000 和按量计费 298.62
错误相加了（3000 + 298.62 = 3298.62）。正确合计是 **2803.44**。云托管占比也因此是 98.9% 而非 84%。

根因：**我们自己的自动化烧的**——「自动发布」每 5 分钟访问线上站触发容器冷启动，3 天把额度用光。

**不要删除腾讯云环境**，不要执行 `tcb env delete` 等销毁命令。

---

## P0：止血

1. **关掉自动发布总开关**——改 `auto-publish.config.json`：

```json
{
  "enabled": false,
  "quietMinutes": 5,
  "retryCooldownMinutes": 30,
  "healthCheckRetries": 3,
  "autoRollback": true
}
```

脚本已支持该开关（`scripts/auto-publish.mjs:438` 有 `if (!config.enabled)` 分支），
**改一行即可，不要改脚本逻辑**。

✅ **2026-09-25 11:40 复查：这一条已经完成**（`auto-publish.config.json` 里 `enabled: false`）。
不需要重复做，只需要在最终验收时用 `npm run auto:status` 确认仍显示「已关闭」。

2. **`scripts/ship.mjs` 无条件执行腾讯云部署**：

现在的位置在文件末尾（`const deploy = await run("发布到云托管", ...)`，搜 `发布到云托管` 即可定位）。
**注意：不要用行号定位**——这份文档写好后文件已被改过，行号会漂移。

改成：部署前先探测云端可用性，不可用时打印「云端不可用，已跳过部署，本地检查全部通过」
并**正常退出（退出码 0）**。`deploy-tencent.mjs` 保留不删。

同时把文件里两处提示文案的地址换成从配置读取（搜 `verify:live -- --origin` 可定位）。

3. **硬编码死站地址收口**。**已用脚本逐文件扫描核实（2026-09-25 11:48），只剩 4 个文件**：

| 文件 | 处数 | 定位方式 |
|---|---|---|
| `scripts/health-check.mjs` | 1 处 | `const ORIGIN =` 那一行（约第 15 行） |
| `scripts/probe-landing-scroll.mjs` | 1 处 | `const ORIGIN =` 那一行（约第 7 行） |
| `scripts/ship.mjs` | 2 处 | 搜 `verify:live -- --origin`（**约 281 / 306 行，但会漂移，请搜索定位**） |
| `scripts/shoot-video-assets.mjs` | 1 处 | 第 43 行的 `origin:` 默认值 |

✅ **`scripts/night-watch*.mjs` 系列（9 个文件）已经改好了，不要动**——它们已经改成读
`.env.local` 的 `APP_ORIGIN`，读不到就抛错（见 `night-watch.mjs:46-47`）。
**本任务书早先版本说要改它们，那条已过时。**

文档里也有死站地址，需要加一行声明（**只是加声明，不需要删地址**）：

| 文件 | 位置 |
|---|---|
| `README.md` | 第 7 行、第 11 行 |
| `验收记录.md` | 第 5 行 |
| `部署配置清单.md` | 第 7 行所在段落、第 11 行附近 |
| `页面体检-使用说明.md` | 第 33 行 |

   脚本改成从 `.env.local` 的 `APP_ORIGIN` 读取，读不到就明确报错退出。
   文档在开头加一行：`> 2026-09-25 起腾讯云环境已因额度超额被隔离，本文件记录的地址当前不可访问。`
   **不要改 `s.json`**（腾讯云 CLI 原始返回存档）。

**自证**：贴出 `npm run auto:status` 输出，确认显示「总开关：已关闭」。

---

## P1：做成本地模式（本次重点）

**目标**：双击启动脚本 → 浏览器打开 → **直接用，不用登录，数据存在本机**。

### 现状

- `npm run dev` 能启动（已绑 `0.0.0.0`），但**登录页会卡住**：它去打腾讯云网关 → 429 → 进不了工作区。
  `src/components/private-workspace.tsx:82-93` 有"云端未接通"分支，但只显示"你的空间正在准备中"，没有出口。
- `/design-preview` 页面不登录、不碰云端（实测 HTTP 200），改纯界面可以直接用它。
  但涉及记录、保存、检索、闪卡的改动，必须有能进入的完整环境——这就是本地模式的用途。

### 要做的

加环境变量开关 `ECHO_LOCAL_MODE=1`（这个命名是新的，全仓搜索无冲突），为真时走完全本地的通道：

**1. 跳过登录**

`src/app/api/auth/session/route.ts` 在本地模式下直接返回：

```ts
{ configured: true, authenticated: true, user: { id: "local-owner", email: "local@localhost" } }
```

`user.id` 必须是**合法 UUID 格式**，因为后续所有 RPC 都要求 UUID。
建议用固定值 `00000000-0000-4000-8000-000000000001`（带正确的 version/variant 位）。

**2. 数据落本地 PostgreSQL（PGlite）——不要手写 IndexedDB 业务逻辑**

**✅ 依赖已就绪**：`@electric-sql/pglite` 已在 `dependencies`（`package.json:49`），
**不需要从 devDependencies 移动**（本任务书早先版本说需要移动，那条已过时）。

**✅ 持久化已实测可用**（2026-09-25 用真实脚本验证过，不是推测）：

```js
new PGlite("./private-data/pglite")   // 传入目录路径即落盘
```

实测结果：写入数据后目录下生成 22 个文件（`base` / `global` / `pg_commit_ts` / `pg_dynshmem` 等）；
`await db.close()` 之后用同一目录重新 `new PGlite()`，**数据完整读回**。

这正是"永久使用"的技术保证：关掉服务、重启电脑数据都在。
**请务必沿用这个 `dataDir` 方式，不要改成内存模式**（内存模式一关就丢）。

测试里已有完整可抄的实现，见 `tests/cloud-notes.test.ts:52-61` 的 `beforeAll`：

```
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
```

然后跑 `supabase/migrations/202609210001_private_library.sql`（**用 supabase 这套，
不要用 `cloudbase/migrations/` 那套**），再插入用户与白名单：

```sql
insert into auth.users(id) values($1);
insert into public.echo_private_members(user_id) values($1);
```

**为什么必须建 `auth` schema 和 `auth.uid()`**：SQL 里有 `references auth.users(id)` 和
`auth.uid()` 调用，这是 PostgreSQL/Supabase 的约定，PGlite 不自带，必须手工补上。
测试已经证明这个做法可行——**照抄即可，不要另发明方案**。

**3. 写一个 `DataClient` 适配器**

接口定义在 `src/lib/server/data-client.ts`：`{from, rpc}`。
内部转成 PGlite 的 SQL。**RPC 调用样板见 `tests/cloud-notes.test.ts:39` 的 `call()` 函数**，
含每个函数需要的类型转换（`casts` 映射表，第 41 行起）：

```ts
echo_create_note: ["uuid","jsonb","jsonb"], echo_update_note: ["uuid","bigint","text","jsonb"],
echo_delete_note: ["uuid","bigint"], echo_import_notes: ["jsonb"], echo_begin_ai: ["uuid","integer"],
echo_finish_ai: ["uuid","uuid","integer","jsonb","text"], echo_fail_ai: ["uuid","uuid","text"],
```

打卡的三个函数（`echo_get_checkin` / `echo_create_checkin` / `echo_update_checkin`）参数更多，
按 `src/lib/server/cloud-checkins.ts:29-35` 的 `p_*` 参数名对齐，并参考 `tests/checkin.test.ts` 的用法。

**身份注入**：每次调用前按测试的 `user()` 函数做法设置：

```sql
select set_config('request.jwt.claim.sub', '<local-owner-uuid>', false);
set role authenticated;
```

**4. 接到现有代码上**

在 `src/lib/server/supabase.ts:29` 的 `createPrivateClient()` 里加本地模式分支，返回这个适配器。

**这样做的收益**：`src/lib/server/cloud-notes.ts`（203 行）和 `cloud-checkins.ts`（53 行）里的
版本冲突检测、AI 状态机、导入去重、打卡日切逻辑**一行都不用改**，全部复用。
8+3 个 RPC 函数原样工作。

**5. 数据存放位置**

PGlite 数据目录放项目内 `private-data/pglite/`。
`private-data/` **已在 `.gitignore` 里**（第 15 行），无需修改 `.gitignore`。

**6. `.env.local` 调整**

加一行 `ECHO_LOCAL_MODE=1`；把 `CLOUD_PROVIDER` **注释掉（前面加 `#`）**，**不要删除该行**。

**7. AI 功能的降级处理**

`src/lib/server/access.ts:9` 在非 cloudbase 时走 OpenAI 分支（需 `OPENAI_API_KEY`，本机没有）。
本地模式下 AI 整理、语音来源识别、AI 清理这些按钮应**明确提示"AI 未配置"**，
同时保证**记录可保存、可编辑、可检索、闪卡和打卡都能用**。
`access.ts:56` 的 `serviceStatus()` 已实现该降级，确认它正常工作即可。

**不要为了"让 AI 能用"去接任何付费服务**——用户对花钱敏感。

**8. 启动体验**

确认「启动灵感回声.cmd」双击后能直接进工作区。若需要额外提示（比如"数据存在本机"），
文字加在 `scripts/dev-local.mjs` 里（该文件已有中文输出，`cmd` 只放 ASCII 是既定约定，别破坏）。

### 验收（逐条贴真实输出）

```bash
npx tsc --noEmit    # 必须 0 错误
npm test            # 必须 26 文件 / 230 用例全过（当前基线，2026-09-25 11:26 实测）
npm run dev         # 浏览器打开 http://localhost:3000
```

浏览器里必须实际做到，每步截图或文字描述真实结果：

1. 打开首页 → 登录页**直接进入工作区**（不再卡"正在准备中"）
2. 新建一条记录 → 保存
3. **刷新页面 → 记录还在**（证明真的落盘，不是内存里）
4. 改标题 → 保存 → 刷新后仍在
5. 删除该记录 → 刷新后确实没了
6. **关掉服务再重新启动 → 记录仍在**（证明写进了磁盘文件，不是进程内存）
7. 打卡功能能打开、能保存

第 6 条是关键，**必须真的重启验证**。

---

## P2：整理文档（只写，不执行任何注册或部署）

1. **`迁移到Vercel-Supabase-操作手册.md`**：在开头加一段醒目的作废声明——
   用户已决定不需要外部访问，改为纯本地运行，本手册暂不执行；保留供将来参考。
2. **`README.md`**：把"生产路线是腾讯云"那一节改成当前真实状态——
   网站运行在本机、数据在 `private-data/pglite/`、腾讯云已停用、启动方式是双击 `启动灵感回声.cmd`。
3. **新建 `docs/本地模式说明.md`**（简短即可）：怎么启动、数据在哪、怎么备份
   （用界面里的「导出完整备份」）、换电脑怎么搬（拷 `private-data/` 目录）、
   以后想上云时的切换点在哪里。

**不要执行**：不注册账号、不部署、不跑 `setup:cloud`。

---

## 不要改（重要）

1. **`supabase/migrations/` 下的 3 个 SQL**——本地模式要跑它们，一字不改。
   （已核实是 3 个文件：`202609210001_private_library.sql` / `202609210002_daily_checkins.sql` / `202609230001_seven_star_checkins.sql`）
2. **`src/lib/server/cloud-notes.ts` / `cloud-checkins.ts` 的 RPC 调用与语义**——
   本地模式要复用，改了会连锁破坏。（已核实：203 行 / 53 行）
3. **`tests/` 目录**——不许为了让测试变绿而修改断言或删用例。
   **基线：26 文件 / 230 用例全过**（2026-09-25 11:39 实测确认）。
   注意 `vitest.config.ts:16` 已有 `hookTimeout: 120_000`，是修并发超时的；不要动它。
4. **`.env.tencent-owner.local`**——含密码，**不许删、不许改、不许读出来打印**。
5. **`.env.local` 的腾讯配置项**——可以注释掉，**不要删除**。
   （已核实：里面共有 5 个腾讯相关配置项：`CLOUD_PROVIDER` / `CLOUDBASE_ENV_ID` / `CLOUDBASE_REGION` / `CLOUDBASE_AI_MODEL` / `CLOUDBASE_APIKEY`）
6. **腾讯云环境**——不要删除或销毁。
7. **`docs/` 下已有的 PRD 文件**——不要改动。
   （已核实有 4 个：`PRD-2026-09-23-体验修复与原创设计恢复.md` / `PRD-一念入星河-摘星体验重构.md` / `PRD-拾念私人星卡与拾光手账.md` / `UX审查-七七私人使用版.md`）

---

## 验收清单

```bash
npx tsc --noEmit     # 0 错误
npm test             # 26 文件 / 230 用例全过
npm run dev          # http://localhost:3000 直接进工作区，可增删改查，重启后数据仍在
npm run auto:status  # 显示总开关「已关闭」
```

**每条都要贴真实输出。**

另外**必须验证磁盘落盘**（这是本地模式的核心，不能只看界面"看起来能保存"）：

```bash
# 启动、写入一条记录、然后关掉服务
ls private-data/pglite/          # 应该能看到 PGlite 生成的文件（base/ global/ pg_commit_ts 等）
# 重新启动，记录仍在 → 才算真的成功
```

---

## 本任务书的修订记录

**2026-09-25 11:45 修订**（由 ZCode 核实后更新，逐条对照过磁盘源码）：

| 原先写的 | 实际情况 | 已修正为 |
|---|---|---|
| 资源点"消耗 3298.62 点，云托管占 84%" | **算错了**。正确合计 **2803.44**（2504.81 套餐内 + 298.63 按量），云托管 2771.3 点占 **98.9%** | 已重写背景表格，附完整拆解 |
| pglite 在 `devDependencies`，需移到 `dependencies` | 已在 `dependencies`（`package.json:49`） | 标注"已就绪，不需要移动" |
| `auto-publish.mjs:438` 有开关分支 | ✅ 正确 | 保留，并标注"P0-1 已完成" |
| `ship.mjs:235` 执行部署 | 行号已漂移 | 改为"搜 `发布到云托管` 定位，不要用行号" |
| `ship.mjs:248` 和 `:273` 含地址 | 实际在 **281 和 306 行** | 改为"搜 `verify:live -- --origin` 定位" |
| night-watch 系列"6 个文件"需要改地址 | **9 个文件全都已经改好了**（读 `APP_ORIGIN`，读不到就抛错） | **从待改清单移除**，标注"不要动" |
| 未提及 `shoot-video-assets.mjs` | 第 43 行也有死站地址 | 已加入清单 |
| `tests/cloud-notes.test.ts:41` 的 `call()` | 正确位置是 **第 39 行**（41 行起是 casts 表） | 已修正 |
| 未说明持久化已验证 | 已实测 PGlite 落盘可用 | 新增实测结论 + "不要改成内存模式"的警告 |

**结论：脚本层面只剩 4 个文件需要收口**（health-check / probe-landing-scroll / ship / shoot-video-assets），
不是原任务书说的十几个。**先做 P1（本地模式），P0-3 可以放到最后**。

**给 GPT 的提醒**：这份任务书里的行号仅供参考，**动手前请先自己搜一遍定位**。
文件一直在被并行修改，行号会漂移。以实际搜索到的内容为准。
