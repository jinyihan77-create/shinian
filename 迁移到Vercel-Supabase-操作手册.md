# 迁移到 Vercel + Supabase · 操作手册

> ## ⚠️ 本手册已作废，请勿执行
>
> **2026-09-25 用户决定：不需要其他人访问这个网站，自己一个人用就够了。**
>
> 因此不再上云——**不要注册 Supabase 或 Vercel 账号，不要跑 `setup:cloud`，不要部署**。
> 网站改为**纯本地运行**，数据存在本机。当前方案见 `给GPT的修复任务-脱离腾讯云.md`。
>
> 本文件保留作存档：如果将来又想让别人访问（比如放进作品集给面试官看），
> 这份手册里的步骤仍然有效，可直接复用。

---

日期：2026-09-25
起因：腾讯云体验版资源点耗光，站点被隔离（503 `Your server is isolated`）
目标：把网站迁到 **Vercel（托管）+ Supabase（数据库和账号）**，都是免费档，不再受腾讯云额度限制

---

## 先看清楚：要花多少钱、要做什么

| 项目 | 费用 | 谁来做 |
| --- | --- | --- |
| Supabase 账号（数据库+登录） | **0 元**（免费档） | **你本人**注册 |
| Vercel 账号（网站托管） | **0 元**（Hobby 档） | **你本人**注册 |
| AI 整理功能 | 可选，见下文 | 你决定 |

**我需要你做的事**：注册两个账号（都要邮箱验证/可能需要 GitHub），拿到 4 个字符串给我。

**我可以做的**：改配置、跑数据库初始化、部署、验收。

---

## 好消息：代码不用重写

这个项目**原本就是为 Vercel + Supabase 设计的**，后来才改到腾讯云。现在迁回去，是"改配置"而不是"重写代码"：

| 已有资产 | 位置 | 状态 |
| --- | --- | --- |
| Vercel 配置 | `vercel.json`（已指定新加坡节点） | ✅ 就绪 |
| 数据库建表脚本 | `supabase/migrations/` 三个 SQL 文件 | ✅ 就绪 |
| 一键初始化脚本 | `scripts/setup-cloud.mjs` | ✅ 就绪 |
| 部署校验脚本 | `scripts/check-deployment.mjs` | ✅ 就绪 |
| 代码切换开关 | `CLOUD_PROVIDER` 环境变量 | ✅ 就绪 |

代码里的判断逻辑（`src/lib/server/supabase.ts:12`）：

```
CLOUD_PROVIDER=cloudbase  → 走腾讯云（现在）
CLOUD_PROVIDER=supabase   → 走 Supabase（迁移后）
```

改一个词就切换。

---

## 第一步：注册 Supabase（你来做）

1. 打开 https://supabase.com ，点 **Start your project**，用邮箱注册（也可以用 GitHub 账号登录）
2. 登录后点 **New project**，填写：
   - **Name**：随便，比如 `shinian`
   - **Database Password**：点 **Generate a password** 自动生成，**然后复制保存下来**（后面要用）
   - **Region**：选 **Southeast Asia (Singapore)**，离中国最近
   - **Pricing Plan**：选 **Free**
3. 点 **Create new project**，等 2 分钟左右初始化完成

### 拿到这 4 个值（在 Project Settings 里）

| 要拿的值 | 在哪里找 | 长什么样 |
| --- | --- | --- |
| `SUPABASE_URL` | Settings → API → Project URL | `https://xxxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Settings → API → Project API keys → `anon` `public` | `eyJhbGci...` 很长一串 |
| `SUPABASE_SERVICE_ROLE_KEY` | 同页面 → `service_role` `secret` | `eyJhbGci...` 也很长 |
| `SUPABASE_DB_URL` | Settings → Database → Connection string → **URI** | `postgresql://postgres:...@...supabase.com:5432/postgres` |

⚠️ **注意**：
- `SUPABASE_DB_URL` 里的密码就是你刚才保存的数据库密码。如果 URL 里显示 `[YOUR-PASSWORD]`，要手动替换成真实密码
- `service_role` 是**管理员密钥**，只填进配置文件，**不要发给我、不要截图、不要提交到 git**

---

## 第二步：注册 Vercel（你来做）

1. 打开 https://vercel.com ，点 **Sign Up**，用邮箱或 GitHub 注册
2. 选 **Hobby**（免费档）
3. 注册完先不用建项目，我这边会用命令行部署

---

## 第三步：把值交给我（或者你自己填）

### 方式 A：你自己填（推荐，密钥不经我手）

打开项目目录的 `.env.local`，把内容替换成：

```bash
# ---------- 网站运行配置 ----------
CLOUD_PROVIDER=supabase

# ---------- Supabase（从上面第一步拿到）----------
SUPABASE_URL=你的 Project URL
SUPABASE_ANON_KEY=你的 anon key
SUPABASE_SERVICE_ROLE_KEY=你的 service_role key
SUPABASE_DB_URL=你的连接串（记得替换密码）

# ---------- 你的账号 ----------
OWNER_EMAIL=你的邮箱
OWNER_INITIAL_PASSWORD=你的网站登录密码（至少 12 位，含大小写+数字+符号）

# ---------- AI（可选，不填则 AI 整理不可用，其他功能正常）----------
OPENAI_API_KEY=
AI_MODEL=

# ---------- 部署后填 ----------
APP_ORIGIN=
```

保存后告诉我"填好了"，我继续下一步。

### 方式 B：你只给我账号，我来填

把 Supabase 和 Vercel 的登录信息给我，我来配置。
**但不推荐**——密钥会经过对话记录。你自己填更安全。

---

## 第四步：初始化数据库和账号（我来做）

你填好后，我执行：

```bash
npm run setup:cloud -- --apply
```

这个脚本会：
- 连接 Supabase，建 4 张表（`echo_private_members` / `echo_notes` / `echo_ai_usage` / `echo_checkins`）
- 创建你的私人账号
- 配置访问权限（只有你的邮箱能登录）

---

## 第五步：部署到 Vercel（我来做）

```bash
npx vercel login        # 需要你配合：会打开浏览器或给一个链接
npx vercel --prod       # 部署
```

`vercel login` 需要你本人在浏览器点确认，我替代不了。

---

## 第六步：验收（我来做）

部署完我会跑：

```bash
npm run verify:live -- --origin https://你的新地址.vercel.app
```

逐项验证登录、保存、AI、跨设备同步。

---

## AI 整理功能怎么办

代码支持两种方式（`src/lib/server/organize.ts:244`）：

| 方式 | 说明 | 成本 |
| --- | --- | --- |
| **不配** | AI 整理按钮会提示"未配置"，**其他功能全部正常** | 0 元 |
| **配 OpenAI** | 填 `OPENAI_API_KEY` + `AI_MODEL` | 按用量付费 |

不配不影响核心功能：记录、保存、检索、闪卡、打卡、待办票根都能用，只有"AI 整理"这一个按钮不可用。

**建议**：先不配，跑通了再说。

---

## 迁移后要改的事（避免重蹈覆辙）

腾讯云这次挂掉，根因是**我们自己的自动化烧光了额度**：

| 任务 | 频率 | 问题 |
| --- | --- | --- |
| 拾念-自动发布 | **每 5 分钟** | 每次访问线上 → 触发冷启动 → 烧额度 |
| 拾念-夜间监工 | 每 2 小时 | 真实登录线上站 + 双端截图 |

**我已经把这两个任务都停掉了**（`Disabled` 状态，可恢复）。

迁移后建议：

1. **自动发布改成手动触发**，或者改成"只在本地检查、不碰线上"
2. **夜间监工改成只查本地**（`--origin=http://localhost:3000`），不再访问线上
3. Vercel 免费档没有这类"资源点"概念，但频繁调用也会影响构建额度，仍建议降低频率

---

## 需要你决定的事

现在需要你回答一个问题：

**1. 你自己注册账号填配置（推荐），还是把账号给我代填？**

如果你选自己填，按上面第一步、第二步做，然后告诉我"填好了"。
如果遇到卡住的地方，随时问我。

---

## 重要：等待迁移期间，你照样能改代码

云端挂了**不影响你继续做设计**。我实测过：

| 能力 | 现在能不能用 | 怎么用 |
| --- | --- | --- |
| 改代码、看效果 | ✅ 能用 | 双击 **`启动灵感回声.cmd`** |
| 看界面预览（`/design-preview`） | ✅ 能用 | 启动后打开 `http://localhost:3000/design-preview` |
| 手机上看效果 | ⚠️ 需要在同一 WiFi 下 | 用电脑的局域网地址 `http://172.31.86.134:3000` |
| 跑测试和类型检查 | ✅ 能用 | 双击 `自检.cmd`，或让我跑 |
| 发布到线上 | ❌ 不能用 | 等迁移完成 |
| 手机和电脑同步 | ❌ 不能用 | 等迁移完成 |

**关键**：`/design-preview` 这个页面**完全不需要登录、不碰云端**，所有界面改动都能在这里看。你之前做的设计迭代基本都在这个页面上。

所以你现在的流程可以是：

```
启动灵感回声.cmd  →  浏览器打开 localhost:3000/design-preview  →  看效果、改代码
```

**手机上看**：手机连同一个 WiFi，浏览器输入 `http://172.31.86.134:3000/design-preview`

（`172.31.86.134` 是你电脑现在在 WiFi 里的地址，**重启路由器或换网络后会变**。变了的话，双击 `启动灵感回声.cmd` 后窗口里会显示新地址，或者问我。）

---

## 附：为什么不用原来的腾讯云

| | 腾讯云体验版 | Vercel + Supabase |
| --- | --- | --- |
| 费用 | 0 元但有额度上限 | 0 元，额度宽松得多 |
| 额度 | **3000 资源点/月，3 天就用光了** | Vercel 100GB 带宽/月，Supabase 500MB 数据库 |
| 网站地址 | 测试域名，访问有"风险提醒"中间页 | 正式域名，无中间页 |
| 自定义域名 | ❌ 免费版配额为 0 | ✅ 免费支持 |
| 国内访问速度 | 上海节点，快 | 新加坡节点，稍慢但可用 |

**另一个好处**：迁到 Vercel 后，别人打开你的链接不会先看到"测试域名"警告页——你录视频、给面试官看都更干净。
