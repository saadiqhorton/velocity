import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import clsx from 'clsx';

marked.setOptions({ gfm: true, breaks: false });

/** Sanitized Markdown render (SPEC §3.5: sanitized render; links open safely). */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target', 'rel'] });
}

export function MarkdownView({ markdown, className }: { markdown: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  return <div className={clsx('prose-vel text-base text-fg', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
