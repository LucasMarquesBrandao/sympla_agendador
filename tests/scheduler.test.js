import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../src/scheduler.js';
const config = { intervalMs: 300000, maxRetries: 2 };
test('duas tentativas simultâneas executam uma chamada', async () => {
  let calls = 0;
  let finish;
  const scheduler = createScheduler(config, () => {}, { sync: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = scheduler.cycle();
  assert.equal(await scheduler.cycle(), null);
  finish({ result: 'success' }); await first;
  assert.equal(calls, 1);
});
test('retoma após falha temporária e aplica backoff limitado', async () => {
  let calls = 0;
  const delays = [];
  const scheduler = createScheduler(config, () => {}, {
    sync: async () => ++calls < 3 ? { result: 'http_error', retryable: true, retryAfterMs: 600000 } : { result: 'success' },
    pause: async ms => { delays.push(ms); }
  });
  assert.equal((await scheduler.cycle()).result, 'success');
  assert.equal(calls, 3); assert.deepEqual(delays, [600000, 600000]);
});
test('esgota retentativas e não repete autenticação', async () => {
  for (const retryable of [true, false]) {
    let calls = 0;
    const scheduler = createScheduler(config, () => {}, { sync: async () => { calls++; return { result: 'error', retryable }; }, pause: async () => {} });
    await scheduler.cycle(); assert.equal(calls, retryable ? 3 : 1);
  }
});
test('encerramento cancela requisição e aguarda conclusão', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let cancelled = false;
  const scheduler = createScheduler(config, () => {}, { sync: (_, { signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => { cancelled = true; resolve({ result: 'cancelled' }); }, { once: true });
    started();
  }) });
  const task = scheduler.start(); await ready; await scheduler.stop(); await task;
  assert.equal(cancelled, true);
});
test('próximo ciclo acontece após falha de rede e respeita intervalo', async () => {
  let calls = 0;
  let scheduler;
  const delays = [];
  scheduler = createScheduler(config, () => {}, {
    sync: async () => { calls++; return { result: calls === 1 ? 'network_error' : 'success' }; },
    pause: async ms => { delays.push(ms); if (calls === 2) void scheduler.stop(); }
  });
  await scheduler.start(); assert.equal(calls, 2); assert.deepEqual(delays, [300000, 300000]);
});
