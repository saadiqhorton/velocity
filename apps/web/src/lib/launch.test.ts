import { describe, expect, it } from 'vitest';
import { fillTemplate, heredocDelimiter, planLaunch, shellPromptArg, shellQuote } from './launch';
import { defaultConfig } from '@/stores/codingTools';
import type { CodingTool } from '@/stores/codingTools';

const vars = { prompt: '# ENG-1: Fix `x` and $HOME\n"quoted" it\'s', id: 'ENG-1', branch: 'eng-1-fix', url: 'https://v.example/issue/u' };
const preset = (id: string): CodingTool => {
  const t = defaultConfig().tools.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};

describe('shell commands', () => {
  it('wraps the prompt in a quoted heredoc so nothing expands', () => {
    expect(shellPromptArg('a $b `c`\n')).toBe(`"$(cat <<'VELOCITY_PROMPT'\na $b \`c\`\nVELOCITY_PROMPT\n)"`);
  });
  it('picks a delimiter that is not a line of the prompt', () => {
    expect(heredocDelimiter('VELOCITY_PROMPT\nVELOCITY_PROMPT_2')).toBe('VELOCITY_PROMPT_3');
  });
  it('single-quotes other placeholders', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(fillTemplate('tool --branch {branch} {prompt}', vars, 'command')).toMatch(/^tool --branch 'eng-1-fix' "\$\(cat <<'VELOCITY_PROMPT'\n/);
  });
  it('copies a ready-to-run command for CLI presets', () => {
    for (const [id, head] of [
      ['claude-code', 'claude "$(cat'],
      ['codex-cli', 'codex "$(cat'],
      ['opencode', 'opencode --prompt "$(cat'],
      ['pi', 'pi -- "$(cat'],
    ] as const) {
      const plan = planLaunch(preset(id), vars);
      expect(plan.type).toBe('copy');
      if (plan.type === 'copy') {
        expect(plan.reason).toBe('command');
        expect(plan.text.startsWith(head)).toBe(true);
        expect(plan.text).toContain(vars.prompt);
      }
    }
  });
});

describe('deep links', () => {
  it('URL-encodes the prompt for Cursor and Codex', () => {
    const cursor = planLaunch(preset('cursor'), vars);
    expect(cursor).toEqual({ type: 'open', url: `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(vars.prompt)}` });
    const codex = planLaunch(preset('codex'), vars);
    expect(codex).toEqual({ type: 'open', url: `codex://new?prompt=${encodeURIComponent(vars.prompt)}` });
  });
  it('falls back to copying the prompt when the link is too long', () => {
    const long = { ...vars, prompt: 'x'.repeat(12000) };
    expect(planLaunch(preset('cursor'), long)).toEqual({ type: 'copy', text: long.prompt, reason: 'too-long' });
    const custom: CodingTool = { id: 'c', name: 'Mine', kind: 'deeplink', template: 'https://x.example/?q={prompt}', enabled: true };
    expect(planLaunch(custom, { ...vars, prompt: 'y'.repeat(9000) }).type).toBe('copy');
  });
});
