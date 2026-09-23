import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    // 默认 5 秒在忙的时候不够用：这些用例要挂载 React 组件、跑动画时序，
    // 机器一忙（比如构建同时在跑）就会超时，表现为"随机失败"。
    // 放宽到 20 秒，真正的死循环仍然会被抓住。
    testTimeout: 20_000,
    // beforeAll 里的 PGlite 要现启一个本地 PostgreSQL 实例，再建角色、
    // 建 schema、跑完整迁移脚本，比单个用例重得多。默认 30 秒在并发时
    // 会超时（表现为 "Hook timed out in 30000ms"，而单独跑该文件却通过）。
    hookTimeout: 120_000,
  },
});
