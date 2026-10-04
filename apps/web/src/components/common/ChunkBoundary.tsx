import { Component, lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Button, InlineMessage } from '@velocity/ui';
import { m } from '@/i18n';

/**
 * A lazily loaded component that can load again after its chunk failed (offline, a deploy in
 * between). React caches a rejected `lazy()` import forever, so `reset()` swaps in a fresh one;
 * the stable `Component` renders whichever is current. Pair it with `ChunkBoundary`.
 */
export function retryableLazy<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  // `lazy()` widens props with ref attributes; the wrapper forwards plain props only.
  const make = () => lazy(load) as unknown as ComponentType<P>;
  let current = make();
  function Component(props: P) {
    const Current = current;
    return <Current {...props} />;
  }
  return {
    Component,
    reset: () => {
      current = make();
    },
  };
}

interface Props {
  children: ReactNode;
  /** Called before the children mount again; reset the `retryableLazy` component here. */
  onRetry: () => void;
}

/**
 * Local error boundary for a lazily loaded part of a screen (editor, detail panel), so a failed
 * chunk shows an inline retry instead of replacing the whole app with the route error screen.
 */
export class ChunkBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  private readonly retry = () => {
    this.props.onRetry();
    this.setState({ failed: false });
  };

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <InlineMessage
        appearance="error"
        title={m.shell.loadError}
        action={
          <Button size="sm" onClick={this.retry}>
            {m.common.retry}
          </Button>
        }
      />
    );
  }
}
