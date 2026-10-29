/** Durable job queues (SPEC §5.6) — implemented with pg-boss by apps/server. */
import type { Tx } from './db';
export const QUEUES = {
  cycles: 'cycles',
  notifications: 'notifications',
  webhooks: 'webhooks',
  github: 'github',
  importers: 'importers',
  importer_deadletter: 'importer_deadletter',
  import_reference_repair_deadletter: 'import_reference_repair_deadletter',
  import_reference_repairs: 'import_reference_repairs',
  maintenance: 'maintenance',
  exports: 'exports',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type ImportReferenceRepairJobData =
  | { type: 'scan'; repairId: string; previewVersion: number }
  | { type: 'apply'; repairId: string; previewHash: string };

export type ImportCommitJobData =
  | { type: 'commit'; runId: string; commitId: string; commitHash: string }
  /** Payload shape persisted by releases before commit lifecycle generations were added. */
  | { type: 'commit'; runId: string; commitId?: never; commitHash?: never };

export interface JobPayloads {
  cycles: { type: 'rotate_all' } | { type: 'rotate_team'; teamId: string };
  notifications: { type: 'drain_outbox' };
  webhooks: { type: 'deliver'; deliveryId: string };
  github: { type: 'process_event'; eventRowId: string } | { type: 'backfill'; installId: string };
  importers: ImportCommitJobData;
  importer_deadletter: ImportCommitJobData;
  import_reference_repairs: ImportReferenceRepairJobData;
  import_reference_repair_deadletter: ImportReferenceRepairJobData;
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
  send<Q extends QueueName>(queue: Q, data: JobPayloads[Q], opts?: SendJobOptions): Promise<string | null>;
  sendInTx<Q extends QueueName>(tx: Tx, queue: Q, data: JobPayloads[Q], opts?: SendJobOptions): Promise<string | null>;
}

/** No-op queue for tests / scripts; records sent jobs. */
export class MemoryJobQueue implements JobQueue {
  readonly sent: { queue: QueueName; data: unknown; opts?: SendJobOptions }[] = [];
  nextSendFailure: Error | 'null' | null = null;

  async send<Q extends QueueName>(queue: Q, data: JobPayloads[Q], opts?: SendJobOptions): Promise<string | null> {
    if (this.nextSendFailure instanceof Error) {
      const err = this.nextSendFailure;
      this.nextSendFailure = null;
      throw err;
    }
    if (this.nextSendFailure === 'null') {
      this.nextSendFailure = null;
      return null;
    }
    this.sent.push({ queue, data, opts });
    return `memory-job-${this.sent.length}`;
  }

  async sendInTx<Q extends QueueName>(_tx: Tx, queue: Q, data: JobPayloads[Q], opts?: SendJobOptions): Promise<string | null> {
    return this.send(queue, data, opts);
  }
}
