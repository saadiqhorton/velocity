/**
 * Cycle window math (SPEC §3.8). Timezone-correct: a cycle starts at 00:00 local
 * time on `startDay` and ends at 00:00 local time `lengthWeeks` weeks later, so
 * across a DST change the UTC duration differs by an hour (intentionally).
 */
import { TZDate } from '@date-fns/tz';

export interface CycleSettings {
  /** 1..8 */
  lengthWeeks: number;
  /** 0..6, 0 = Sunday */
  startDay: number;
  /** IANA timezone */
  timezone: string;
}

export interface CycleWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface CycleRecord {
  id: string;
  number: number;
  startsAt: Date;
  endsAt: Date;
  closedAt: Date | null;
}

export interface PlannedCycle {
  number: number;
  startsAt: Date;
  endsAt: Date;
  /**
   * True for catch-up windows that are already over at `now` (missed rotations). They keep the
   * numbering/contiguity but callers should insert them as closed (closedAt = endsAt) so a
   * subsequent run is a no-op.
   */
  ended: boolean;
}

const HOUR_MS = 3_600_000;

function assertSettings(s: CycleSettings): void {
  if (!Number.isInteger(s.lengthWeeks) || s.lengthWeeks < 1 || s.lengthWeeks > 8) throw new RangeError('lengthWeeks must be an integer 1..8');
  if (!Number.isInteger(s.startDay) || s.startDay < 0 || s.startDay > 6) throw new RangeError('startDay must be an integer 0..6');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: s.timezone });
  } catch {
    throw new RangeError(`invalid timezone: ${s.timezone}`);
  }
}

/** Local midnight (in tz) of the calendar day `dayOffset` days from the local date of `instant`. */
function localMidnight(instant: Date, tz: string, dayOffset: number): Date {
  const l = new TZDate(instant.getTime(), tz);
  const d = new TZDate(l.getFullYear(), l.getMonth(), l.getDate() + dayOffset, 0, 0, 0, 0, tz);
  return new Date(d.getTime());
}

function endFor(startsAt: Date, s: CycleSettings): Date {
  return localMidnight(startsAt, s.timezone, 7 * s.lengthWeeks);
}

/** The window starting at the most recent `startDay` local midnight <= now. */
export function firstCycleWindow(now: Date, settings: CycleSettings): CycleWindow {
  assertSettings(settings);
  const l = new TZDate(now.getTime(), settings.timezone);
  const back = (l.getDay() - settings.startDay + 7) % 7;
  const startsAt = localMidnight(now, settings.timezone, -back);
  return { startsAt, endsAt: endFor(startsAt, settings) };
}

/** Contiguous successor: starts exactly when the previous window ended. */
export function nextCycleWindow(prevEndsAt: Date, settings: CycleSettings): CycleWindow {
  assertSettings(settings);
  const startsAt = new Date(prevEndsAt.getTime());
  return { startsAt, endsAt: endFor(startsAt, settings) };
}

/** The window on the grid anchored at `anchorStart` (a cycle start) that contains `now`. Works before the anchor too. */
export function cycleWindowContaining(now: Date, anchorStart: Date, settings: CycleSettings): CycleWindow {
  assertSettings(settings);
  const anchorLocal = new TZDate(anchorStart.getTime(), settings.timezone);
  const stepDays = 7 * settings.lengthWeeks;
  const windowAt = (k: number): CycleWindow => {
    const start = new TZDate(anchorLocal.getFullYear(), anchorLocal.getMonth(), anchorLocal.getDate() + k * stepDays, 0, 0, 0, 0, settings.timezone);
    const end = new TZDate(anchorLocal.getFullYear(), anchorLocal.getMonth(), anchorLocal.getDate() + (k + 1) * stepDays, 0, 0, 0, 0, settings.timezone);
    return { startsAt: new Date(start.getTime()), endsAt: new Date(end.getTime()) };
  };
  let k = Math.floor((now.getTime() - anchorStart.getTime()) / (stepDays * 24 * HOUR_MS));
  let w = windowAt(k);
  for (let i = 0; i < 4; i++) {
    if (now.getTime() < w.startsAt.getTime()) w = windowAt(--k);
    else if (now.getTime() >= w.endsAt.getTime()) w = windowAt(++k);
    else break;
  }
  return w;
}

export interface PlanRotationInput {
  cycles: CycleRecord[];
  settings: CycleSettings;
  now: Date;
  /** Number of cycles that should exist after the current one. Default 1. */
  upcomingCount?: number;
}

export interface RotationPlan {
  /** Ids of unclosed cycles with endsAt <= now, oldest first. */
  close: string[];
  /** New windows to create, in order. */
  open: PlannedCycle[];
}

const MAX_CATCH_UP = 5000;

/**
 * Pure rotation planner. Ensures (after applying the plan) an unclosed cycle contains `now`
 * and `upcomingCount` unclosed cycles follow it. Missed windows are created contiguously
 * (flagged `ended`), numbering continues from the max existing number.
 * Manually closed cycles count as existing for contiguity (the next window starts at the
 * latest existing endsAt); they never count as current/upcoming.
 */
export function planRotation(input: PlanRotationInput): RotationPlan {
  const { cycles, settings, now } = input;
  const upcomingCount = input.upcomingCount ?? 1;
  assertSettings(settings);
  if (!Number.isInteger(upcomingCount) || upcomingCount < 0) throw new RangeError('upcomingCount must be >= 0');
  const nowMs = now.getTime();

  const close = cycles
    .filter((c) => c.closedAt === null && c.endsAt.getTime() <= nowMs)
    .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime() || a.number - b.number)
    .map((c) => c.id);

  const live = cycles.filter((c) => c.closedAt === null);
  let needCurrent = !live.some((c) => c.startsAt.getTime() <= nowMs && nowMs < c.endsAt.getTime());
  let needUpcoming = Math.max(0, upcomingCount - live.filter((c) => c.startsAt.getTime() > nowMs).length);

  const open: PlannedCycle[] = [];
  if (!needCurrent && needUpcoming === 0) return { close, open };

  let number = cycles.reduce((m, c) => Math.max(m, c.number), 0);
  let maxEnd: Date | null = null;
  for (const c of cycles) if (maxEnd === null || c.endsAt.getTime() > maxEnd.getTime()) maxEnd = c.endsAt;
  let w: CycleWindow = maxEnd === null ? firstCycleWindow(now, settings) : nextCycleWindow(maxEnd, settings);

  while ((needCurrent || needUpcoming > 0) && open.length < MAX_CATCH_UP) {
    const startMs = w.startsAt.getTime();
    const endMs = w.endsAt.getTime();
    if (startMs <= nowMs && nowMs < endMs) needCurrent = false;
    else if (startMs > nowMs) {
      needCurrent = false; // cannot fill without a gap
      needUpcoming--;
    }
    open.push({ number: ++number, startsAt: w.startsAt, endsAt: w.endsAt, ended: endMs <= nowMs });
    w = nextCycleWindow(w.endsAt, settings);
  }
  return { close, open };
}

/** Fraction elapsed, clamped to 0..1. */
export function cycleProgress(window: CycleWindow, now: Date): number {
  const total = window.endsAt.getTime() - window.startsAt.getTime();
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - window.startsAt.getTime()) / total));
}

/** True when the cycle is still running (or not started) and ends within `hours` of now. */
export function isClosingWithin(window: CycleWindow, now: Date, hours: number): boolean {
  const remaining = window.endsAt.getTime() - now.getTime();
  return now.getTime() >= window.startsAt.getTime() && remaining > 0 && remaining <= hours * HOUR_MS;
}

/** Average completed points/count over the last `n` closed cycles (input oldest -> newest). Zeros when empty. */
export function velocity(closed: { completedPoints: number; completedCount: number }[], n = 6): { points: number; count: number } {
  const last = n > 0 ? closed.slice(-n) : [];
  if (last.length === 0) return { points: 0, count: 0 };
  return {
    points: last.reduce((s, c) => s + c.completedPoints, 0) / last.length,
    count: last.reduce((s, c) => s + c.completedCount, 0) / last.length,
  };
}
