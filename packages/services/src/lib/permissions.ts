/** Permission truth table (SPEC §3.2.3). */

export type Action =
  | 'issue.read'
  | 'issue.write'
  | 'team.write'
  | 'project.write'
  | 'cycle.write'
  | 'view.write'
  | 'apikey.manage_own'
  | 'apikey.view_all'
  | 'apikey.revoke_any'
  | 'member.invite'
  | 'member.manage'
  | 'workspace.settings'
  | 'workspace.integrations'
  | 'workspace.webhooks'
  | 'workspace.import_export'
  | 'workspace.delete'
  | 'audit.view'
  | 'cycle.close_manual';

export interface Actor {
  userId: string;
  isOwner: boolean;
  suspended: boolean;
  via: 'session' | 'api_key' | 'mcp';
  /** Sessions are always 'write'. */
  scope: 'read' | 'write';
}

export interface PermissionRule {
  member: boolean;
  owner: boolean;
  /** Allowed for read-scoped API keys / MCP sessions. */
  readScope: boolean;
}

const MEMBER: PermissionRule = { member: true, owner: true, readScope: false };
const OWNER: PermissionRule = { member: false, owner: true, readScope: false };

export const PERMISSION_TABLE: Readonly<Record<Action, PermissionRule>> = {
  'issue.read': { member: true, owner: true, readScope: true },
  'issue.write': MEMBER,
  'team.write': MEMBER,
  'project.write': MEMBER,
  'cycle.write': MEMBER,
  'view.write': MEMBER,
  'cycle.close_manual': MEMBER,
  'apikey.manage_own': MEMBER,
  'apikey.view_all': OWNER,
  'apikey.revoke_any': OWNER,
  'member.invite': OWNER,
  'member.manage': OWNER,
  'workspace.settings': OWNER,
  'workspace.integrations': OWNER,
  'workspace.webhooks': OWNER,
  'workspace.import_export': OWNER,
  'workspace.delete': OWNER,
  'audit.view': OWNER,
};

export const ACTIONS = Object.keys(PERMISSION_TABLE) as Action[];

export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN' as const;
  constructor(
    readonly action: Action,
    message?: string,
  ) {
    super(message ?? `Not allowed: ${action}`);
    this.name = 'ForbiddenError';
  }
}

export function can(actor: Actor, action: Action): boolean {
  if (actor.suspended) return false;
  const rule = PERMISSION_TABLE[action];
  if (!rule) return false;
  if (actor.scope === 'read' && !rule.readScope) return false;
  return actor.isOwner ? rule.owner : rule.member;
}

export function assertCan(actor: Actor, action: Action): void {
  if (!can(actor, action)) throw new ForbiddenError(action);
}
