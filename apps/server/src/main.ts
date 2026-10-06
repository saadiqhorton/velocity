import { createApp, createLogger } from './app';
import { loadConfig } from './config';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  const logger = createLogger(config.logLevel);
  if (config.appSecretGenerated) logger.info('APP_SECRET was not set: generated a new secret and saved it to APP_SECRET_FILE (keep that file with your backups)');
  const app = await createApp(config, { logger });
  const { port } = await app.listen();
  logger.info({ port, role: config.role, appUrl: config.app.appUrl }, 'velocity is running');

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 20_000);
    force.unref();
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
}

void main();
