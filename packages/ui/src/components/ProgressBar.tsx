import clsx from 'clsx';

export interface ProgressBarProps {
  /** 0 to 100. */
  value: number;
  label: string;
  showPercent?: boolean;
  /** 2px bar used in headers. */
  thin?: boolean;
  className?: string;
}

export function ProgressBar({ value, label, showPercent = false, thin = false, className }: ProgressBarProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        className={clsx('w-full overflow-hidden rounded-sm bg-neutral', thin ? 'h-0.5' : 'h-1')}
      >
        <div className="h-full bg-primary" style={{ width: `${v}%`, transition: 'width var(--ds-duration-200) linear' }} />
      </div>
      {showPercent ? <span className="w-10 shrink-0 text-right text-sm text-fg-subtle">{v}%</span> : null}
    </div>
  );
}
