/**
 * 发布账本：手动发布（发布上线.cmd / npm run ship）和自动发布共用同一份记录。
 *
 * 为什么要共用：自动发布判断"有没有新改动"的依据是"上次发布的那个提交"。
 * 如果你手动发布过一次，而自动发布不知道，它会把同一批内容再发布一次——
 * 白跑十几分钟的构建和测试，线上也会多一个没必要的版本。
 *
 * 状态文件在 test-results/auto-publish/state.json（已在 .gitignore 里，不进版本库）。
 */
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STATE_DIR = path.join(project, "test-results", "auto-publish");
export const STATE_FILE = path.join(STATE_DIR, "state.json");
export const CONFIG_FILE = path.join(project, "auto-publish.config.json");
export const LOG_FILE = path.join(STATE_DIR, "auto-publish.log");
export const projectRoot = project;

export const HISTORY_LIMIT = 30;
const MAX_LOG_BYTES = 512 * 1024;

const stamp = () => new Date().toLocaleString("zh-CN", { hour12: false });

/** 写日志：同时进日志文件和控制台。本模块只记录版本名与文件名，不涉及任何密钥。 */
export async function writeLog(message, { echo = false } = {}) {
  const line = `[${stamp()}] ${message}`;
  if (echo) console.log(line);
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await appendFile(LOG_FILE, line + "\n", "utf8");
    const info = await stat(LOG_FILE).catch(() => null);
    if (info && info.size > MAX_LOG_BYTES) {
      // 超限就只留后半段，避免无限增长。
      const raw = await readFile(LOG_FILE, "utf8");
      await writeFile(LOG_FILE, raw.slice(-Math.floor(MAX_LOG_BYTES / 2)), "utf8");
    }
  } catch {
    // 日志写不进去不能影响发布本身。
  }
}

export async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveState(state) {
  await mkdir(STATE_DIR, { recursive: true });
  const next = { ...state };
  if (Array.isArray(next.history) && next.history.length > HISTORY_LIMIT) {
    next.history = next.history.slice(-HISTORY_LIMIT);
  }
  await writeFile(STATE_FILE, JSON.stringify(next, null, 2), "utf8");
}

export async function appendHistory(state, summary) {
  return [...(state.history ?? []), { at: new Date().toISOString(), summary }];
}

export function formatTime(iso) {
  if (!iso) return "未知";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "未知";
  }
}
