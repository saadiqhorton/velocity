import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import clsx from 'clsx';
import { Portal } from './Portal';
import { Button, IconButton } from './Button';
import { Icon } from './Icon';
import { getFocusable, useEnterStyle } from '../utils/react';

export type ModalSize = 'sm' | 'md' | 'lg';
const widths: Record<ModalSize, number> = { sm: 400, md: 560, lg: 760 };

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  size?: ModalSize;
  children?: ReactNode;
  /** Footer actions (Buttons). */
  footer?: ReactNode;
  /** Invoked on Enter (outside textareas, buttons, links, selects). */
  onSubmit?: () => void;
  /** When true, closing asks for confirmation before discarding. */
  isDirty?: boolean;
  className?: string;
}

export function Modal(props: ModalProps) {
  if (!props.open) return null;
  return (
    <Portal>
      <ModalInner {...props} />
    </Portal>
  );
}

function ModalInner({ onClose, title, description, size = 'md', children, footer, onSubmit, isDirty, className }: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const enter = useEnterStyle();

  // Remember the previously focused element, focus into the dialog, restore on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const explicit = dialog?.querySelector<HTMLElement>('[data-autofocus]');
    const target = explicit ?? getFocusable(bodyRef.current)[0] ?? getFocusable(footerRef.current)[0] ?? dialog;
    target?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  const requestClose = () => {
    if (isDirty) setConfirming(true);
    else onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dialog = dialogRef.current;
    const target = e.target as Node;
    // Events from portaled children (nested modals, popups) bubble through React; ignore them.
    if (!dialog || !dialog.contains(target)) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = getFocusable(dialog);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (e.key === 'Enter' && onSubmit && !e.shiftKey && !e.defaultPrevented) {
      const el = e.target as HTMLElement;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || el.isContentEditable) return;
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto px-4 py-12" style={{ zIndex: 'var(--ds-z-index-modal)' }}>
      <div
        aria-hidden="true"
        data-testid="modal-blanket"
        className="fixed inset-0 bg-blanket"
        onMouseDown={requestClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={clsx('relative flex w-full max-w-full flex-col rounded-lg border border-border bg-raised text-fg shadow-overlay', className)}
        style={{ width: widths[size], ...enter }}
      >
        <div className="flex items-start justify-between gap-2 px-6 pb-2 pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-base text-fg-subtle">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Close" icon={<Icon name="close" size={20} />} onClick={requestClose} />
        </div>
        <div ref={bodyRef} className="px-6 py-2">
          {children}
        </div>
        {footer ? (
          <div ref={footerRef} className="flex justify-end gap-2 px-6 pb-5 pt-4">
            {footer}
          </div>
        ) : null}
      </div>
      <Modal
        open={confirming}
        size="sm"
        title="Discard changes?"
        description="Your unsaved changes will be lost."
        onClose={() => setConfirming(false)}
        onSubmit={undefined}
        footer={
          <>
            <Button data-autofocus onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                onClose();
              }}
            >
              Discard
            </Button>
          </>
        }
      />
    </div>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive confirms use the danger button. */
  destructive?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  loading,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button data-autofocus onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
