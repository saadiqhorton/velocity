import { eventOutbox } from '@velocity/schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { DomainEvent, EventPayloads, EventTopic } from './contracts';

// Any drizzle executor: the root db or a transaction.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Executor = NodePgDatabase<any> | PgTransaction<any, any, any>;

/**
 * Append a domain event to the outbox. MUST be called with the same transaction that
 * performs the mutation so the event commits atomically with the change (SPEC §5.5 step 1).
 */
export async function publish<K extends EventTopic>(tx: Executor, topic: K, payload: EventPayloads[K]): Promise<void> {
  await tx.insert(eventOutbox).values({ topic, payload: payload as unknown as Record<string, unknown> });
}

export async function publishMany(tx: Executor, events: DomainEvent[]): Promise<void> {
  if (events.length === 0) return;
  await tx
    .insert(eventOutbox)
    .values(events.map((e) => ({ topic: e.topic, payload: e.payload as unknown as Record<string, unknown> })));
}
