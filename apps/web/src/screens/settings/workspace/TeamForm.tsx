import { Field, InlineMessage, TextArea, TextField } from '@velocity/ui';
import type { PaletteColor } from '@/gql/graphql';
import { KEY_PATTERN, PaletteSwatches } from './shared';
import { m } from '@/i18n';

export interface TeamFormValues {
  name: string;
  key: string;
  color: PaletteColor;
  icon: string;
  description: string;
}

/** Shared team details fields (new team and team General tab). Rows use the 16px section padding. */
export function TeamFormFields({
  values,
  onChange,
  keyError,
  warnKeyChange,
  nameAutoFocus,
}: {
  values: TeamFormValues;
  onChange: (patch: Partial<TeamFormValues>) => void;
  keyError?: string | null;
  warnKeyChange?: boolean;
  nameAutoFocus?: boolean;
}) {
  const t = m.settingsWorkspace.newTeam;
  const keyValid = KEY_PATTERN.test(values.key);
  const keyText = keyError ?? (values.key.length > 0 && !keyValid ? t.keyInvalid : null);
  return (
    <div className="flex flex-col gap-4 p-4">
      <Field label={t.name} required>
        <TextField value={values.name} maxLength={80} onChange={(e) => onChange({ name: e.target.value })} autoFocus={nameAutoFocus} />
      </Field>
      <Field label={t.key} required helperText={t.keyHelp} error={keyText ?? undefined}>
        <div className="w-40">
          <TextField
            value={values.key}
            maxLength={10}
            className="font-mono uppercase"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onChange({ key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
          />
        </div>
      </Field>
      {warnKeyChange ? <InlineMessage appearance="warning">{m.settingsWorkspace.team.keyWarning}</InlineMessage> : null}
      <Field label={t.color}>
        <PaletteSwatches value={values.color} onChange={(color) => onChange({ color })} label={t.color} />
      </Field>
      <Field label={t.icon} helperText={t.iconHelp}>
        <div className="w-24">
          <TextField value={values.icon} maxLength={8} onChange={(e) => onChange({ icon: e.target.value })} />
        </div>
      </Field>
      <Field label={t.description}>
        <TextArea value={values.description} rows={3} maxLength={500} onChange={(e) => onChange({ description: e.target.value })} />
      </Field>
    </div>
  );
}
