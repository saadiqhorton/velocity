import { Suspense } from 'react';
import { ChunkBoundary, retryableLazy } from '@/components/common/ChunkBoundary';
import { m } from '@/i18n';
import type { MarkdownEditorProps } from './MarkdownEditor';

const editor = retryableLazy(() => import('./MarkdownEditor'));
const Editor = editor.Component;

/** Lazy editor boundary (SPEC §4.16: the editor is not in the initial bundle). */
export function LazyEditor(props: MarkdownEditorProps) {
  return (
    <ChunkBoundary onRetry={editor.reset} message={m.shell.editorLoadError}>
      <Suspense fallback={<div className="min-h-20 text-base text-fg-subtlest">{props.placeholder}</div>}>
        <Editor {...props} />
      </Suspense>
    </ChunkBoundary>
  );
}

export function preloadEditor(): void {
  // A prefetch only: if it fails (e.g. offline), the lazy component loads again when it renders.
  import('./MarkdownEditor').catch(() => undefined);
}

export type { MarkdownEditorHandle, MarkdownEditorProps } from './MarkdownEditor';
