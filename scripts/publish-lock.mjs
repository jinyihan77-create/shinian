/**
 * 发布互斥锁：保证同一时刻只有一个发布流程在跑。
 *
 * 为什么需要：自动发布（每 5 分钟检查一次）和你手动双击「发布上线.cmd」可能撞在一起。
 * 两个 `tcb cloudrun deploy` 同时执行会互相干扰（云端构建、流量切换冲突），
 * 结果可能是一个进程失败，或者线上被切到一个你没预期的版本。
 *
 * 用法（配合 try/finally 保证释放）：
 *   import { acquirePublishLock } from "./publish-lock.mjs";
 *   const lock = await acquirePublishLock({ owner: "手动发布" });
 *   if (!lock.ok) { … 提示已在发布中，直接退出 … }
 *   try { …发布流程… } finally { await lock.release(); }
 *
 * 陈旧锁处理：如果持锁进程已不存在（崩溃、被强制关闭、断电），
 * 超过 STALE_MS 后会被自动回收，避免"永远发布不了"。
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_DIR = path.join(project, "test-results");
const LOCK_FILE = path.join(LOCK_DIR, "publish.lock");
/** 超过这个时长且持锁进程已消失，视为陈旧锁。 */
const STALE_MS = 45 * 60_000;

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM 代表进程存在但不属于我们，也算存活。
    return error.code === "EPERM";
  }
}

async function readLock() {
  try {
    const raw = await readFile(LOCK_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {{owner?: string, waitMs?: number}} [options]
 *   waitMs：拿不到锁时最多等待多久（默认不等待，立即返回失败）。
 * @returns {Promise<{ok: boolean, release: () => Promise<void>, heldBy?: string}>}
 */
export async function acquirePublishLock({ owner = "发布流程", waitMs = 0 } = {}) {
  await mkdir(LOCK_DIR, { recursive: true });
  const deadline = Date.now() + Math.max(0, waitMs);
  const payload = () =>
    JSON.stringify({ pid: process.pid, owner, startedAt: new Date().toISOString() }, null, 2);

  for (;;) {
    try {
      // wx：文件已存在就直接失败，不做覆盖。
      await writeFile(LOCK_FILE, payload(), { flag: "wx" });
      return {
        ok: true,
        release: async () => {
          const current = await readLock();
          // 只删自己的锁，避免误删后来者的锁。
          if (current?.pid === process.pid) await rm(LOCK_FILE, { force: true });
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    const current = await readLock();
    const age = current?.startedAt ? Date.now() - Date.parse(current.startedAt) : Number.POSITIVE_INFINITY;

    // 持锁进程已消失且锁已过期 → 回收。
    if (!current || !isAlive(current.pid) || !Number.isFinite(age) || age > STALE_MS) {
      await rm(LOCK_FILE, { force: true });
      continue;
    }

    if (Date.now() >= deadline) {
      return {
        ok: false,
        heldBy: `${current.owner || "另一个发布流程"}（开始于 ${current.startedAt || "未知时间"}）`,
        release: async () => {},
      };
    }
    await new Promise(resolve => setTimeout(resolve, 3_000));
  }
}

/** 只读查询，用于状态显示与「立即发布」前的友好提示。 */
export async function describePublishLock() {
  const current = await readLock();
  if (!current) return null;
  if (!isAlive(current.pid)) return null;
  return { owner: current.owner || "发布流程", startedAt: current.startedAt || null, pid: current.pid };
}
