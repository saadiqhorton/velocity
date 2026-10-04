import { useId, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { m } from '@/i18n';
import { niceMax, useElementWidth } from './useElementWidth';

export interface DualLinePoint {
  label: string;
  /** Short x-axis label. */
  tick: string;
  a: number;
  b: number;
}

export interface DualLineChartProps {
  points: DualLinePoint[];
  aLabel: string;
  bLabel: string;
  /** Names the chart for assistive tech (summary sentence). */
  summary: string;
  height?: number;
}

const MARGIN = { top: 12, right: 24, bottom: 28, left: 36 };
const A_COLOR = 'var(--ds-chart-1)';
const B_COLOR = 'var(--ds-chart-3)';

/**
 * Two-series weekly line chart in pure SVG. Series A is solid with round markers, series B has square
 * markers, so identity never relies on color alone. A visually hidden table carries the same data.
 * The wrapper is focusable: ←/→ move the active week and show the tooltip.
 */
export function DualLineChart({ points, aLabel, bLabel, summary, height = 224 }: DualLineChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();
  const n = points.length;
  const iw = Math.max(40, width - MARGIN.left - MARGIN.right);
  const ih = height - MARGIN.top - MARGIN.bottom;
  const { max, step } = niceMax(Math.max(0, ...points.flatMap((p) => [p.a, p.b])));
  const x = (i: number) => MARGIN.left + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v: number) => MARGIN.top + ih - (v / max) * ih;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const every = width < 420 ? 3 : width < 640 ? 2 : 1;
  const line = (key: 'a' | 'b') => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - MARGIN.left) / iw) * (n - 1));
    setActive(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive((a) => Math.max(0, (a ?? n) - 1));
    } else if (e.key === 'Escape') setActive(null);
  };

  const ap = active !== null ? points[active] : undefined;
  const tipLeft = active !== null ? x(active) : 0;
  const flip = tipLeft > width * 0.6;

  return (
    <div ref={ref} className="relative w-full" data-testid="dual-line-chart">
      <div
        tabIndex={0}
        role="group"
        aria-label={summary}
        aria-describedby={ap ? tipId : undefined}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className="rounded-sm"
      >
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" onPointerMove={onMove} onPointerLeave={() => setActive(null)} className="block touch-none select-none text-fg-subtle">
          <title>{summary}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={MARGIN.left} x2={MARGIN.left + iw} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
              <text x={MARGIN.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor">
                {t}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % every === 0 || i === n - 1 && every === 1 ? (
              <text key={p.label} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="currentColor">
                {p.tick}
              </text>
            ) : null,
          )}
          {active !== null ? <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + ih} className="stroke-border-input" strokeWidth={1} /> : null}
          <path d={line('a')} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: A_COLOR }} />
          <path d={line('b')} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: B_COLOR }} />
          {points.map((p, i) => {
            const on = active === i;
            return (
              <g key={p.label}>
                <circle cx={x(i)} cy={y(p.a)} r={on ? 5 : 3} strokeWidth={2} className="stroke-surface" style={{ fill: A_COLOR }} />
                <rect x={x(i) - (on ? 4.5 : 3)} y={y(p.b) - (on ? 4.5 : 3)} width={on ? 9 : 6} height={on ? 9 : 6} strokeWidth={2} className="stroke-surface" style={{ fill: B_COLOR }} />
              </g>
            );
          })}
        </svg>
      </div>
      {ap ? (
        <div
          id={tipId}
          role="status"
          className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-md border border-border bg-overlay px-3 py-2 text-sm shadow-overlay"
          style={flip ? { right: width - tipLeft + 12 } : { left: tipLeft + 12 }}
        >
          <div className="mb-1 font-medium text-fg">{ap.label}</div>
          <div className="flex items-center justify-between gap-4 text-fg">
            <span className="flex items-center gap-2 text-fg-subtle">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: A_COLOR }} />
              {aLabel}
            </span>
            <span className="tabular-nums">{ap.a}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-fg">
            <span className="flex items-center gap-2 text-fg-subtle">
              <span aria-hidden="true" className="inline-block h-2 w-2" style={{ backgroundColor: B_COLOR }} />
              {bLabel}
            </span>
            <span className="tabular-nums">{ap.b}</span>
          </div>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">{m.insights.week}</th>
            <th scope="col">{aLabel}</th>
            <th scope="col">{bLabel}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <th scope="row">{p.label}</th>
              <td>{p.a}</td>
              <td>{p.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Legend: marker shape and color per series, always visible for two or more series. */
export function DualLineLegend({ aLabel, bLabel }: { aLabel: string; bLabel: string }) {
  return (
    <ul className="flex items-center gap-4 text-sm text-fg-subtle" aria-label={m.insights.legend}>
      <li className="flex items-center gap-2">
        <svg width="16" height="8" aria-hidden="true">
          <line x1="0" x2="16" y1="4" y2="4" strokeWidth="2" style={{ stroke: A_COLOR }} />
          <circle cx="8" cy="4" r="3" style={{ fill: A_COLOR }} />
        </svg>
        {aLabel}
      </li>
      <li className="flex items-center gap-2">
        <svg width="16" height="8" aria-hidden="true">
          <line x1="0" x2="16" y1="4" y2="4" strokeWidth="2" style={{ stroke: B_COLOR }} />
          <rect x="5" y="1" width="6" height="6" style={{ fill: B_COLOR }} />
        </svg>
        {bLabel}
      </li>
    </ul>
  );
}
