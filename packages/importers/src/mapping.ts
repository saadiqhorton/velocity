import { z } from 'zod';
import type { ImportBundle, ImportMapping, ImportWorkspaceSnapshot } from '@velocity/schema';
import { inferStatusCategory, suggestTeamKey } from './infer';
import { sanitizeKey } from './util';

const KEY_RE = /^[A-Z][A-Z0-9]{0,9}$/;

/** Pure: suggest a default mapping of bundle entities onto the existing workspace. */
export function suggestMapping(bundle: ImportBundle, ws: ImportWorkspaceSnapshot): ImportMapping {
  const mapping: ImportMapping = {
    teams: {},
    statuses: {},
    users: {},
    include: { projects: true, cycles: true, comments: true, relations: true, archived: false },
  };
  const taken = new Set([...ws.teams.map((t) => t.key), ...(ws.reservedTeamKeys ?? [])].map((key) => key.toUpperCase()));
  const teamByExt = new Map<string, ImportWorkspaceSnapshot['teams'][number] | null>();

  for (const t of bundle.teams) {
    const wanted = t.key.trim().toLowerCase();
    const name = t.name.trim().toLowerCase();
    const existing =
      ws.teams.find((w) => w.key.toLowerCase() === wanted) ?? ws.teams.find((w) => w.name.trim().toLowerCase() === name);
    if (existing) {
      mapping.teams[t.externalId] = { mode: 'existing', teamId: existing.id };
      teamByExt.set(t.externalId, existing);
      continue;
    }
    let key = sanitizeKey(t.key);
    if (!KEY_RE.test(key) || taken.has(key)) key = suggestTeamKey(t.name || t.key, taken);
    taken.add(key);
    mapping.teams[t.externalId] = { mode: 'create', key, name: t.name };
    teamByExt.set(t.externalId, null);
  }

  for (const s of bundle.statuses) {
    const ws_team = teamByExt.get(s.teamExternalId) ?? null;
    const found = ws_team?.statuses.find((x) => x.name.trim().toLowerCase() === s.name.trim().toLowerCase());
    mapping.statuses[`${s.teamExternalId}::${s.name}`] = found
      ? { mode: 'existing', statusId: found.id }
      : { mode: 'create', name: s.name, category: s.category ?? inferStatusCategory(s.name) ?? 'todo' };
  }

  const byEmail = new Map<string, string>();
  const byUsername = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const u of ws.users) {
    if (u.email) byEmail.set(u.email.trim().toLowerCase(), u.id);
    byUsername.set(u.username.trim().toLowerCase(), u.id);
    byName.set(u.name.trim().toLowerCase(), u.id);
  }
  const resolveUser = (u: { name: string; email?: string | null; username?: string | null }): { userId: string } | null => {
    const id =
      (u.email ? byEmail.get(u.email.trim().toLowerCase()) : undefined) ??
      (u.username ? byUsername.get(u.username.trim().toLowerCase()) : undefined) ??
      byName.get(u.name.trim().toLowerCase());
    return id ? { userId: id } : null;
  };
  for (const u of bundle.users) mapping.users[u.externalId] = resolveUser(u);
  // Users referenced by issues/comments but absent from bundle.users stay unmapped (visible to the preview).
  const refs = new Set<string>();
  for (const i of bundle.issues) {
    if (i.assigneeExternalId) refs.add(i.assigneeExternalId);
    if (i.creatorExternalId) refs.add(i.creatorExternalId);
    for (const cm of i.comments) if (cm.authorExternalId) refs.add(cm.authorExternalId);
  }
  for (const r of refs) if (!(r in mapping.users)) mapping.users[r] = null;
  for (const p of bundle.projects) {
    if (p.leadExternalId && !(p.leadExternalId in mapping.users)) mapping.users[p.leadExternalId] = null;
  }
  return mapping;
}

const nullableStr = z.string().nullish();
const category = z.enum(['backlog', 'todo', 'in_progress', 'done', 'canceled']);
const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const relationType = z.enum(['blocks', 'related', 'duplicate']);

const bundleSchema = z.object({
  source: z.enum(['linear', 'github', 'jira']),
  teams: z.array(
    z.object({ externalId: z.string().min(1), key: z.string().regex(KEY_RE, 'invalid team key'), name: z.string().min(1) }),
  ),
  statuses: z.array(
    z.object({ teamExternalId: z.string().min(1), name: z.string().min(1).max(64), category: category.nullable() }),
  ),
  users: z.array(
    z.object({ externalId: z.string().min(1), name: z.string(), email: nullableStr, username: nullableStr }),
  ),
  labels: z.array(z.object({ name: z.string().min(1), group: nullableStr })),
  projects: z.array(
    z.object({
      externalId: z.string().min(1),
      name: z.string().min(1),
      descriptionMd: nullableStr,
      status: z.enum(['planned', 'in_progress', 'completed', 'canceled']).nullish(),
      targetDate: nullableStr,
      leadExternalId: nullableStr,
      milestones: z.array(z.object({ externalId: z.string().min(1), name: z.string().min(1), targetDate: nullableStr })),
    }),
  ),
  cycles: z.array(
    z.object({
      externalId: z.string().min(1),
      teamExternalId: z.string().min(1),
      number: z.number().int(),
      name: nullableStr,
      startsAt: z.string().min(1),
      endsAt: z.string().min(1),
    }),
  ),
  issues: z.array(
    z.object({
      externalId: z.string().min(1),
      teamExternalId: z.string().min(1),
      title: z.string().min(1),
      descriptionMd: nullableStr,
      statusName: z.string().min(1),
      priority: priority.nullish(),
      estimate: z.number().nullish(),
      assigneeExternalId: nullableStr,
      creatorExternalId: nullableStr,
      labelNames: z.array(z.string()),
      projectExternalId: nullableStr,
      milestoneExternalId: nullableStr,
      cycleExternalId: nullableStr,
      parentExternalId: nullableStr,
      relations: z.array(z.object({ type: relationType, targetExternalId: z.string().min(1) })),
      comments: z.array(
        z.object({
          externalId: nullableStr,
          authorExternalId: nullableStr,
          authorName: nullableStr,
          bodyMd: z.string(),
          createdAt: nullableStr,
        }),
      ),
      createdAt: nullableStr,
      updatedAt: nullableStr,
      completedAt: nullableStr,
      canceledAt: nullableStr,
      archivedAt: nullableStr,
      attachments: z.array(z.object({ name: z.string(), url: z.string() })),
    }),
  ),
  warnings: z.array(z.object({ code: z.string(), message: z.string(), externalId: z.string().optional() })),
});

export class BundleValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid import bundle: ${issues.slice(0, 5).join('; ')}${issues.length > 5 ? ` (+${issues.length - 5} more)` : ''}`);
    this.name = 'BundleValidationError';
  }
}

/** Validate untrusted JSON as an ImportBundle; throws BundleValidationError. */
export function validateBundle(x: unknown): ImportBundle {
  const r = bundleSchema.safeParse(x);
  if (!r.success) {
    throw new BundleValidationError(r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  return r.data as ImportBundle;
}
