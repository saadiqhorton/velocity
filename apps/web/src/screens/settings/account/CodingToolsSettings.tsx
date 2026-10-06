import { useState } from 'react';
import clsx from 'clsx';
import { Button, Icon, IconButton, Radio, RadioGroup, Select, Switch, TextArea, TextField, useFlags } from '@velocity/ui';
import { DEFAULT_TOOL_SHORTCUT, INSTRUCTIONS_MAX, TEMPLATE_MAX, useCodingTools, validateTool } from '@/stores/codingTools';
import type { CodingTool, ToolKind } from '@/stores/codingTools';
import { formatBinding, isMacPlatform } from '@/keyboard/engine';
import { SectionBody, SettingsPage, SettingsSection } from '../common';
import { m } from '@/i18n';

const MAC = isMacPlatform();
const SHORTCUTS = [DEFAULT_TOOL_SHORTCUT, 'mod+alt+1', 'mod+alt+2', 'mod+alt+3', 'mod+alt+4'];
const caps = (binding: string) => formatBinding(binding, MAC)[0]?.join(MAC ? '' : '+') ?? binding;

function withoutShortcut(tool: CodingTool): CodingTool {
  const next = { ...tool };
  delete next.shortcut;
  return next;
}

interface Draft {
  name: string;
  kind: ToolKind;
  template: string;
}

/** Name, launch kind and template for a custom tool, with inline validation. */
function ToolForm({ initial, submitLabel, onSubmit, onCancel }: { initial: Draft; submitLabel: string; onSubmit: (d: Draft) => void; onCancel?: () => void }) {
  const t = m.codingTools;
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState(false);
  const error = validateTool(draft);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!error) onSubmit({ ...draft, name: draft.name.trim(), template: draft.template.trim() });
      }}
    >
      <TextField label={t.name} value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} error={touched && error === 'name' ? t.errors.name : undefined} />
      <RadioGroup label={t.kindLabel} value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v as ToolKind })}>
        <Radio value="deeplink" label={t.kindDeeplink} />
        <Radio value="command" label={t.kindCommand} />
      </RadioGroup>
      <TextField
        label={t.template}
        value={draft.template}
        maxLength={TEMPLATE_MAX}
        className="font-mono"
        placeholder={draft.kind === 'deeplink' ? t.templateDeeplinkExample : t.templateCommandExample}
        helperText={t.templateHelp}
        onChange={(e) => setDraft({ ...draft, template: e.target.value })}
        error={touched && error && error !== 'name' ? t.errors[error] : undefined}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button size="sm" onClick={onCancel}>
            {m.common.cancel}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Settings › Account › Coding tools (Roadmap v1.2 U3): presets for Claude Code, Codex, Codex
 * CLI, Cursor, opencode and Pi plus custom tools; order, enable, shortcut, custom instructions.
 */
export function CodingToolsSettings() {
  const t = m.codingTools;
  const { tools, instructions, setConfig, reset } = useCodingTools();
  const { showFlag } = useFlags();
  const [editing, setEditing] = useState<string | null>(null);
  const [notes, setNotes] = useState(instructions);

  const save = (next: CodingTool[]) => setConfig({ tools: next, instructions });
  const patch = (id: string, change: Partial<CodingTool>) => save(tools.map((tool) => (tool.id === id ? { ...tool, ...change } : tool)));
  const move = (index: number, delta: -1 | 1) => {
    const next = [...tools];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + delta, 0, item);
    save(next);
  };
  const setShortcut = (id: string, binding: string) =>
    save(
      tools.map((tool) => {
        if (tool.id === id) return binding ? { ...tool, shortcut: binding } : withoutShortcut(tool);
        // A binding belongs to one tool at a time.
        return binding && tool.shortcut === binding ? withoutShortcut(tool) : tool;
      }),
    );

  return (
    <SettingsPage
      title={t.title}
      description={t.description}
      testId="settings-coding-tools"
      actions={
        <Button
          size="sm"
          onClick={() => {
            reset();
            setNotes('');
            showFlag({ title: t.resetDone, severity: 'success' });
          }}
        >
          {t.reset}
        </Button>
      }
    >
      <SettingsSection title={t.tools} description={t.toolsHelp}>
        <ul aria-label={t.tools} data-testid="coding-tools-list">
          {tools.map((tool, i) => (
            <li key={tool.id} className="border-t border-border first:border-t-0" data-testid="coding-tool">
              <div className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2 sm:flex-nowrap">
                <Switch checked={tool.enabled} onChange={(on) => patch(tool.id, { enabled: on })} aria-label={t.enabled(tool.name)} />
                <Icon name={tool.kind === 'command' ? 'terminal' : 'external-link'} className="shrink-0 text-fg-subtle" />
                <div className="min-w-0 flex-1">
                  <div className={clsx('truncate text-base font-medium', tool.enabled ? 'text-fg' : 'text-fg-subtle')}>{tool.name}</div>
                  <div className="truncate text-sm text-fg-subtle">
                    {t.kind[tool.kind]}
                    {tool.preset ? ` · ${t.preset}` : ''} · <code className="font-mono text-fg-subtlest">{tool.template}</code>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                <div className="w-32">
                <Select
                  size="sm"
                  aria-label={t.shortcut(tool.name)}
                  value={tool.shortcut ?? ''}
                  onChange={(e) => setShortcut(tool.id, e.target.value)}
                  options={[{ value: '', label: t.noShortcut }, ...SHORTCUTS.map((s) => ({ value: s, label: caps(s) }))]}
                />
                </div>
                <span className="flex items-center">
                  <IconButton label={t.moveUp(tool.name)} size="sm" icon={<Icon name="arrow-up" />} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton label={t.moveDown(tool.name)} size="sm" icon={<Icon name="arrow-down" />} disabled={i === tools.length - 1} onClick={() => move(i, 1)} />
                  {!tool.preset ? (
                    <>
                      <IconButton label={t.edit(tool.name)} size="sm" icon={<Icon name="edit" />} onClick={() => setEditing(editing === tool.id ? null : tool.id)} />
                      <IconButton label={t.remove(tool.name)} size="sm" icon={<Icon name="trash" />} onClick={() => save(tools.filter((x) => x.id !== tool.id))} />
                    </>
                  ) : null}
                </span>
                </div>
              </div>
              {editing === tool.id ? (
                <div className="border-t border-border bg-sunken px-4 py-3">
                  <ToolForm
                    initial={{ name: tool.name, kind: tool.kind, template: tool.template }}
                    submitLabel={t.save}
                    onCancel={() => setEditing(null)}
                    onSubmit={(d) => {
                      patch(tool.id, d);
                      setEditing(null);
                    }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </SettingsSection>

      <SettingsSection title={t.custom}>
        <SectionBody>
          <ToolForm
            key={tools.length}
            initial={{ name: '', kind: 'command', template: '' }}
            submitLabel={t.add}
            onSubmit={(d) => save([...tools, { id: `custom-${crypto.randomUUID()}`, ...d, enabled: true }])}
          />
        </SectionBody>
      </SettingsSection>

      <SettingsSection title={t.instructions}>
        <SectionBody>
          <TextArea
            id="prompt-instructions"
            label={t.instructions}
            helperText={t.instructionsHelp}
            rows={4}
            value={notes}
            maxLength={INSTRUCTIONS_MAX}
            placeholder={t.instructionsPlaceholder}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== instructions) setConfig({ tools, instructions: notes });
            }}
            data-testid="prompt-instructions"
          />
        </SectionBody>
      </SettingsSection>
    </SettingsPage>
  );
}
