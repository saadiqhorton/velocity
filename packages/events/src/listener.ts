import type { Pool, PoolClient, Notification } from 'pg';
import type { OutboxEvent } from './contracts';

export const OUTBOX_CHANNEL = 'velocity_events';

interface Row {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

function toEvent(r: Row): OutboxEvent {
  return { id: Number(r.id), topic: r.topic, payload: r.payload, createdAt: r.created_at } as unknown as OutboxEvent;
}

export interface OutboxListenerOptions {
  /** Fallback poll interval when no NOTIFY arrives (covers dropped notifications). */
  pollIntervalMs?: number;
  /** Rows committed out of order within this window are still delivered (dedup by id). */
  lateWindowSeconds?: number;
  onError?: (err: unknown) => void;
}

/**
 * Per-process realtime fan-out (SPEC §5.5 step 2): LISTEN on the outbox channel and deliver
 * every new row to in-process subscribers (GraphQL subscriptions). Every app instance gets
 * every event. Late-committing transactions (lower ids committing after higher ones) are
 * caught by re-scanning a short time window and de-duplicating by id.
 */
export class OutboxListener {
  private client: PoolClient | null = null;
  private lastSeen = 0;
  private recent = new Map<number, number>();
  private subscribers = new Set<(e: OutboxEvent) => void>();
  private draining = false;
  private pending = false;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly pollIntervalMs: number;
  private readonly lateWindowSeconds: number;
  private readonly onError: (err: unknown) => void;

  constructor(
    private readonly pool: Pool,
    opts: OutboxListenerOptions = {},
  ) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
    this.lateWindowSeconds = opts.lateWindowSeconds ?? 30;
    this.onError = opts.onError ?? (() => {});
  }

  subscribe(fn: (e: OutboxEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  async start(): Promise<void> {
    const res = await this.pool.query<{ max: string | null }>('select max(id) as max from event_outbox');
    this.lastSeen = Number(res.rows[0]?.max ?? 0);
    await this.connect();
    this.timer = setInterval(() => void this.drain(), this.pollIntervalMs);
    this.timer.unref();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    try {
      const client = await this.pool.connect();
      client.on('notification', (n: Notification) => {
        if (n.channel === OUTBOX_CHANNEL) void this.drain();
      });
      client.on('error', (err) => {
        this.onError(err);
        this.client = null;
        try {
          client.release(true);
        } catch {
          /* already released */
        }
        setTimeout(() => void this.connect(), 1000).unref();
      });
      await client.query(`LISTEN ${OUTBOX_CHANNEL}`);
      this.client = client;
      void this.drain();
    } catch (err) {
      this.onError(err);
      setTimeout(() => void this.connect(), 1000).unref();
    }
  }

  async drain(): Promise<void> {
    if (this.draining) {
      this.pending = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.pending = false;
        const res = await this.pool.query<Row>(
          `select id, topic, payload, created_at from event_outbox
           where id > $1 or (id > $1 - 5000 and created_at > now() - make_interval(secs => $2))
           order by id limit 1000`,
          [this.lastSeen, this.lateWindowSeconds],
        );
        const now = Date.now();
        for (const r of res.rows) {
          const id = Number(r.id);
          if (this.recent.has(id)) continue;
          this.recent.set(id, now);
          if (id > this.lastSeen) this.lastSeen = id;
          const ev = toEvent(r);
          for (const fn of this.subscribers) {
            try {
              fn(ev);
            } catch (err) {
              this.onError(err);
            }
          }
        }
        // Forget ids older than the late window (+ margin).
        const cutoff = now - (this.lateWindowSeconds + 30) * 1000;
        for (const [id, seenAt] of this.recent) {
          if (seenAt < cutoff && id < this.lastSeen - 5000) this.recent.delete(id);
          else if (seenAt < cutoff - 60_000) this.recent.delete(id);
        }
        if (res.rows.length === 1000) this.pending = true;
      } while (this.pending);
    } catch (err) {
      this.onError(err);
    } finally {
      this.draining = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.client) {
      try {
        await this.client.query(`UNLISTEN ${OUTBOX_CHANNEL}`);
      } catch {
        /* ignore */
      }
      this.client.release();
      this.client = null;
    }
  }
}

/**
 * Exactly-once (per deployment) processing of outbox rows for side effects such as
 * notification fan-out and webhook enqueueing. Claims unpublished rows with
 * FOR UPDATE SKIP LOCKED inside a transaction, runs the handler with that same client
 * (so side-effect writes commit atomically with `published_at`), then commits.
 */
export async function processOutboxBatch(
  pool: Pool,
  handler: (client: PoolClient, events: OutboxEvent[]) => Promise<void>,
  limit = 200,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const res = await client.query<Row>(
      `select id, topic, payload, created_at from event_outbox
       where published_at is null order by id limit $1 for update skip locked`,
      [limit],
    );
    if (res.rows.length === 0) {
      await client.query('commit');
      return 0;
    }
    await handler(client, res.rows.map(toEvent));
    await client.query('update event_outbox set published_at = now() where id = any($1::bigint[])', [
      res.rows.map((r) => r.id),
    ]);
    await client.query('commit');
    return res.rows.length;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
