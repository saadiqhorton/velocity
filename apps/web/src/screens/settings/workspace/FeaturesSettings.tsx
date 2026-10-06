import { Switch } from '@velocity/ui';
import { UpdateWorkspaceFeaturesDocument } from '@/gql/graphql';
import type { WorkspaceFeaturesInput } from '@/gql/graphql';
import { useWorkspace } from '@/app/workspace';
import { useOptimisticMutation } from '@/lib/mutation';
import { featuresOf } from '@/lib/features';
import type { Features } from '@/lib/features';
import { SettingsPage, SettingsRow, SettingsSection } from '../common';
import { m } from '@/i18n';

const KEYS = ['cycles', 'estimates', 'insights', 'members'] as const;
type Key = (typeof KEYS)[number];

/**
 * Settings › Workspace › Features (U4): one switch per feature plus a Solo mode master
 * switch (all four off). Owner-only; the server audits every change (S1).
 */
export function FeaturesSettings() {
  const { workspace } = useWorkspace();
  const features = featuresOf(workspace);
  const [update, { loading }] = useOptimisticMutation(UpdateWorkspaceFeaturesDocument, {
    optimistic: (vars) => {
      const next: Features = { ...features, ...(Object.fromEntries(Object.entries(vars.input).filter(([, v]) => typeof v === 'boolean')) as Partial<Features>) };
      next.solo = !next.cycles && !next.estimates && !next.insights && !next.members;
      return {
        __typename: 'Mutation' as const,
        updateWorkspaceFeatures: {
          __typename: 'Workspace' as const,
          slug: workspace?.slug ?? '',
          features: { __typename: 'WorkspaceFeatures' as const, ...next },
        },
      };
    },
    rollback: () => m.features.saveFailed,
  });

  const set = (input: WorkspaceFeaturesInput) => void update({ input });
  const setSolo = (solo: boolean) => set(Object.fromEntries(KEYS.map((k) => [k, !solo])) as Record<Key, boolean>);

  return (
    <SettingsPage title={m.features.title} description={m.features.description} testId="settings-features">
      <SettingsSection title={m.features.solo}>
        <SettingsRow label={m.features.solo} description={m.features.soloHelp} htmlFor="feature-solo">
          <Switch id="feature-solo" checked={features.solo} disabled={loading} onChange={setSolo} data-testid="feature-solo" />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={m.features.groupLabel}>
        {KEYS.map((key) => (
          <SettingsRow key={key} label={m.features.names[key]} description={m.features.help[key]} htmlFor={`feature-${key}`}>
            <Switch id={`feature-${key}`} checked={features[key]} disabled={loading} onChange={(on) => set({ [key]: on })} data-testid={`feature-${key}`} />
          </SettingsRow>
        ))}
      </SettingsSection>
    </SettingsPage>
  );
}
