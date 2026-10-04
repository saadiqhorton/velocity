import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { IconButton } from './Button';
import { Portal } from './Portal';
import { useEnterStyle } from '../utils/react';

export type FlagSeverity = 'info' | 'success' | 'warning' | 'error';

export interface FlagOptions {
  title: string;
  description?: ReactNode;
  severity?: FlagSeverity;
  action?: { label: string; onClick: () => void };
  /** Errors always persist; set true to persist other severities. */
  persistent?: boolean;
}

export interface FlagItem extends FlagOptions {
  id: string;
}

export interface FlagsApi {
  showFlag: (flag: FlagOptions) => string;
  dismissFlag: (id: string) => void;
}

const FlagsContext = createContext<FlagsApi | null>(null);

export const MAX_VISIBLE_FLAGS = 3;
export const FLAG_AUTO_DISMISS_MS = 5000;

const dotColor: Record<FlagSeverity, string> = {
  info: 'var(--ds-color-primary)',
  success: 'var(--ds-color-success)',
  warning: 'var(--ds-color-warning)',
  error: 'var(--ds-color-danger)',
};

export function useFlags(): FlagsApi {
  const ctx = useContext(FlagsContext);
  if (!ctx) throw new Error('useFlags must be used within a FlagProvider');
  return ctx;
}

export function FlagProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FlagItem[]>([]);
  const counter = useRef(0);

  const showFlag = useCallback((flag: FlagOptions) => {
    counter.current += 1;
    const id = `flag-${counter.current}`;
    setFlags((prev) => [...prev, { ...flag, id }]);
    return id;
  }, []);
  const dismissFlag = useCallback((id: string) => setFlags((prev) => prev.filter((f) => f.id !== id)), []);
  const api = useMemo(() => ({ showFlag, dismissFlag }), [showFlag, dismissFlag]);

  const visible = flags.slice(0, MAX_VISIBLE_FLAGS);
  return (
    <FlagsContext.Provider value={api}>
      {children}
      <Portal>
        <div
          aria-live="polite"
          aria-label="Notifications"
          className="pointer-events-none fixed bottom-4 left-4 flex w-80 flex-col gap-2"
          style={{ zIndex: 'var(--ds-z-index-flag)' }}
        >
          {visible.map((flag) => (
            <Flag key={flag.id} flag={flag} onDismiss={dismissFlag} />
          ))}
        </div>
      </Portal>
    </FlagsContext.Provider>
  );
}

export interface FlagProps {
  flag: FlagItem;
  onDismiss: (id: string) => void;
}

/** A single toast. Exported for static rendering in the gallery. */
export function Flag({ flag, onDismiss }: FlagProps) {
  const severity = flag.severity ?? 'info';
  const persists = severity === 'error' || flag.persistent;
  const [paused, setPaused] = useState(false);
  const enter = useEnterStyle({ durationVar: 'var(--ds-duration-200)', from: 'translateX(-16px)' });

  useEffect(() => {
    if (persists || paused) return;
    const t = setTimeout(() => onDismiss(flag.id), FLAG_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [persists, paused, flag.id, onDismiss]);

  return (
    <div
      role={severity === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex items-start gap-2 rounded-md border border-border bg-overlay p-3 text-fg shadow-overlay"
      style={enter}
    >
      <span
        aria-hidden="true"
        className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor[severity] }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold">{flag.title}</p>
        {flag.description ? <p className="text-sm text-fg-subtle">{flag.description}</p> : null}
        {flag.action ? (
          <button
            type="button"
            onClick={() => {
              flag.action?.onClick();
              onDismiss(flag.id);
            }}
            className="mt-1 text-sm font-medium text-link hover:underline"
          >
            {flag.action.label}
          </button>
        ) : null}
      </div>
      <IconButton label="Dismiss" size="sm" icon={<Icon name="close" />} onClick={() => onDismiss(flag.id)} />
    </div>
  );
}
