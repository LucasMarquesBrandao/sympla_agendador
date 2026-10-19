import net from 'node:net';
import { loadEnvironment, readConfig } from './config.js';
import { createLogger } from './logger.js';
import { createScheduler } from './scheduler.js';

const log = createLogger();
let lock;
try {
  loadEnvironment();
  const config = readConfig();
  if (process.argv.includes('--check')) {
    log('configuration_valid');
  } else {
    // Trava de processo local; nenhuma rota HTTP nem exposição externa.
    lock = net.createServer(socket => socket.destroy());
    await new Promise((resolve, reject) => {
      lock.once('error', reject);
      lock.listen({ host: '127.0.0.1', port: 43781, exclusive: true }, resolve);
    });
    const scheduler = createScheduler(config, log);
    const shutdown = () => { log('shutdown_requested'); void scheduler.stop(); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    try { log('service_started'); await scheduler.start(); }
    finally {
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
    }
    log('service_stopped');
  }
} catch (error) {
  // Erros do carregador .env podem conter valores: nunca imprimir a exceção.
  log('startup_or_runtime_error', { reason: error?.code === 'EADDRINUSE' ? 'instance_already_running' : 'check_configuration_and_runtime' });
  process.exitCode = 1;
} finally {
  if (lock?.listening) await new Promise(resolve => lock.close(resolve));
}
