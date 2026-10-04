import clsx from 'clsx';

export interface SparklineProps {
  values: number[];
  /** Accessible summary read by screen readers and shown as the native tooltip. */
  label: string;
  width?: number;
  height?: number;
  className?: string;
}

/** Tiny polyline with an end marker, scaled between the series minimum and maximum. No animation. */
export function Sparkline({ values, label, width = 96, height = 24, className }: SparklineProps) {
  const pad = 3;
  const max = Math.max(1, ...values);
  const min = values.length > 1 ? Math.min(...values) : 0;
  const span = Math.max(1, max - min);
  const n = values.length;
  const x = (i: number) => pad + (n <= 1 ? (width - pad * 2) / 2 : (i * (width - pad * 2)) / (n - 1));
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const lastIdx = n - 1;
  return (
    <svg role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={clsx('shrink-0', className)}>
      <title>{label}</title>
      <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className="stroke-border" strokeWidth={1} />
      {n > 1 ? <polyline points={points} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: 'var(--ds-chart-1)' }} /> : null}
      {n > 0 ? <circle cx={x(lastIdx)} cy={y(values[lastIdx] ?? 0)} r={3} strokeWidth={2} className="stroke-surface" style={{ fill: 'var(--ds-chart-1)' }} /> : null}
    </svg>
  );
}
