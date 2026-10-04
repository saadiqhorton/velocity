/**
 * Domain event contracts (SPEC §5.12). Events are appended to `event_outbox` inside the
 * mutating transaction, then fanned out (WS subscriptions, notifications, webhooks).
 * Payloads carry entity deltas + actor, never full issue bodies.
 */

export type ActorKind = 'user' | 'api_key' | 'mcp' | 'github' | 'system' | 'import';

export interface ActorRef {
  kind: ActorKind;
  userId: string | null;
  apiKeyId?: string | null;
  mcpSessionId?: string | null;
}

export interface FieldChange {
  from: unknown;
  to: unknown;
}

export interface EventPayloads {
  'issue.created': { issueId: string; teamId: string; identifier: string; actor: ActorRef };
  'issue.updated': {
    issueId: string;
    teamId: string;
    identifier: string;
    changedFields: string[];
    changes: Record<string, FieldChange>;
    actor: ActorRef;
  };
  'issue.moved': { issueId: string; fromTeamId: string; toIssueId: string; toTeamId: string; actor: ActorRef };
  'issue.archived': { issueId: string; teamId: string; archived: boolean; actor: ActorRef };
  'issue.trashed': { issueId: string; teamId: string; trashed: boolean; actor: ActorRef };
  'issue.deleted': { issueId: string; teamId: string; actor: ActorRef };
  'comment.created': { commentId: string; issueId: string; teamId: string; mentions: string[]; actor: ActorRef };
  'comment.updated': { commentId: string; issueId: string; actor: ActorRef };
  'comment.deleted': { commentId: string; issueId: string; actor: ActorRef };
  'relation.created': {
    relationId: string;
    sourceIssueId: string;
    targetIssueId: string;
    type: string;
    actor: ActorRef;
  };
  'relation.deleted': { relationId: string; sourceIssueId: string; targetIssueId: string; actor: ActorRef };
  'cycle.started': { cycleId: string; teamId: string; number: number };
  'cycle.closed': { cycleId: string; teamId: string; number: number; stats: Record<string, number> };
  'project.created': { projectId: string; actor: ActorRef };
  'project.updated': { projectId: string; changedFields: string[]; actor: ActorRef };
  'team.updated': { teamId: string; actor: ActorRef };
  'label.updated': { labelId: string; actor: ActorRef };
  'view.updated': { viewId: string; ownerId: string };
  'notification.created': { notificationId: string; userId: string };
  'import.progress': { runId: string; status: string; progress: number };
  'import.completed': { runId: string; status: string; counts: Record<string, number> };
  'github.linked': { issueId: string; linkId: string; repo: string; prNumber: number | null; state: string | null };
  'workspace.updated': { actor: ActorRef };
}

export type EventTopic = keyof EventPayloads;

export type DomainEvent = {
  [K in EventTopic]: { topic: K; payload: EventPayloads[K] };
}[EventTopic];

/** A drained outbox row. */
export type OutboxEvent = DomainEvent & { id: number; createdAt: Date };

export const ALL_TOPICS: EventTopic[] = [
  'issue.created',
  'issue.updated',
  'issue.moved',
  'issue.archived',
  'issue.trashed',
  'issue.deleted',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'relation.created',
  'relation.deleted',
  'cycle.started',
  'cycle.closed',
  'project.created',
  'project.updated',
  'team.updated',
  'label.updated',
  'view.updated',
  'notification.created',
  'import.progress',
  'import.completed',
  'github.linked',
  'workspace.updated',
];
