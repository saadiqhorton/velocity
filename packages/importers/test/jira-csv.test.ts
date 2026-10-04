import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseJiraCsv } from '../src';
import { parseJiraDate } from '../src/jira-csv';
import { fixtureText } from './helpers';

describe('parseJiraDate', () => {
  it('parses Jira and ISO dates', () => {
    expect(parseJiraDate('12/Mar/24 3:45 PM')).toBe('2024-03-12T15:45:00.000Z');
    expect(parseJiraDate('12/Mar/24 12:05 AM')).toBe('2024-03-12T00:05:00.000Z');
    expect(parseJiraDate('01/Jan/2025 09:30')).toBe('2025-01-01T09:30:00.000Z');
    expect(parseJiraDate('2024-03-12T10:00:00Z')).toBe('2024-03-12T10:00:00.000Z');
    expect(parseJiraDate('')).toBeNull();
    expect(parseJiraDate('garbage')).toBeNull();
  });
});

describe('parseJiraCsv', () => {
  it('parses the fixture with repeated columns', async () => {
    const b = await parseJiraCsv(fixtureText('jira-export.csv'));
    expect(b.source).toBe('jira');
    expect(b.teams.map((t) => t.key).sort()).toEqual(['API', 'DOC', 'WEB']);
    expect(b.teams.find((t) => t.key === 'WEB')?.name).toBe('Website');
    expect(b.issues).toHaveLength(18);
    expect(b.warnings.filter((w) => w.code === 'missing_required_field')).toHaveLength(2);
    const get = (id: string) => b.issues.find((i) => i.externalId === id)!;
    expect(get('WEB-1').labelNames).toEqual(['Epic', 'infra', 'setup']);
    expect(b.labels.find((l) => l.name === 'Epic')?.group).toBe('Type');
    expect(b.labels.find((l) => l.name === 'infra')?.group).toBeNull();
    expect(get('WEB-2').descriptionMd).toContain('newlines');
  });

  it('maps priorities, estimates and statuses', async () => {
    const b = await parseJiraCsv(fixtureText('jira-export.csv'));
    const get = (id: string) => b.issues.find((i) => i.externalId === id)!;
    expect(get('WEB-1').priority).toBe(1);
    expect(get('WEB-2').priority).toBe(0);
    expect(get('WEB-3').priority).toBe(2);
    expect(get('WEB-4').priority).toBe(3);
    expect(get('WEB-5').priority).toBe(3);
    expect(get('WEB-6').priority).toBe(4);
    expect(get('WEB-1').estimate).toBe(8);
    expect(get('WEB-2').estimate).toBe(5);
    expect(get('WEB-6').estimate).toBe(40);
    expect(b.warnings.some((w) => w.code === 'estimate_clamped' && w.externalId === 'WEB-6')).toBe(true);
    const cat = (n: string) => b.statuses.find((s) => s.name === n)?.category;
    expect(cat('To Do')).toBe('todo');
    expect(cat('In Progress')).toBe('in_progress');
    expect(cat('Resolved')).toBe('done');
    expect(cat("Won't Do")).toBe('canceled');
    expect(cat('Selected for Development')).toBe('todo');
    expect(cat('Awaiting vendor')).toBeNull();
    expect(get('WEB-1').completedAt).toBe('2024-03-10T17:00:00.000Z');
    expect(get('API-4').canceledAt).toBe('2024-03-13T09:30:00.000Z');
    expect(get('API-3').completedAt).toBe('2024-03-12T09:30:00.000Z');
  });

  it('parses comments, links, parents', async () => {
    const b = await parseJiraCsv(fixtureText('jira-export.csv'));
    const get = (id: string) => b.issues.find((i) => i.externalId === id)!;
    const comments = get('WEB-1').comments;
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({ authorName: 'ann.lee', bodyMd: 'Looks good; shipping it.', createdAt: '2024-03-12T15:45:00.000Z' });
    expect(get('API-6').comments[0]?.createdAt).toBe('2024-03-16T10:00:00.000Z');
    expect(get('API-6').comments[1]).toMatchObject({ bodyMd: 'no date here just text' });
    // WEB-3 blocks WEB-2 (declared from both sides, stored once)
    const blocks = b.issues.flatMap((i) => i.relations.filter((r) => r.type === 'blocks').map((r) => `${i.externalId}>${r.targetExternalId}`));
    expect(blocks.filter((x) => x === 'WEB-3>WEB-2')).toHaveLength(1);
    expect(get('WEB-4').relations).toContainEqual({ type: 'duplicate', targetExternalId: 'WEB-5' });
    expect([get('WEB-2'), get('WEB-4')].flatMap((i) => i.relations.filter((r) => r.type === 'related'))).toHaveLength(1);
    expect(get('WEB-2').parentExternalId).toBe('WEB-1'); // by issue id
    expect(get('WEB-3').parentExternalId).toBe('WEB-1'); // by key
    expect(get('WEB-7').parentExternalId).toBe('WEB-2');
    expect(get('DOC-1').parentExternalId).toBeNull();
    const codes = b.warnings.map((w) => w.code);
    expect(codes).toContain('unknown_parent');
    expect(codes).toContain('unknown_relation_target');
  });

  it('turns sprints into cycles with estimated dates', async () => {
    const b = await parseJiraCsv(fixtureText('jira-export.csv'));
    const web = b.cycles.filter((c) => c.teamExternalId === 'WEB');
    expect(web.map((c) => [c.number, c.name])).toEqual([[1, 'Sprint 1'], [2, 'Sprint 2']]);
    for (const c of b.cycles) expect(Date.parse(c.endsAt)).toBeGreaterThan(Date.parse(c.startsAt));
    expect(b.warnings.filter((w) => w.code === 'sprint_dates_estimated')).toHaveLength(b.cycles.length);
    const get = (id: string) => b.issues.find((i) => i.externalId === id)!;
    expect(get('WEB-2').cycleExternalId).toBe('WEB:Sprint 2'); // last sprint listed wins
    expect(get('WEB-1').cycleExternalId).toBe('WEB:Sprint 1');
    expect(get('WEB-5').cycleExternalId).toBeNull();
  });

  it('supports streaming input', async () => {
    const text = fixtureText('jira-export.csv');
    const b = await parseJiraCsv(Readable.from(text.match(/[\s\S]{1,50}/g) ?? []));
    expect(b.issues).toHaveLength(18);
  });
});
