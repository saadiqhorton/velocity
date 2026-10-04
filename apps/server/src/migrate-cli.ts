import pg from 'pg';
import { runMigrations } from '@velocity/schema/migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 2 });
await runMigrations(pool);
await pool.end();
console.log('migrations up to date');
