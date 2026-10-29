import { asc, inArray } from 'drizzle-orm';
import { comments, issues, teams } from '@velocity/schema';
import type { Tx } from '../db';

export interface LockedReferenceScope {
  issueRows: { id: string; number: number; teamId: string }[];
  teamRows: { id: string; key: string }[];
}

/**
 * Reference rewrites must acquire domain rows in one lock-family order:
 * every relevant issue, then their teams, then comment bodies. Callers pass
 * the union of target issues and referenced destination issues before this
 * function takes its first domain-row lock.
 */
export async function lockReferenceScope(
  tx: Tx,
  input: {
    issueIds: readonly string[];
    commentIds: readonly string[];
    beforeComments?: ((tx: Tx, commentIds: readonly string[]) => Promise<void>) | null;
  },
): Promise<LockedReferenceScope> {
  const issueIds = [...new Set(input.issueIds)].sort();
  const issueRows = issueIds.length
    ? await tx.select({ id: issues.id, number: issues.number, teamId: issues.teamId }).from(issues)
      .where(inArray(issues.id, issueIds)).orderBy(asc(issues.id)).for('update')
    : [];

  const teamIds = [...new Set(issueRows.map((row) => row.teamId))].sort();
  const teamRows = teamIds.length
    ? await tx.select({ id: teams.id, key: teams.key }).from(teams)
      .where(inArray(teams.id, teamIds)).orderBy(asc(teams.id)).for('share')
    : [];

  const commentIds = [...new Set(input.commentIds)].sort();
  await input.beforeComments?.(tx, commentIds);
  if (commentIds.length) {
    await tx.select({ id: comments.id }).from(comments)
      .where(inArray(comments.id, commentIds)).orderBy(asc(comments.id)).for('update');
  }

  return { issueRows, teamRows };
}
