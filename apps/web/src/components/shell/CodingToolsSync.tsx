import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { UpdatePreferencesDocument, ViewerDocument } from '@/gql/graphql';
import type { Viewer } from '@/app/workspace';
import { useOptimisticMutation } from '@/lib/mutation';
import { clearLegacyConfig, defaultConfig, readLegacyConfig, useCodingTools } from '@/stores/codingTools';
import type { CodingToolsConfig } from '@/stores/codingTools';
import { m } from '@/i18n';

function fromServer(preferences: NonNullable<Viewer['preferences']>): CodingToolsConfig {
  return {
    version: 1,
    tools: preferences.codingTools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      kind: tool.kind,
      template: tool.template,
      enabled: tool.enabled,
      ...(tool.preset ? { preset: tool.preset as NonNullable<CodingToolsConfig['tools'][number]['preset']> } : {}),
      ...(tool.shortcut ? { shortcut: tool.shortcut } : {}),
    })),
    instructions: preferences.promptInstructions,
  };
}

/** Hydrate before showing account-specific tools, then persist edits in order. */
export function CodingToolsSync({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const { ownerId, revision, tools, instructions, hydrate } = useCodingTools();
  const confirmed = useRef<CodingToolsConfig>(defaultConfig());
  const migrating = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [update] = useOptimisticMutation(UpdatePreferencesDocument, {
    // The local settings store updates immediately; the server confirms persistence.
    optimistic: { serverConfirmed: 'Coding tools are applied immediately in the local store while the server saves them.' },
    rollback: () => m.codingTools.saveFailed,
    update(cache, result) {
      if (useCodingTools.getState().ownerId !== viewer.id || !result.data?.updatePreferences) return;
      const current = cache.readQuery({ query: ViewerDocument });
      if (current?.viewer?.id === viewer.id) {
        cache.writeQuery({ query: ViewerDocument, data: { ...current, viewer: { ...current.viewer, preferences: result.data.updatePreferences } } });
      }
    },
  });

  useLayoutEffect(() => {
    if (ownerId === viewer.id) return;
    // Server preferences exist: they win, and any browser copy is already migrated (or its save
    // response was lost to a navigation after the server stored it), so drop the stale copy.
    if (viewer.preferences) clearLegacyConfig();
    const legacy = viewer.preferences ? null : readLegacyConfig();
    const config = viewer.preferences ? fromServer(viewer.preferences) : legacy ?? defaultConfig();
    confirmed.current = config;
    migrating.current = Boolean(legacy);
    hydrate(viewer.id, config, Boolean(legacy));
  }, [viewer.id, viewer.preferences, ownerId, hydrate]);

  useEffect(() => {
    if (ownerId !== viewer.id || revision === 0) return;
    const accountId = viewer.id;
    const saveRevision = revision;
    const config: CodingToolsConfig = { version: 1, tools, instructions };
    const timer = window.setTimeout(() => {
      queue.current = queue.current.then(async () => {
        if (useCodingTools.getState().ownerId !== accountId) return;
        const { error } = await update({
          input: {
            codingTools: config.tools.map(({ id, preset, name, kind, template, enabled, shortcut }) => ({
              id, name, kind, template, enabled,
              ...(preset ? { preset } : {}),
              ...(shortcut ? { shortcut } : {}),
            })),
            promptInstructions: config.instructions,
          },
        });
        if (useCodingTools.getState().ownerId !== accountId) return;
        if (error) {
          if (useCodingTools.getState().revision === saveRevision) hydrate(accountId, confirmed.current);
          return;
        }
        confirmed.current = config;
        if (migrating.current) {
          clearLegacyConfig();
          migrating.current = false;
        }
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [ownerId, revision, tools, instructions, viewer.id, update, hydrate]);

  return ownerId === viewer.id ? children : null;
}
