export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return 0;
  if (/^\d+$/.test(value.trim())) {
    const milliseconds = Number(value) * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : 0;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

// Contrato provisório: confirmar estes campos com o responsável pelo PHP.
export function interpretResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { result: 'unconfirmed' };
  const flags = [body.success, body.ok].filter(v => v !== undefined);
  const failed = flags.some(v => v === false || v === 0 || v === 'false') ||
    ['error', 'failed', 'failure'].includes(body.status) || Boolean(body.error) || Boolean(body.errors && (!Array.isArray(body.errors) || body.errors.length));
  if (failed) return { result: 'business_error' };
  const confirmed = flags.some(v => v === true) || body.status === 'success';
  const processed = body.processed ?? body.participants_processed;
  return { result: confirmed ? 'success' : 'unconfirmed',
    ...(Number.isSafeInteger(processed) && processed >= 0 ? { processed } : {}) };
}

export async function syncOnce(config, { signal, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetchImpl(config.url, { method: 'POST', redirect: 'manual',
      headers: { Authorization: `Bearer ${config.key}`, Accept: 'application/json' }, signal: controller.signal });
    const httpStatus = response.status;
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
    if (!response.ok) {
      await response.body?.cancel();
      return { result: [401, 403].includes(httpStatus) ? 'auth_error' : 'http_error', httpStatus,
        retryable: [429, 502, 503, 504, 500].includes(httpStatus), retryAfterMs };
    }
    // Limite de memória; não armazenar listas de participantes nem registrá-las.
    const reader = response.body?.getReader();
    let size = 0;
    const chunks = [];
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) { await reader.cancel(); return { result: 'response_too_large', httpStatus }; }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return { result: 'invalid_json', httpStatus }; }
    return { ...interpretResponse(body), httpStatus };
  } catch {
    return { result: signal?.aborted ? 'cancelled' : timedOut ? 'timeout' : 'network_error', retryable: false };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
