import { describe, expect, it } from 'vitest';
import {
  cycleProgress, cycleWindowContaining, firstCycleWindow, isClosingWithin, nextCycleWindow, planRotation, velocity,
  type CycleRecord, type CycleSettings, type CycleWindow,
} from '../../src/lib/cycle-math';

/** Local wall-clock parts of an instant in a tz. */
function local(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}`, weekday: p.weekday as string };
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hours = (w: CycleWindow) => (w.endsAt.getTime() - w.startsAt.getTime()) / 3_600_000;

function expectLocalMidnight(d: Date, tz: string, startDay: number) {
  const l = local(d, tz);
  expect(l.time).toBe('00:00:00');
  expect(l.weekday).toBe(DAYS[startDay]);
}

describe('firstCycleWindow basics', () => {
  const s: CycleSettings = { lengthWeeks: 2, startDay: 1, timezone: 'UTC' };
  it('picks most recent startDay midnight <= now', () => {
    // 2026-03-04 is a Wednesday
    const w = firstCycleWindow(new Date('2026-03-04T15:30:00Z'), s);
    expect(w.startsAt.toISOString()).toBe('2026-03-02T00:00:00.000Z');
    expect(w.endsAt.toISOString()).toBe('2026-03-16T00:00:00.000Z');
  });
  it('now exactly at a start boundary starts there', () => {
    const w = firstCycleWindow(new Date('2026-03-02T00:00:00Z'), s);
    expect(w.startsAt.toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });
  it('one ms before boundary belongs to the previous week', () => {
    const w = firstCycleWindow(new Date('2026-03-01T23:59:59.999Z'), s);
    expect(w.startsAt.toISOString()).toBe('2026-02-23T00:00:00.000Z');
  });
  it('validates settings', () => {
    const now = new Date();
    expect(() => firstCycleWindow(now, { ...s, lengthWeeks: 0 })).toThrow(RangeError);
    expect(() => firstCycleWindow(now, { ...s, lengthWeeks: 9 })).toThrow(RangeError);
    expect(() => firstCycleWindow(now, { ...s, lengthWeeks: 1.5 })).toThrow(RangeError);
    expect(() => firstCycleWindow(now, { ...s, startDay: 7 })).toThrow(RangeError);
    expect(() => firstCycleWindow(now, { ...s, startDay: -1 })).toThrow(RangeError);
    expect(() => firstCycleWindow(now, { ...s, timezone: 'Mars/Base' })).toThrow(RangeError);
  });
});

describe('timezone fixture matrix', () => {
  const zones: { tz: string; nows: string[] }[] = [
    { tz: 'America/New_York', nows: ['2026-03-05T12:00:00Z', '2026-03-08T06:59:59Z', '2026-03-08T07:00:01Z', '2026-03-12T12:00:00Z', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2026-11-04T12:00:00Z', '2026-07-04T00:00:00Z'] },
    { tz: 'Europe/London', nows: ['2026-03-28T23:30:00Z', '2026-03-29T01:30:00Z', '2026-03-31T12:00:00Z', '2026-10-24T23:30:00Z', '2026-10-25T01:30:00Z', '2026-10-27T12:00:00Z', '2026-06-15T12:00:00Z'] },
    { tz: 'Australia/Sydney', nows: ['2026-04-04T15:00:00Z', '2026-04-05T10:00:00Z', '2026-04-08T12:00:00Z', '2026-10-03T15:30:00Z', '2026-10-04T10:00:00Z', '2026-10-08T12:00:00Z', '2026-01-15T00:00:00Z'] },
    { tz: 'Asia/Kolkata', nows: ['2026-01-01T00:00:00Z', '2026-03-08T12:00:00Z', '2026-06-30T18:29:59Z', '2026-06-30T18:30:00Z', '2026-12-31T23:59:59Z'] },
    { tz: 'Pacific/Chatham', nows: ['2026-04-04T10:00:00Z', '2026-04-05T12:00:00Z', '2026-09-26T12:00:00Z', '2026-09-27T12:00:00Z', '2026-12-01T12:00:00Z'] },
    { tz: 'UTC', nows: ['2026-02-28T23:59:59Z', '2027-01-01T00:00:00Z'] },
  ];
  for (const { tz, nows } of zones)
    for (const startDay of [0, 1, 2, 3, 4, 5, 6])
      for (const lengthWeeks of [1, 2, 8]) {
        it(`${tz} startDay=${startDay} len=${lengthWeeks}w`, () => {
          const s: CycleSettings = { lengthWeeks, startDay, timezone: tz };
          for (const n of nows) {
            const now = new Date(n);
            const w = firstCycleWindow(now, s);
            expect(w.startsAt.getTime()).toBeLessThanOrEqual(now.getTime());
            // `now` is within the first week of its window (window starts at the most recent startDay)
            expect(now.getTime() - w.startsAt.getTime()).toBeLessThan(7 * 24 * 3_600_000 + 3_600_000);
            expectLocalMidnight(w.startsAt, tz, startDay);
            expectLocalMidnight(w.endsAt, tz, startDay);
            // end is exactly lengthWeeks*7 local days later
            const ls = local(w.startsAt, tz).date;
            const le = local(w.endsAt, tz).date;
            const diffDays = (Date.parse(le + 'T00:00:00Z') - Date.parse(ls + 'T00:00:00Z')) / 86_400_000;
            expect(diffDays).toBe(7 * lengthWeeks);
            // UTC duration differs from nominal by at most 1h (45m-aligned zones included) -> DST shifts only
            expect(Math.abs(hours(w) - 168 * lengthWeeks)).toBeLessThanOrEqual(1);
            // contiguous chain stays on local midnight and on the same weekday
            let cur = w;
            for (let i = 0; i < 6; i++) {
              const nx = nextCycleWindow(cur.endsAt, s);
              expect(nx.startsAt.getTime()).toBe(cur.endsAt.getTime());
              expectLocalMidnight(nx.endsAt, tz, startDay);
              cur = nx;
            }
            // now lies within the window containing it computed from the anchor
            const c = cycleWindowContaining(now, w.startsAt, s);
            expect(c.startsAt.getTime()).toBe(w.startsAt.getTime() <= now.getTime() && now.getTime() < w.endsAt.getTime() ? w.startsAt.getTime() : c.startsAt.getTime());
          }
        });
      }
});

describe('DST specifics', () => {
  it('New York spring forward: week spanning Mar 8 2026 is 167h', () => {
    const s: CycleSettings = { lengthWeeks: 1, startDay: 0, timezone: 'America/New_York' };
    const w = firstCycleWindow(new Date('2026-03-10T12:00:00Z'), s);
    expect(w.startsAt.toISOString()).toBe('2026-03-08T05:00:00.000Z'); // 00:00 EST
    expect(w.endsAt.toISOString()).toBe('2026-03-15T04:00:00.000Z'); // 00:00 EDT
    expect(hours(w)).toBe(167);
    const prev = firstCycleWindow(new Date('2026-03-04T12:00:00Z'), s);
    expect(prev.startsAt.toISOString()).toBe('2026-03-01T05:00:00.000Z');
    expect(prev.endsAt.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(hours(prev)).toBe(168);
  });
  it('New York fall back: week spanning Nov 1 2026 is 169h', () => {
    const s: CycleSettings = { lengthWeeks: 1, startDay: 0, timezone: 'America/New_York' };
    const w = firstCycleWindow(new Date('2026-10-28T12:00:00Z'), s);
    expect(w.startsAt.toISOString()).toBe('2026-10-25T04:00:00.000Z');
    expect(w.endsAt.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    const nx = nextCycleWindow(w.endsAt, s);
    expect(nx.endsAt.toISOString()).toBe('2026-11-08T05:00:00.000Z');
    expect(hours(nx)).toBe(169);
  });
  it('London autumn: Mon cycles across Oct 25 2026', () => {
    const s: CycleSettings = { lengthWeeks: 2, startDay: 1, timezone: 'Europe/London' };
    const w = firstCycleWindow(new Date('2026-10-20T12:00:00Z'), s);
    expect(w.startsAt.toISOString()).toBe('2026-10-18T23:00:00.000Z'); // Mon 00:00 BST
    expect(w.endsAt.toISOString()).toBe('2026-11-02T00:00:00.000Z'); // Mon 00:00 GMT
    expect(hours(w)).toBe(337);
  });
  it('Sydney (southern hemisphere): DST ends Apr 5 2026 and begins Oct 4 2026', () => {
    const s: CycleSettings = { lengthWeeks: 1, startDay: 6, timezone: 'Australia/Sydney' };
    const apr = firstCycleWindow(new Date('2026-04-01T00:00:00Z'), s); // Sat Mar 28 -> Sat Apr 4
    expect(apr.startsAt.toISOString()).toBe('2026-03-27T13:00:00.000Z'); // +11
    expect(apr.endsAt.toISOString()).toBe('2026-04-03T13:00:00.000Z');
    const apr2 = nextCycleWindow(apr.endsAt, s); // Apr 4 -> Apr 11 spans the end of DST
    expect(apr2.endsAt.toISOString()).toBe('2026-04-10T14:00:00.000Z'); // +10
    expect(hours(apr2)).toBe(169);
    const oct = firstCycleWindow(new Date('2026-10-01T00:00:00Z'), { ...s, startDay: 0 }); // Sun Sep 27 -> Oct 4
    expect(hours(oct)).toBe(168);
    const oct2 = nextCycleWindow(oct.endsAt, { ...s, startDay: 0 });
    expect(hours(oct2)).toBe(167);
  });
  it('Kolkata has no DST: always exact 168h multiples at +05:30', () => {
    const s: CycleSettings = { lengthWeeks: 2, startDay: 3, timezone: 'Asia/Kolkata' };
    let w = firstCycleWindow(new Date('2026-01-01T00:00:00Z'), s);
    for (let i = 0; i < 30; i++) {
      expect(hours(w)).toBe(336);
      expect(w.startsAt.getUTCHours() * 60 + w.startsAt.getUTCMinutes()).toBe(18 * 60 + 30);
      w = nextCycleWindow(w.endsAt, s);
    }
  });
  it('Chatham +12:45 / +13:45', () => {
    const s: CycleSettings = { lengthWeeks: 1, startDay: 1, timezone: 'Pacific/Chatham' };
    const w = firstCycleWindow(new Date('2026-06-10T00:00:00Z'), s); // winter: +12:45
    expect(w.startsAt.toISOString()).toBe('2026-06-07T11:15:00.000Z');
    const sum = firstCycleWindow(new Date('2026-01-14T00:00:00Z'), s); // summer: +13:45
    expect(sum.startsAt.toISOString()).toBe('2026-01-11T10:15:00.000Z');
    // spans DST end (Apr 5 2026 03:45 local)
    const a = firstCycleWindow(new Date('2026-04-01T00:00:00Z'), s);
    expect(hours(a)).toBeGreaterThanOrEqual(168);
  });
});

describe('cycleWindowContaining', () => {
  const s: CycleSettings = { lengthWeeks: 2, startDay: 1, timezone: 'America/New_York' };
  const anchor = firstCycleWindow(new Date('2026-02-04T12:00:00Z'), s).startsAt;
  it('finds windows forward and backward on the anchored grid, across DST', () => {
    for (const n of ['2026-02-04T12:00:00Z', '2026-03-09T03:59:59Z', '2026-03-09T04:00:00Z', '2026-06-30T12:00:00Z', '2027-02-01T12:00:00Z', '2025-12-25T12:00:00Z', '2020-01-01T00:00:00Z']) {
      const now = new Date(n);
      const w = cycleWindowContaining(now, anchor, s);
      expect(w.startsAt.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(w.endsAt.getTime()).toBeGreaterThan(now.getTime());
      expectLocalMidnight(w.startsAt, s.timezone, 1);
      expectLocalMidnight(w.endsAt, s.timezone, 1);
      const next = nextCycleWindow(w.endsAt, s);
      expect(cycleWindowContaining(next.startsAt, anchor, s).startsAt.getTime()).toBe(next.startsAt.getTime());
    }
  });
  it('matches firstCycleWindow for 1-week cycles', () => {
    const s1 = { ...s, lengthWeeks: 1 };
    const a1 = firstCycleWindow(new Date('2026-02-04T12:00:00Z'), s1).startsAt;
    const now = new Date('2026-09-17T08:00:00Z');
    expect(cycleWindowContaining(now, a1, s1)).toEqual(firstCycleWindow(now, s1));
  });
  it('boundary instants', () => {
    const w = cycleWindowContaining(anchor, anchor, s);
    expect(w.startsAt.getTime()).toBe(anchor.getTime());
    const w2 = cycleWindowContaining(w.endsAt, anchor, s);
    expect(w2.startsAt.getTime()).toBe(w.endsAt.getTime());
  });
});

let seq = 0;
function apply(cycles: CycleRecord[], plan: ReturnType<typeof planRotation>, now: Date): CycleRecord[] {
  const closed = new Set(plan.close);
  const next = cycles.map((c) => (closed.has(c.id) ? { ...c, closedAt: now } : c));
  for (const o of plan.open) next.push({ id: `c${++seq}`, number: o.number, startsAt: o.startsAt, endsAt: o.endsAt, closedAt: o.ended ? o.endsAt : null });
  return next;
}

describe('planRotation', () => {
  const s: CycleSettings = { lengthWeeks: 2, startDay: 1, timezone: 'America/New_York' };
  const now = new Date('2026-03-04T15:00:00Z');

  it('bootstraps from nothing: current + 1 upcoming, numbered from 1', () => {
    const p = planRotation({ cycles: [], settings: s, now });
    expect(p.close).toEqual([]);
    expect(p.open.map((o) => o.number)).toEqual([1, 2]);
    expect(p.open[0]!.startsAt.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(p.open[0]!.endsAt.getTime()).toBeGreaterThan(now.getTime());
    expect(p.open[1]!.startsAt.getTime()).toBe(p.open[0]!.endsAt.getTime());
    expect(p.open.every((o) => !o.ended)).toBe(true);
  });
  it('upcomingCount 0 / 3', () => {
    expect(planRotation({ cycles: [], settings: s, now, upcomingCount: 0 }).open).toHaveLength(1);
    expect(planRotation({ cycles: [], settings: s, now, upcomingCount: 3 }).open).toHaveLength(4);
  });
  it('rejects bad upcomingCount', () => {
    expect(() => planRotation({ cycles: [], settings: s, now, upcomingCount: -1 })).toThrow(RangeError);
  });
  it('does nothing when state is healthy', () => {
    const base = apply([], planRotation({ cycles: [], settings: s, now }), now);
    expect(planRotation({ cycles: base, settings: s, now })).toEqual({ close: [], open: [] });
  });
  it('closes expired and opens next on rotation, numbering continues', () => {
    const t0 = apply([], planRotation({ cycles: [], settings: s, now }), now);
    const later = new Date(t0[0]!.endsAt.getTime() + 3_600_000);
    const p = planRotation({ cycles: t0, settings: s, now: later });
    expect(p.close).toEqual([t0[0]!.id]);
    expect(p.open).toHaveLength(1);
    expect(p.open[0]!.number).toBe(3);
    expect(p.open[0]!.startsAt.getTime()).toBe(t0[1]!.endsAt.getTime());
  });
  it('exactly at endsAt counts as ended', () => {
    const t0 = apply([], planRotation({ cycles: [], settings: s, now }), now);
    const p = planRotation({ cycles: t0, settings: s, now: t0[0]!.endsAt });
    expect(p.close).toEqual([t0[0]!.id]);
  });
  it('close list is oldest first and ignores already closed', () => {
    const mk = (id: string, n: number, d: number, closedAt: Date | null): CycleRecord => ({
      id, number: n, startsAt: new Date(Date.UTC(2026, 0, d)), endsAt: new Date(Date.UTC(2026, 0, d + 7)), closedAt,
    });
    const cycles = [mk('b', 2, 8, null), mk('a', 1, 1, null), mk('x', 0, 1, new Date())];
    const p = planRotation({ cycles, settings: { lengthWeeks: 1, startDay: 4, timezone: 'UTC' }, now: new Date('2026-02-20T00:00:00Z') });
    expect(p.close).toEqual(['a', 'b']);
  });
  it('catches up contiguously after 10 missed cycles', () => {
    const t0 = apply([], planRotation({ cycles: [], settings: s, now }), now);
    const lastEnd = t0[1]!.endsAt;
    const later = new Date(lastEnd.getTime() + 10 * 14 * 24 * 3_600_000 + 5 * 24 * 3_600_000);
    const p = planRotation({ cycles: t0, settings: s, now: later });
    expect(p.close).toEqual([t0[0]!.id, t0[1]!.id]);
    const ended = p.open.filter((o) => o.ended);
    expect(ended.length).toBeGreaterThanOrEqual(10);
    expect(p.open.map((o) => o.number)).toEqual(p.open.map((_, i) => 3 + i));
    expect(p.open[0]!.startsAt.getTime()).toBe(lastEnd.getTime());
    for (let i = 1; i < p.open.length; i++) {
      expect(p.open[i]!.startsAt.getTime()).toBe(p.open[i - 1]!.endsAt.getTime());
      expectLocalMidnight(p.open[i]!.startsAt, s.timezone, 1);
    }
    const current = p.open.filter((o) => !o.ended && o.startsAt.getTime() <= later.getTime());
    expect(current).toHaveLength(1);
    expect(current[0]!.endsAt.getTime()).toBeGreaterThan(later.getTime());
    expect(p.open.filter((o) => o.startsAt.getTime() > later.getTime())).toHaveLength(1);
  });
  it('is idempotent once applied (also after catch-up and with ended ones closed)', () => {
    for (const tz of ['America/New_York', 'Australia/Sydney', 'Pacific/Chatham', 'Asia/Kolkata', 'Europe/London']) {
      const st: CycleSettings = { lengthWeeks: 3, startDay: 5, timezone: tz };
      let cycles: CycleRecord[] = [];
      let t = new Date('2026-01-10T10:00:00Z');
      for (let step = 0; step < 12; step++) {
        const p = planRotation({ cycles, settings: st, now: t, upcomingCount: 2 });
        cycles = apply(cycles, p, t);
        expect(planRotation({ cycles, settings: st, now: t, upcomingCount: 2 })).toEqual({ close: [], open: [] });
        t = new Date(t.getTime() + (step % 3 === 0 ? 100 : 11) * 24 * 3_600_000);
      }
      const nums = cycles.map((c) => c.number);
      expect(new Set(nums).size).toBe(nums.length);
      expect(Math.max(...nums)).toBe(nums.length);
    }
  });
  it('without applying ended flag, a second run only closes (still converges)', () => {
    const t0 = apply([], planRotation({ cycles: [], settings: s, now }), now);
    const later = new Date(t0[1]!.endsAt.getTime() + 50 * 24 * 3_600_000);
    const p1 = planRotation({ cycles: t0, settings: s, now: later });
    const naive = [...t0.map((c) => ({ ...c, closedAt: new Date() })), ...p1.open.map((o, i) => ({ id: `n${i}`, number: o.number, startsAt: o.startsAt, endsAt: o.endsAt, closedAt: null }))];
    const p2 = planRotation({ cycles: naive, settings: s, now: later });
    expect(p2.open).toEqual([]);
    const done = apply(naive, p2, later);
    expect(planRotation({ cycles: done, settings: s, now: later })).toEqual({ close: [], open: [] });
  });
  it('fills only the missing upcoming cycles', () => {
    const t0 = apply([], planRotation({ cycles: [], settings: s, now, upcomingCount: 1 }), now);
    const p = planRotation({ cycles: t0, settings: s, now, upcomingCount: 3 });
    expect(p.open).toHaveLength(2);
    expect(p.open[0]!.number).toBe(3);
  });
  it('a lone manually-closed future-ending cycle: next window is contiguous', () => {
    const w = firstCycleWindow(now, s);
    const cycles: CycleRecord[] = [{ id: 'm', number: 4, startsAt: w.startsAt, endsAt: w.endsAt, closedAt: new Date(now) }];
    const p = planRotation({ cycles, settings: s, now });
    expect(p.close).toEqual([]);
    expect(p.open[0]!.number).toBe(5);
    expect(p.open[0]!.startsAt.getTime()).toBe(w.endsAt.getTime());
  });
  it('DST: windows planned across spring forward remain local-midnight aligned', () => {
    const st: CycleSettings = { lengthWeeks: 1, startDay: 0, timezone: 'America/New_York' };
    const p = planRotation({ cycles: [], settings: st, now: new Date('2026-03-05T12:00:00Z'), upcomingCount: 3 });
    for (const o of p.open) expectLocalMidnight(o.startsAt, st.timezone, 0);
    expect(p.open.map(hoursOf)).toEqual([168, 167, 168, 168]);
  });
});
function hoursOf(o: { startsAt: Date; endsAt: Date }) {
  return hours(o);
}

describe('cycleProgress / isClosingWithin', () => {
  const w: CycleWindow = { startsAt: new Date('2026-03-02T00:00:00Z'), endsAt: new Date('2026-03-16T00:00:00Z') };
  it('progress is clamped 0..1', () => {
    expect(cycleProgress(w, new Date('2026-03-01T00:00:00Z'))).toBe(0);
    expect(cycleProgress(w, w.startsAt)).toBe(0);
    expect(cycleProgress(w, new Date('2026-03-09T00:00:00Z'))).toBe(0.5);
    expect(cycleProgress(w, w.endsAt)).toBe(1);
    expect(cycleProgress(w, new Date('2026-04-01T00:00:00Z'))).toBe(1);
    expect(cycleProgress({ startsAt: w.startsAt, endsAt: w.startsAt }, w.startsAt)).toBe(1);
  });
  it('closing banner window', () => {
    expect(isClosingWithin(w, new Date('2026-03-14T23:00:00Z'), 24)).toBe(false);
    expect(isClosingWithin(w, new Date('2026-03-15T00:00:00Z'), 24)).toBe(true);
    expect(isClosingWithin(w, new Date('2026-03-15T20:00:00Z'), 24)).toBe(true);
    expect(isClosingWithin(w, new Date('2026-03-15T20:00:00Z'), 1)).toBe(false);
    expect(isClosingWithin(w, new Date('2026-03-10T00:00:00Z'), 24)).toBe(false);
    expect(isClosingWithin(w, w.endsAt, 24)).toBe(false);
    expect(isClosingWithin(w, new Date('2026-03-17T00:00:00Z'), 24)).toBe(false);
    expect(isClosingWithin(w, new Date('2026-02-28T00:00:00Z'), 24 * 30)).toBe(false);
  });
});

describe('velocity', () => {
  it('empty and short lists', () => {
    expect(velocity([])).toEqual({ points: 0, count: 0 });
    expect(velocity([{ completedPoints: 10, completedCount: 4 }])).toEqual({ points: 10, count: 4 });
  });
  it('averages the last n only', () => {
    const closed = Array.from({ length: 10 }, (_, i) => ({ completedPoints: i * 10, completedCount: i }));
    expect(velocity(closed)).toEqual({ points: (40 + 50 + 60 + 70 + 80 + 90) / 6, count: 6.5 });
    expect(velocity(closed, 2)).toEqual({ points: 85, count: 8.5 });
    expect(velocity(closed, 100).count).toBe(4.5);
    expect(velocity(closed, 0)).toEqual({ points: 0, count: 0 });
  });
});
