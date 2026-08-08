import { loadConfig } from './config.js';
import { runDaemon } from './daemon.js';

/** Daemon entrypoint (design "main.ts + launcher"): any boot error is logged
 * and exits 1; a successful boot lives until SIGTERM/SIGINT triggers the
 * ordered graceful shutdown (which exits 0 itself). */
try {
  await runDaemon(loadConfig());
} catch (error) {
  console.error('[daemon] boot failed:', error);
  process.exit(1);
}
