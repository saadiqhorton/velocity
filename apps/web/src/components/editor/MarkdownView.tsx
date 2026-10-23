import { useMemo } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import clsx from 'clsx';

marked.setOptions({ gfm: true, breaks: false });

/** Sanitized Markdown render (SPEC §3.5: sanitized render; links open safely). */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target', 'rel'] });
}

/**
 * Same-app links (for example the `[ENG-123](/issue/…)` references the editor inserts) navigate in
 * place instead of reloading the SPA. External and modified clicks keep the browser's behavior.
 */
function isInAppClick(e: MouseEvent<HTMLDivElement>): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const anchor = e.target instanceof Element ? e.target.closest('a') : null;
  const href = anchor?.getAttribute('href') ?? null;
  return href && href.startsWith('/') && !href.startsWith('//') ? href : null;
}

export function MarkdownView({ markdown, className }: { markdown: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  const navigate = useNavigate();
  return (
    <div
      className={clsx('prose-vel text-base text-fg', className)}
      onClick={(e) => {
        const href = isInAppClick(e);
        if (href === null) return;
        e.preventDefault();
        navigate(href);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
