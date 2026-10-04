import { useCallback } from 'react';
import clsx from 'clsx';
import { Icon, IconButton, useFlags } from '@velocity/ui';
import { m } from '@/i18n';

/** Copy text to the clipboard and confirm with a flag. */
export function useCopy(): (text: string, what: string) => void {
  const { showFlag } = useFlags();
  return useCallback(
    (text, what) => {
      void navigator.clipboard?.writeText(text).then(
        () => showFlag({ title: m.settingsIntegrations.common.copied(what), severity: 'success' }),
        () => showFlag({ title: m.settingsIntegrations.common.copyFailed, severity: 'error' }),
      );
    },
    [showFlag],
  );
}

/** One mono value (URL, command, secret) with a Copy button. */
export function CopyField({ value, what, className, testId }: { value: string; what: string; className?: string; testId?: string }) {
  const copy = useCopy();
  return (
    <div className={clsx('flex min-w-0 items-center gap-2 rounded-sm border border-border bg-sunken py-1 pl-3 pr-1', className)}>
      <code className="min-w-0 flex-1 truncate font-mono text-sm text-fg" title={value} data-testid={testId}>
        {value}
      </code>
      <IconButton label={m.settingsIntegrations.common.copyLabel(what)} size="sm" icon={<Icon name="copy" />} onClick={() => copy(value, what)} />
    </div>
  );
}

/** Multi-line mono block with a Copy button in its corner. */
export function CodeBlock({ code, what, label, testId }: { code: string; what: string; label: string; testId?: string }) {
  const copy = useCopy();
  return (
    <div className="relative rounded-sm border border-border bg-sunken">
      <pre
        className="scrollbar-thin overflow-x-auto p-3 pr-12 font-mono text-sm text-fg"
        tabIndex={0}
        aria-label={label}
        data-testid={testId}
      >
        {code}
      </pre>
      <div className="absolute right-1 top-1">
        <IconButton label={m.settingsIntegrations.common.copyLabel(what)} size="sm" icon={<Icon name="copy" />} onClick={() => copy(code, what)} />
      </div>
    </div>
  );
}
