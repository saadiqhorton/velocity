/** Intl-based formatting (SPEC §7.5): timestamps are UTC from the API, shown in the member's zone. */
import { locale, m } from '@/i18n';

const rtfCache = new Map<string, Intl.RelativeTimeFormat>();
function rtf(): Intl.RelativeTimeFormat {
  const l = locale();
  let f = rtfCache.get(l);
  if (!f) {
    f = new Intl.RelativeTimeFormat(l, { numeric: 'auto', style: 'short' });
    rtfCache.set(l, f);
  }
  return f;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "3m ago", "yesterday", "in 2 days"… */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return m.time.never;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = t - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return m.time.justNow;
  if (abs < HOUR) return rtf().format(Math.round(diff / MINUTE), 'minute');
  if (abs < DAY) return rtf().format(Math.round(diff / HOUR), 'hour');
  if (abs < 7 * DAY) return rtf().format(Math.round(diff / DAY), 'day');
  if (abs < 30 * DAY) return rtf().format(Math.round(diff / (7 * DAY)), 'week');
  if (abs < 365 * DAY) return rtf().format(Math.round(diff / (30 * DAY)), 'month');
  return rtf().format(Math.round(diff / (365 * DAY)), 'year');
}

/** Compact "3m", "2h", "5d", "Mar 4" for dense rows. */
export function formatAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  const abs = Math.abs(now - t);
  if (abs < HOUR) return `${Math.max(1, Math.round(abs / MINUTE))}m`;
  if (abs < DAY) return `${Math.round(abs / HOUR)}h`;
  if (abs < 7 * DAY) return `${Math.round(abs / DAY)}d`;
  return formatShortDate(iso);
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale(), sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(locale(), { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Day bucket label for grouped feeds (Inbox): Today / Yesterday / date. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / DAY);
  if (days === 0) return m.time.today;
  if (days === 1) return m.time.yesterday;
  return d.toLocaleDateString(locale(), { weekday: 'long', month: 'short', day: 'numeric' });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPercent(p: number): string {
  return `${Math.round(p)}%`;
}
