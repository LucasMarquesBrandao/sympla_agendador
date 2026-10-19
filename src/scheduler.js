import { setTimeout as sleep } from 'node:timers/promises';
import { syncOnce } from './syncClient.js';
import { localTime } from './logger.js';

// Usa fatias para não sofrer overflow no setTimeout com Retry-After muito longo.
export async function wait(ms, signal) {
  const deadline = Date.now() + ms;
  while (!signal.aborted && Date.now() < deadline) {
    await sleep(Math.min(deadline - Date.now(), 60000), undefined, { signal });
  }
}

export function createScheduler(config, log, { sync = syncOnce, pause = wait } = {}) {
  const controller = new AbortController();
  let running = false;
  let task;
  async function cycle() {
    if (running || controller.signal.aborted) return null;
    running = true;
    let outcome;
    try {
      for (let attempt = 0; attempt <= config.maxRetries && !controller.signal.aborted; attempt++) {
        log('sync_start', { attempt: attempt + 1 });
        const start = Date.now();
        outcome = await sync(config, { signal: controller.signal });
        log('sync_end', { attempt: attempt + 1, durationMs: Date.now() - start,
          httpStatus: outcome.httpStatus, result: outcome.result, processed: outcome.processed });
        if (!outcome.retryable || attempt === config.maxRetries || controller.signal.aborted) break;
        const delay = Math.max(config.intervalMs, 60000 * 2 ** attempt, outcome.retryAfterMs || 0);
        log('retry_scheduled', { nextAttempt: localTime(new Date(Date.now() + delay)) });
        await pause(delay, controller.signal);
      }
      return outcome;
    } finally { running = false; }
  }
  async function loop() {
    while (!controller.signal.aborted) {
      const outcome = await cycle();
      if (controller.signal.aborted) break;
      const delay = Math.max(config.intervalMs, outcome?.retryAfterMs || 0);
      log('next_cycle', { nextAttempt: localTime(new Date(Date.now() + delay)) });
      await pause(delay, controller.signal);
    }
  }
  return {
    cycle,
    start() {
      task ??= loop().catch(error => { if (!controller.signal.aborted) throw error; });
      return task;
    },
    async stop() { controller.abort(); await task; }
  };
}
