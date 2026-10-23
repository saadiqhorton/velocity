import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from './Icon';
import { IconButton } from './Button';
import { Portal } from './Portal';
import { useEnterStyle, usePresence } from '../utils/react';

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

/** Errors always persist; other flags persist only when they ask to. */
function isPersistent(flag: FlagOptions): boolean {
  return (flag.severity ?? 'info') === 'error' || Boolean(flag.persistent);
}

/**
 * Keep the newest MAX_VISIBLE_FLAGS in view. A transient flag pushed past the window is dropped:
 * it would otherwise come back later with a fresh timer. Persistent flags wait out of view and
 * return once newer flags clear.
 */
function keepInView(flags: FlagItem[]): FlagItem[] {
  const hidden = flags.length - MAX_VISIBLE_FLAGS;
  return hidden > 0 ? flags.filter((f, i) => i >= hidden || isPersistent(f)) : flags;
}

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
    setFlags((prev) => keepInView([...prev, { ...flag, id }]));
    return id;
  }, []);
  const dismissFlag = useCallback((id: string) => setFlags((prev) => prev.filter((f) => f.id !== id)), []);
  const api = useMemo(() => ({ showFlag, dismissFlag }), [showFlag, dismissFlag]);

  const visible = flags.slice(-MAX_VISIBLE_FLAGS);
  return (
    <FlagsContext.Provider value={api}>
      {children}
      <Portal>
        {/* Bottom-left of the viewport. From md, inside the app shell the stack moves right of the sidebar (app.css sets --flag-inset-left). */}
        <div
          aria-live="polite"
          aria-label="Notifications"
          className="pointer-events-none fixed bottom-4 left-4 flex w-80 flex-col gap-2 md:left-[var(--flag-inset-left,1rem)]"
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

/**
 * A single toast. Exported for static rendering in the gallery. Dismissing (or the auto-dismiss timer) plays a
 * 120ms slide-out that mirrors the slide-in; `onDismiss` runs once it has left, so the stack removes it then.
 */
export function Flag({ flag, onDismiss }: FlagProps) {
  const severity = flag.severity ?? 'info';
  const persists = isPersistent(flag);
  const [paused, setPaused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const { mounted, state } = usePresence(!dismissed);
  const enter = useEnterStyle({ durationVar: 'var(--ds-duration-200)', from: 'translateX(-16px)' });

  useEffect(() => {
    if (dismissed && !mounted) onDismiss(flag.id);
  }, [dismissed, mounted, flag.id, onDismiss]);

  useEffect(() => {
    if (persists || paused || dismissed) return;
    const t = setTimeout(() => setDismissed(true), FLAG_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [persists, paused, dismissed]);

  if (!mounted) return null;
  const leaving = state === 'exit';
  return (
    <div
      role={severity === 'error' ? 'alert' : 'status'}
      aria-hidden={leaving || undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={clsx(
        'flex items-start gap-2 rounded-md border border-border bg-overlay p-3 text-fg shadow-overlay',
        leaving ? 'pointer-events-none' : 'pointer-events-auto',
      )}
      style={
        leaving
          ? {
              opacity: 0,
              transform: 'translateX(-16px)',
              transition: 'opacity var(--ds-duration-100) var(--ds-ease-exit), transform var(--ds-duration-100) var(--ds-ease-exit)',
            }
          : enter
      }
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
              setDismissed(true);
            }}
            className="mt-1 text-sm font-medium text-link hover:underline"
          >
            {flag.action.label}
          </button>
        ) : null}
      </div>
      <IconButton label="Dismiss" size="sm" icon={<Icon name="close" />} onClick={() => setDismissed(true)} />
    </div>
  );
}
