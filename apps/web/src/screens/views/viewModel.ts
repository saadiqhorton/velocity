import type { ApolloCache, Reference } from '@apollo/client';
import { useWorkspace } from '@/app/workspace';
import type { WorkspaceData } from '@/app/workspace';
import { CreateViewDocument, DeleteViewDocument, UpdateViewDocument, ViewFieldsFragmentDoc } from '@/gql/graphql';
import type { ViewFieldsFragment, ViewInput } from '@/gql/graphql';
import { fieldLabel } from '@/components/filters/FilterBar';
import { chipIsNegative, chipValues, DATE_FIELDS } from '@/lib/chips';
import { useOptimisticMutation } from '@/lib/mutation';
import { chipsFromDsl, COLUMN_KEYS, DEFAULT_DISPLAY } from '@/lib/viewState';
import type { ColumnKey, ShowCompleted, ViewState } from '@/lib/viewState';
import { m } from '@/i18n';

/** Saved view → the list defaults the issue list starts from. */
export function viewToState(v: Pick<ViewFieldsFragment, 'filter' | 'display'>): ViewState {
  const d = v.display;
  const columns = d.columns.filter((c): c is ColumnKey => (COLUMN_KEYS as readonly string[]).includes(c));
  const done: ShowCompleted = d.showCompleted === 'week' || d.showCompleted === 'none' ? d.showCompleted : 'all';
  return {
    filter: v.filter,
    display: {
      grouping: d.grouping,
      ordering: d.ordering,
      layout: d.layout,
      columns,
      showEmptyGroups: d.showEmptyGroups,
      showSubIssues: d.showSubIssues,
      showCompleted: done,
    },
  };
}

export const NEW_VIEW_STATE: ViewState = { filter: '', display: DEFAULT_DISPLAY };

export function stateToInput(state: ViewState): Pick<ViewInput, 'filter' | 'display'> {
  const d = state.display;
  return {
    filter: state.filter,
    display: {
      grouping: d.grouping,
      ordering: d.ordering,
      layout: d.layout,
      columns: d.columns,
      showCompleted: d.showCompleted,
      showEmptyGroups: d.showEmptyGroups,
      showSubIssues: d.showSubIssues,
    },
  };
}

function datePresetLabel(raw: string): string {
  const match = /^-(\d+)([dwmy])$/.exec(raw);
  if (!match) return raw;
  const unit = ({ d: 'day', w: 'week', m: 'month', y: 'year' } as const)[match[2] as 'd' | 'w' | 'm' | 'y'];
  return m.view.ago(Number(match[1]), unit);
}

function valueLabel(field: string, raw: string, ws: WorkspaceData): string {
  if (raw === 'me') return m.view.me;
  if (raw === 'empty') return m.view.empty;
  if (field === 'priority') return m.priority[Number(raw) as 0 | 1 | 2 | 3 | 4] ?? raw;
  if (field === 'statusCategory') return m.statusCategory[raw as 'todo'] ?? raw;
  if (field === 'assignee' || field === 'creator') return ws.users.find((u) => u.username === raw)?.name ?? raw;
  if (field === 'team') return ws.teamsByKey.get(raw.toUpperCase())?.name ?? raw;
  return raw;
}

/** Readable chip phrases for a filter DSL ("Status is Todo, In progress"); never the raw DSL. */
export function summarizeFilter(dsl: string, ws: WorkspaceData): string[] {
  const parsed = chipsFromDsl(dsl);
  if (parsed.error || parsed.chips === null) return dsl.trim() ? [m.view.list.custom] : [];
  return parsed.chips.map((chip) => {
    const values = chipValues(chip);
    const field = fieldLabel(chip.field);
    if (chip.op === 'contains') return `${field} ${m.view.contains} “${values[0] ?? ''}”`;
    if (DATE_FIELDS.has(chip.field)) {
      const op = chip.op === 'lt' || chip.op === 'lte' ? m.view.before : m.view.after;
      return `${field} ${op} ${datePresetLabel(values[0] ?? '')}`;
    }
    const neg = chipIsNegative(chip);
    const op = values.length > 1 ? (neg ? m.view.isNoneOf : m.view.isAnyOf) : neg ? m.view.isNot : m.view.is;
    const shown = values.length > 2 ? m.view.countOf(values.length, field.toLowerCase()) : values.map((v) => valueLabel(chip.field, v, ws)).join(', ');
    return `${field} ${op} ${shown}`;
  });
}

function appendView(cache: ApolloCache<unknown>, view: ViewFieldsFragment): void {
  const ref = cache.writeFragment({ data: view, fragment: ViewFieldsFragmentDoc, fragmentName: 'ViewFields' });
  if (!ref) return;
  cache.modify({
    fields: {
      views(current: Reference | readonly Reference[] = []) {
        const list = Array.isArray(current) ? (current as readonly Reference[]) : [];
        return list.some((r) => r.__ref === ref.__ref) ? list : [...list, ref];
      },
    },
  });
}

export interface ViewActions {
  create: (input: ViewInput) => Promise<ViewFieldsFragment | null>;
  update: (id: string, input: ViewInput) => Promise<ViewFieldsFragment | null>;
  remove: (id: string) => Promise<boolean>;
}

/** Create / update / delete saved views, keeping the Bootstrap `views` and `favorites` lists in sync. */
export function useViewActions(): ViewActions {
  const ws = useWorkspace();
  const [create] = useOptimisticMutation(CreateViewDocument, {
    optimistic: { serverConfirmed: 'The server mints the view id and unique slug.' },
    rollback: () => m.flags.rollback.view,
    update: (cache, result) => {
      if (result.data?.createView) appendView(cache, result.data.createView);
    },
  });
  const [update] = useOptimisticMutation(UpdateViewDocument, {
    optimistic: (vars) => {
      const cur = ws.views.find((v) => v.id === vars.id);
      if (!cur) throw new Error('view not cached');
      const i = vars.input;
      return {
        __typename: 'Mutation' as const,
        updateView: {
          ...cur,
          name: i.name ?? cur.name,
          icon: i.icon === undefined ? cur.icon : i.icon,
          filter: i.filter ?? cur.filter,
          display: {
            ...cur.display,
            grouping: i.display?.grouping ?? cur.display.grouping,
            ordering: i.display?.ordering ?? cur.display.ordering,
            layout: i.display?.layout ?? cur.display.layout,
            columns: i.display?.columns ?? cur.display.columns,
            showCompleted: i.display?.showCompleted ?? cur.display.showCompleted,
            showEmptyGroups: i.display?.showEmptyGroups ?? cur.display.showEmptyGroups,
            showSubIssues: i.display?.showSubIssues ?? cur.display.showSubIssues,
          },
          updatedAt: new Date().toISOString(),
        },
      };
    },
    rollback: () => m.flags.rollback.view,
  });
  const [remove] = useOptimisticMutation(DeleteViewDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, deleteView: true }),
    rollback: () => m.flags.rollback.view,
    update: (cache, _res, vars) => {
      const id = cache.identify({ __typename: 'View', id: vars.id });
      cache.modify({
        fields: {
          views(current: Reference | readonly Reference[] = []) {
            const list = Array.isArray(current) ? (current as readonly Reference[]) : [];
            return list.filter((r) => r.__ref !== id);
          },
        },
      });
    },
    refetchQueries: ['Bootstrap'],
  });
  return {
    create: async (input) => (await create({ input })).data?.createView ?? null,
    update: async (id, input) => (await update({ id, input })).data?.updateView ?? null,
    remove: async (id) => (await remove({ id })).data?.deleteView === true,
  };
}
