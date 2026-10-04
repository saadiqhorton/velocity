import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { m } from '@/i18n';
import { niceMax, useElementWidth } from './useElementWidth';

export interface VelocityBar {
  cycleId: string;
  number: number;
  completedPoints: number;
  scopePoints: number;
  completedCount: number;
}

export interface VelocityBarsProps {
  teamKey: string;
  teamName: string;
  bars: VelocityBar[];
  height?: number;
}

const MARGIN = { top: 12, right: 8, bottom: 24, left: 32 };
const FILL = 'var(--ds-chart-1)';

/** Rectangle with rounded top corners only (data end), anchored to the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/**
 * Completed points per cycle for one team (pure SVG). A recessive track behind each bar shows the
 * cycle's scope so completion reads as a fraction. Each bar links to its cycle and is keyboard focusable.
 */
export function VelocityBars({ teamKey, teamName, bars, height = 160 }: VelocityBarsProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>(280);
  const navigate = useNavigate();
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();
  const n = bars.length;
  const iw = Math.max(60, width - MARGIN.left - MARGIN.right);
  const ih = height - MARGIN.top - MARGIN.bottom;
  const { max, step } = niceMax(Math.max(0, ...bars.flatMap((b) => [b.completedPoints, b.scopePoints])), 3);
  const slot = n > 0 ? iw / n : iw;
  const bw = Math.max(8, Math.min(40, slot * 0.6));
  const y = (v: number) => MARGIN.top + ih - (v / max) * ih;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const to = (b: VelocityBar) => `/team/${teamKey}/cycles/${b.cycleId}`;
  const ab = active !== null ? bars[active] : undefined;
  const flip = active !== null && MARGIN.left + (active + 0.5) * slot > width * 0.6;

  return (
    <div ref={ref} className="relative w-full" data-testid={`velocity-${teamKey}`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={m.insights.velocityTeam(teamName)} className="block select-none text-fg-subtle">
        <title>{m.insights.velocityTeam(teamName)}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={MARGIN.left} x2={MARGIN.left + iw} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={MARGIN.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor">
              {t}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = MARGIN.left + (i + 0.5) * slot;
          const x0 = cx - bw / 2;
          const on = active === i;
          return (
            <a
              key={b.cycleId}
              href={to(b)}
              aria-label={m.insights.barLabel(b.number, b.completedPoints, b.scopePoints)}
              onClick={(e) => {
                e.preventDefault();
                navigate(to(b));
              }}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="cursor-pointer rounded-sm outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <rect x={cx - slot / 2} y={MARGIN.top} width={slot} height={ih + MARGIN.bottom} fill="transparent" />
              <path d={topRounded(x0, y(b.scopePoints), bw, ih - (y(b.scopePoints) - MARGIN.top), 4)} className="fill-neutral-hover" />
              <path d={topRounded(x0, y(b.completedPoints), bw, ih - (y(b.completedPoints) - MARGIN.top), 4)} style={{ fill: FILL, opacity: on ? 1 : 0.9 }} />
              <text x={cx} y={MARGIN.top + ih + 16} textAnchor="middle" fontSize={11} fill="currentColor" className={on ? 'font-semibold' : undefined}>
                {m.insights.cycleShort(b.number)}
              </text>
            </a>
          );
        })}
      </svg>
      {ab ? (
        <div
          id={tipId}
          role="status"
          className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-md border border-border bg-overlay px-3 py-2 text-sm shadow-overlay"
          style={flip ? { right: width - (MARGIN.left + ((active ?? 0) + 0.5) * slot) + 12 } : { left: MARGIN.left + ((active ?? 0) + 0.5) * slot + 12 }}
        >
          <div className="mb-1 font-medium text-fg">{m.insights.cycleN(ab.number)}</div>
          <div className="flex justify-between gap-4 text-fg">
            <span className="text-fg-subtle">{m.insights.completedPoints}</span>
            <span className="tabular-nums">{ab.completedPoints}</span>
          </div>
          <div className="flex justify-between gap-4 text-fg">
            <span className="text-fg-subtle">{m.insights.scopePoints}</span>
            <span className="tabular-nums">{ab.scopePoints}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
