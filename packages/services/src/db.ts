import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { tables } from '@velocity/schema';

export type Db = NodePgDatabase<typeof tables>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema: tables });
}
