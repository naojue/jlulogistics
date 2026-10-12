/** Shared by all store instances in the serial production worker. */
export function createGitHubWritePacer(
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let nextWrite = 0;
  let queue = Promise.resolve();
  return {
    wait() {
      const turn = queue.then(async () => {
        for (;;) {
          const remaining = nextWrite - now();
          if (remaining <= 0) break;
          // Keep each wait bounded; deferred rate-limit windows may be much longer.
          await sleep(Math.min(remaining, 30_000));
        }
        nextWrite = now() + 8000;
      });
      queue = turn.catch(() => {});
      return turn;
    },
    deferUntil(timestamp: number) {
      if (Number.isFinite(timestamp)) nextWrite = Math.max(nextWrite, timestamp);
    },
  };
}
export type GitHubWritePacer = ReturnType<typeof createGitHubWritePacer>;
export const githubWritePacer = createGitHubWritePacer();
