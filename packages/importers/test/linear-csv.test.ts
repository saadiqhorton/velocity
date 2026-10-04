import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseLinearCsv } from '../src';
import { fixturePath, fixtureText } from './helpers';

describe('parseLinearCsv', () => {
  it('parses the fixture', async () => {
    const b = await parseLinearCsv(fixtureText('linear-export.csv'));
    expect(b.source).toBe('linear');
    expect(b.teams.map((t) => t.key).sort()).toEqual(['DES', 'ENG', 'OPS']);
    expect(b.teams.find((t) => t.key === 'ENG')?.name).toBe('Engineering');
    // 25 rows: 3 invalid + 1 duplicate id skipped
    expect(b.issues).toHaveLength(21);
    const codes = b.warnings.map((w) => w.code);
    expect(codes.filter((c) => c === 'missing_required_field')).toHaveLength(3);
    expect(codes).toContain('duplicate_issue');
    expect(codes).toContain('unknown_priority');
    expect(codes).toContain('unknown_parent');
  });

  it('maps fields, priorities, estimates and categories', async () => {
    const b = await parseLinearCsv(fixtureText('linear-export.csv'));
    const get = (id: string) => b.issues.find((i) => i.externalId === id)!;
    const e1 = get('ENG-1');
    expect(e1.priority).toBe(1);
    expect(e1.estimate).toBe(3);
    expect(e1.descriptionMd).toContain('1. lint');
    expect(e1.labelNames).toEqual(['Feature', 'Performance']);
    expect(e1.assigneeExternalId).toBe('Bob Martin');
    expect(e1.completedAt).toBe('2024-03-05T10:00:00.000Z');
    expect(get('ENG-2').priority).toBe(0);
    expect(get('ENG-3').priority).toBe(2);
    expect(get('ENG-4').priority).toBe(3);
    expect(get('ENG-5').priority).toBe(4);
    expect(get('ENG-10').priority).toBeNull();
    expect(get('ENG-7').estimate).toBe(40);
    expect(b.warnings.some((w) => w.code === 'estimate_clamped')).toBe(true);
    expect(get('ENG-7').descriptionMd).toContain('"quotes"');
    expect(get('OPS-6').title).toBe('Unicode: café ☕ 日本語');
    expect(get('ENG-8').archivedAt).toBe('2024-03-09T10:00:00.000Z');
    const cat = (team: string, name: string) => b.statuses.find((s) => s.teamExternalId === team && s.name === name)?.category;
    expect(cat('ENG', 'Done')).toBe('done');
    expect(cat('ENG', 'In Review')).toBe('in_progress');
    expect(cat('ENG', 'Canceled')).toBe('canceled');
    expect(cat('ENG', 'Backlog')).toBe('backlog');
    expect(cat('ENG', 'Waiting on legal')).toBeNull();
  });

  it('handles users, labels, projects, milestones and cycles', async () => {
    const b = await parseLinearCsv(fixtureText('linear-export.csv'));
    expect(b.users.find((u) => u.externalId === 'carol@example.com')?.email).toBe('carol@example.com');
    expect(b.labels.map((l) => l.name)).toEqual(expect.arrayContaining(['Bug', 'Feature', 'Design', 'Security']));
    expect(b.projects.map((p) => p.name).sort()).toEqual(['Brand', 'Infra', 'Platform']);
    expect(b.projects.find((p) => p.externalId === 'p-1')?.milestones).toEqual([{ externalId: 'm-1', name: 'Beta' }]);
    const cyc = b.cycles.find((c) => c.externalId === 'ENG-cycle-1')!;
    expect(cyc.number).toBe(1);
    expect(cyc.name).toBe('Sprint Alpha');
    expect(cyc.startsAt).toBe('2024-03-04T00:00:00.000Z');
    expect(b.cycles.filter((c) => c.teamExternalId === 'ENG')).toHaveLength(2);
    const e2 = b.issues.find((i) => i.externalId === 'ENG-2')!;
    expect(e2.cycleExternalId).toBe('ENG-cycle-1');
    expect(e2.projectExternalId).toBe('p-1');
    expect(e2.milestoneExternalId).toBe('m-1');
  });

  it('resolves parents and relations', async () => {
    const b = await parseLinearCsv(fixtureText('linear-export.csv'));
    const get = (id: string) => b.issues.find((i) => i.externalId === id)!;
    expect(get('ENG-4').parentExternalId).toBe('ENG-3');
    expect(get('ENG-5').parentExternalId).toBe('ENG-4');
    expect(get('ENG-10').parentExternalId).toBeNull();
    // blocked by => other issue blocks this one
    expect(get('ENG-1').relations).toContainEqual({ type: 'blocks', targetExternalId: 'ENG-2' });
    expect(get('ENG-6').relations).toContainEqual({ type: 'duplicate', targetExternalId: 'ENG-2' });
    // symmetric related is stored once
    const related = [get('ENG-2'), get('ENG-3')].flatMap((i) => i.relations.filter((r) => r.type === 'related'));
    expect(related).toHaveLength(1);
    expect(get('OPS-2').relations.filter((r) => r.type === 'related').map((r) => r.targetExternalId).sort()).toEqual(['ENG-3', 'OPS-1']);
  });

  it('accepts streaming input and matches the string result', async () => {
    const text = fixtureText('linear-export.csv');
    const fromStream = await parseLinearCsv(createReadStream(fixturePath('linear-export.csv')));
    expect(fromStream).toEqual(await parseLinearCsv(text));
    const chunks = text.match(/[\s\S]{1,37}/g) ?? [];
    expect((await parseLinearCsv(Readable.from(chunks))).issues).toHaveLength(21);
  });

  it('tolerates case-insensitive, missing and extra columns', async () => {
    const b = await parseLinearCsv('id,TEAM,title,mystery\nABC-1,Alpha,Hello,x\n');
    expect(b.issues).toHaveLength(1);
    expect(b.teams[0]).toMatchObject({ key: 'ABC', name: 'Alpha' });
    expect(b.issues[0]?.priority).toBe(4);
    expect(b.issues[0]?.statusName).toBe('Backlog');
  });

  it('handles empty input', async () => {
    const b = await parseLinearCsv('');
    expect(b.issues).toEqual([]);
    expect(b.warnings[0]?.code).toBe('empty_file');
  });
});
