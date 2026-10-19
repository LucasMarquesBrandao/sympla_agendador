import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

export function loadEnvironment() {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  if (existsSync(envPath)) loadEnvFile(envPath);
}

export function readConfig(env = process.env) {
  const integer = (name, fallback, min, max) => {
    const value = env[name] ?? String(fallback);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
      throw new Error(`Configuração inválida: ${name} (permitido: ${min} a ${max}).`);
    }
    return Number(value);
  };
  let url;
  try { url = new URL(env.SYNC_URL ?? 'https://paineldemulheres.pibdobrasil.org/sync.php'); }
  catch { throw new Error('Configuração inválida: SYNC_URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
    throw new Error('SYNC_URL deve usar HTTPS, sem credenciais, fragmentos ou parâmetros.');
  }
  const key = env.SYNC_WEB_KEY;
  if (!key || key.length < 48 || !/^[\x21-\x7e]+$/.test(key) || key.includes('SUBSTITUIR')) {
    throw new Error('SYNC_WEB_KEY é obrigatória: use pelo menos 48 caracteres ASCII sem espaços.');
  }
  const intervalMs = integer('SYNC_INTERVAL_SECONDS', 300, 60, 86400) * 1000;
  const autoSyncSeconds = integer('AUTO_SYNC_SECONDS', 300, 0, 86400);
  if (intervalMs < autoSyncSeconds * 1000) throw new Error('SYNC_INTERVAL_SECONDS deve ser >= AUTO_SYNC_SECONDS da Locaweb.');
  if (env.TZ && env.TZ !== 'America/Sao_Paulo') throw new Error('TZ deve ser America/Sao_Paulo.');
  return Object.freeze({ url: url.href, key, intervalMs,
    timeoutMs: integer('SYNC_TIMEOUT_MS', 240000, 1000, 900000),
    maxRetries: integer('SYNC_MAX_RETRIES', 2, 0, 5) });
}
