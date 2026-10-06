import { fileURLToPath } from 'node:url';

/**
 * The bundled build (dist/main.js, dist/seed-cli.js, dist/migrate-cli.js) ships the SQL in
 * dist/migrations next to itself; from source (tsx/vitest) the schema package resolves its own.
 */
export function migrationsFolderFor(moduleUrl: string): string | undefined {
  if (!fileURLToPath(moduleUrl).endsWith('.js')) return undefined;
  return fileURLToPath(new URL('./migrations', moduleUrl));
}

export const migrationsFolder = (): string | undefined => migrationsFolderFor(import.meta.url);
