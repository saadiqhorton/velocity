import clsx from 'clsx';
import { Icon } from '@velocity/ui';
import { m } from '@/i18n';

/** Compact four-step indicator; the current step comes from server state, never local state. */
export function ImportStepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  const t = m.settingsIntegrations.import.steps;
  const steps = [t.source, t.mapping, t.dryRun, t.commit];
  return (
    <ol className="flex items-center gap-2" aria-label={m.settingsIntegrations.import.stepsLabel} data-testid="import-stepper">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            {i > 0 ? <span aria-hidden="true" className={clsx('h-px w-6', done || active ? 'bg-primary' : 'bg-border')} /> : null}
            <span
              aria-hidden="true"
              className={clsx(
                'inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold',
                active ? 'bg-primary text-fg-inverse' : done ? 'bg-primary-subtle text-primary' : 'bg-neutral text-fg-subtle',
              )}
            >
              {done ? <Icon name="check" /> : n}
            </span>
            <span className={clsx('text-sm', active ? 'font-semibold text-fg' : 'text-fg-subtle')}>
              <span className="sr-only">{done ? m.settingsIntegrations.import.stepDone : active ? m.settingsIntegrations.import.stepCurrent : ''} </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
