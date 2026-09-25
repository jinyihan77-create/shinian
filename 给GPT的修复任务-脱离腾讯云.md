# 给 GPT 的修复任务：脱离腾讯云、改成纯本地运行

> 写于 2026-09-25。每条都基于对磁盘源码和腾讯云 CLI 的真实核查，不是推测。
> **按 P0 → P1 → P2 顺序做，每完成一条贴出真实命令输出作为自证。**
> 不接受"应该可以了"这类描述——此前发生过自报"已改成 86px"而源码仍是 18px 的情况。

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

| 检查项 | 实测结果 |
|---|---|
| 线上访问 | `HTTP 503` + `SERVICE_FORBIDDEN` / `Your server is isolated` |
| `tcb db execute` | `instance status must be Running to execute SQL, current: Isolated` |
| 资源点 | 3000 / 3000 **已超额**（消耗 3298.62 点，云托管 2771 点占 84%） |

根因：**我们自己的自动化烧的**——「自动发布」每 5 分钟访问线上站触发容器冷启动，3 天烧光一个月额度。

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

2. **`scripts/ship.mjs:235` 无条件执行腾讯云部署**：

```js
const deploy = await run("发布到云托管", "node", ["scripts/deploy-tencent.mjs", "--yes"], STEP_TIMEOUT.deploy);
```

改成：部署前先探测云端可用性，不可用时打印「云端不可用，已跳过部署，本地检查全部通过」
并**正常退出（退出码 0）**。`deploy-tencent.mjs` 保留不删。

3. **硬编码死站地址收口**。受影响位置：
   `scripts/health-check.mjs:15`、`scripts/night-watch*.mjs`（6 个文件的 `DEFAULT_ORIGIN` / `origin` 默认值）、
   `scripts/probe-landing-scroll.mjs:7`、`scripts/ship.mjs:248` 和 `:273`、
   文档 `README.md:7` `:11`、`验收记录.md:5`、`部署配置清单.md:7`、`页面体检-使用说明.md:33`。

   改成从 `.env.local` 的 `APP_ORIGIN` 读取，读不到就明确报错退出。
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

项目已有 `@electric-sql/pglite` 依赖（目前在 `devDependencies`，**需要移到 `dependencies`**，
因为运行时要真的用它）。测试里已有完整可抄的实现，见 `tests/cloud-notes.test.ts:52-61` 的 `beforeAll`：

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
内部转成 PGlite 的 SQL。**RPC 调用样板见 `tests/cloud-notes.test.ts:41` 的 `call()` 函数**，
含每个函数需要的类型转换（`casts` 映射表）：

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
2. **`src/lib/server/cloud-notes.ts` / `cloud-checkins.ts` 的 RPC 调用与语义**——
   本地模式要复用，改了会连锁破坏。
3. **`tests/` 目录**——不许为了让测试变绿而修改断言或删用例。
   **基线：26 文件 / 230 用例全过**。
4. **`.env.tencent-owner.local`**——含密码，**不许删、不许改、不许读出来打印**。
5. **`.env.local` 的腾讯配置项**——可以注释掉，**不要删除**。
6. **腾讯云环境**——不要删除或销毁。
7. **`docs/` 下已有的 PRD 文件**——不要改动。

---

## 验收清单

```bash
npx tsc --noEmit     # 0 错误
npm test             # 26 文件 / 230 用例全过
npm run dev          # http://localhost:3000 直接进工作区，可增删改查，重启后数据仍在
npm run auto:status  # 显示总开关「已关闭」
```

**每条都要贴真实输出。**
