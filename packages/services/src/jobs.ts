/** Durable job queues (SPEC §5.6) — implemented with pg-boss by apps/server. */
export const QUEUES = {
  cycles: 'cycles',
  notifications: 'notifications',
  webhooks: 'webhooks',
  github: 'github',
  importers: 'importers',
  maintenance: 'maintenance',
  exports: 'exports',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobPayloads {
  cycles: { type: 'rotate_all' } | { type: 'rotate_team'; teamId: string };
  notifications: { type: 'drain_outbox' };
  webhooks: { type: 'deliver'; deliveryId: string };
  github: { type: 'process_event'; eventRowId: string } | { type: 'backfill'; installId: string };
  importers: { type: 'commit'; runId: string };
  maintenance: { type: 'daily' } | { type: 'outbox_sweep' };
  exports: { type: 'workspace_export'; exportId: string };
}

export interface SendJobOptions {
  startAfterSeconds?: number;
  singletonKey?: string;
  retryLimit?: number;
  retryDelaySeconds?: number;
  retryBackoff?: boolean;
}

export interface JobQueue {
  send<Q extends QueueName>(queue: Q, data: JobPayloads[Q], opts?: SendJobOptions): Promise<void>;
}

/** No-op queue for tests / scripts; records sent jobs. */
export class MemoryJobQueue implements JobQueue {
  readonly sent: { queue: QueueName; data: unknown; opts?: SendJobOptions }[] = [];
  async send<Q extends QueueName>(queue: Q, data: JobPayloads[Q], opts?: SendJobOptions): Promise<void> {
    this.sent.push({ queue, data, opts });
  }
}
