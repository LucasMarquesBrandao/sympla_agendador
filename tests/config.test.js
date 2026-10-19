import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('carrega .env real em diretório temporário sem rede ou exposição da chave', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sympla-config-'));
  try {
    const env = { ...process.env };
    for (const name of Object.keys(env)) {
      if (name.startsWith('SYNC_') || name === 'AUTO_SYNC_SECONDS' || name === 'TZ') delete env[name];
    }
    writeFileSync(join(directory, '.env'), `SYNC_WEB_KEY=${'b'.repeat(64)}\nSYNC_INTERVAL_SECONDS=600\nAUTO_SYNC_SECONDS=600\nTZ=America/Sao_Paulo\n`);
    cpSync(fileURLToPath(new URL('../src/', import.meta.url)), join(directory, 'src'), { recursive: true });
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    for (const cwd of [directory, join(directory, 'src')]) {
      const result = spawnSync(process.execPath, [join(directory, 'src', 'index.js'), '--check'], {
        cwd, env, encoding: 'utf8'
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /configuration_valid/);
      assert.ok(!result.stdout.includes('b'.repeat(64)));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
