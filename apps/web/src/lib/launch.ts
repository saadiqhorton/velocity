/**
 * "Open in" a coding tool (Roadmap v1.2 U3). Browsers cannot start a terminal, so CLI
 * tools get a ready-to-run shell command on the clipboard; deep links open directly
 * unless the prompt makes the URL too long, in which case the prompt is copied instead.
 */
import type { CodingTool } from '@/stores/codingTools';
import { maxUrlFor } from '@/stores/codingTools';

export interface LaunchVars {
  prompt: string;
  id: string;
  branch: string;
  url: string;
}

export type LaunchPlan =
  | { type: 'open'; url: string }
  | { type: 'copy'; text: string; reason: 'command' | 'too-long' };

/** A heredoc delimiter that does not occur as a line of the prompt. */
export function heredocDelimiter(text: string): string {
  const lines = new Set(text.split(/\r?\n/));
  let delim = 'VELOCITY_PROMPT';
  for (let i = 2; lines.has(delim); i++) delim = `VELOCITY_PROMPT_${i}`;
  return delim;
}

/**
 * The prompt as one shell word: `"$(cat <<'EOF' … EOF)"`. The quoted delimiter turns off
 * expansion inside the body, so backticks, `$` and quotes in the issue reach the tool as-is.
 * Works in bash and zsh (the documented shells for these CLIs).
 */
export function shellPromptArg(prompt: string): string {
  const body = prompt.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const delim = heredocDelimiter(body);
  return `"$(cat <<'${delim}'\n${body}\n${delim}\n)"`;
}

/** Single-quote a short value for the shell (`it's` → `'it'\''s'`). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function fillTemplate(template: string, vars: LaunchVars, kind: CodingTool['kind']): string {
  const enc = kind === 'deeplink' ? encodeURIComponent : (v: string) => shellQuote(v);
  return template.replace(/\{(prompt|id|branch|url)\}/g, (_, key: keyof LaunchVars) =>
    key === 'prompt' ? (kind === 'deeplink' ? encodeURIComponent(vars.prompt) : shellPromptArg(vars.prompt)) : enc(vars[key]),
  );
}

export function planLaunch(tool: CodingTool, vars: LaunchVars): LaunchPlan {
  if (tool.kind === 'command') return { type: 'copy', text: fillTemplate(tool.template, vars, 'command'), reason: 'command' };
  const url = fillTemplate(tool.template, vars, 'deeplink');
  if (url.length > maxUrlFor(tool)) return { type: 'copy', text: vars.prompt, reason: 'too-long' };
  return { type: 'open', url };
}

/** Follow a deep link without leaving the page (custom schemes hand off to the app). */
export function openDeepLink(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener noreferrer';
  if (/^https?:/i.test(url)) a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
