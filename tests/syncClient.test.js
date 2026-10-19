import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { syncOnce, interpretResponse, parseRetryAfter } from '../src/syncClient.js';

const config = readConfig({ SYNC_WEB_KEY: 'a'.repeat(64) });
const request = (body, status = 200, headers = {}) => syncOnce(config, {
  fetchImpl: async (url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, `Bearer ${config.key}`);
    return new Response(body, { status, headers });
  }
});
test('sucesso e quantidade informada', async () => {
  assert.deepEqual(await request('{"success":true,"processed":5}'), { result: 'success', processed: 5, httpStatus: 200 });
});
test('configuração valida chave, HTTPS, limites e intervalo PHP', () => {
  for (const env of [{}, { SYNC_WEB_KEY: 'short' }, { SYNC_WEB_KEY: config.key, SYNC_URL: 'http://example.org' },
    { SYNC_WEB_KEY: config.key, SYNC_INTERVAL_SECONDS: '59' },
    { SYNC_WEB_KEY: config.key, AUTO_SYNC_SECONDS: '600' },
    { SYNC_WEB_KEY: config.key, SYNC_TIMEOUT_MS: 'abc' }]) assert.throws(() => readConfig(env));
});
test('401/403 não repetem', async () => {
  for (const status of [401, 403]) {
    const result = await request('private', status);
    assert.equal(result.result, 'auth_error'); assert.equal(result.retryable, false);
  }
});
test('500/502/503/504 permitem retentativa', async () => {
  for (const status of [500, 502, 503, 504]) assert.equal((await request('', status)).retryable, true);
});
test('429 respeita Retry-After em segundos e data', async () => {
  assert.equal((await request('', 429, { 'Retry-After': '600' })).retryAfterMs, 600000);
  assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60000);
  assert.equal(parseRetryAfter('invalid'), 0);
});
test('JSON inválido e erro de negócio não são sucesso', async () => {
  assert.equal((await request('<html>error</html>')).result, 'invalid_json');
  assert.equal((await request('{"success":false}')).result, 'business_error');
  assert.equal(interpretResponse({}).result, 'unconfirmed');
  assert.equal(interpretResponse({ ok: true, errors: ['failure'] }).result, 'business_error');
});
test('timeout não repete operação de resultado desconhecido', async () => {
  const result = await syncOnce({ ...config, timeoutMs: 5 }, { fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  assert.equal(result.result, 'timeout'); assert.equal(result.retryable, false);
});
test('falha de conexão não repete imediatamente', async () => {
  assert.equal((await syncOnce(config, { fetchImpl: async () => { throw new Error(config.key); } })).result, 'network_error');
});
test('limite da resposta e redirecionamento', async () => {
  assert.equal((await request('x'.repeat(65537))).result, 'response_too_large');
  assert.equal((await request('', 302)).result, 'http_error');
});
test('logs não recebem corpo, cabeçalhos ou exceções do servidor', async () => {
  const lines = [];
  const log = createLogger(line => lines.push(line));
  log('sync_end', { ...await request(JSON.stringify({ success: false, error: config.key, email: 'participant@example.org' })),
    body: config.key, headers: config.key });
  assert.ok(!lines.join('').includes(config.key));
  assert.ok(!lines.join('').includes('participant@example.org'));
});
