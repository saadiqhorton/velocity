import { createPubSub } from '@graphql-yoga/subscription';

/**
 * In-process pubsub fed by the outbox listener (SPEC §5.5 step 2). Payloads carry ids only;
 * subscription resolvers reload entities with the subscriber's own actor.
 */
export interface WorkspaceEventPayload {
  topic: string;
  issueId: string | null;
  teamId: string | null;
  projectId: string | null;
  entityId: string | null;
  changedFields: string[];
  actorUserId: string | null;
}

export type PubSubChannels = {
  'issue:updated': [issueId: string, payload: { issueId: string }];
  'issue:created': [payload: { issueId: string; teamId: string }];
  'notification:created': [userId: string, payload: { notificationId: string }];
  'import:progress': [runId: string, payload: { runId: string }];
  'workspace:event': [payload: WorkspaceEventPayload];
};

export function createVelocityPubSub() {
  return createPubSub<PubSubChannels>();
}

export type VelocityPubSub = ReturnType<typeof createVelocityPubSub>;
