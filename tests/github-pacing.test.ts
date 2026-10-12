import { expect, it } from "vitest";
import { createGitHubWritePacer } from "../src/services/github-pacing";
it("并发写请求排队，共享间隔并遵循远端冷却时间，等待不超过30秒一段", async () => {
  let now = 1_000_000;
  const waits: number[] = [];
  const pacer = createGitHubWritePacer(
    () => now,
    async (ms) => {
      waits.push(ms);
      now += ms;
    },
  );
  const initial = now;
  await Promise.all([pacer.wait(), pacer.wait(), pacer.wait()]);
  expect(now - initial).toBe(16_000);
  pacer.deferUntil(now + 120_000);
  const before = now;
  await pacer.wait();
  expect(now - before).toBe(120_000);
  expect(Math.max(...waits)).toBeLessThanOrEqual(30_000);
});
it("大量小文件的写请求在任意一小时内保持低于500次", async () => {
  let now = 1_000_000;
  const timestamps: number[] = [];
  const pacer = createGitHubWritePacer(
    () => now,
    async (ms) => {
      now += ms;
    },
  );
  for (let i = 0; i < 1005; i++) {
    await pacer.wait();
    timestamps.push(now);
  }
  expect(timestamps.filter((time) => time < timestamps[0] + 3_600_000)).toHaveLength(450);
  expect(timestamps.at(-1)! - timestamps[0]).toBe(1004 * 8000);
});
