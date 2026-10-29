import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '@/i18n';
import { ImportReferenceRepairPage } from './ImportReferenceRepair';

const mocks = vi.hoisted(() => ({
  isOwner: true,
  repairData: null as Record<string, unknown> | null,
  loading: false,
  queryError: null as Error | null,
  queryVariables: [] as { id: string; first: number; offset: number }[],
  hookCalls: 0,
  start: vi.fn(),
  apply: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@apollo/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apollo/client')>();
  return {
    ...actual,
    useQuery: (_document: unknown, options: { variables: { id: string; first: number; offset: number } }) => {
      mocks.queryVariables.push(options.variables);
      return {
        data: mocks.repairData ? { importReferenceRepair: { ...mocks.repairData, id: options.variables.id } } : null,
        loading: mocks.loading,
        error: mocks.queryError,
        refetch: mocks.refetch,
      };
    },
  };
});

vi.mock('@/lib/mutation', () => ({
  useOptimisticMutation: () => {
    const index = mocks.hookCalls++ % 2;
    return index === 0 ? [mocks.start, { loading: false }] : [mocks.apply, { loading: false }];
  },
}));

vi.mock('../common', () => ({
  OwnerOnlyNotice: () => <aside>Owner only</aside>,
  SettingsPage: ({ children, title }: { children: ReactNode; title: string }) => <main><h1>{title}</h1>{children}</main>,
  SettingsSection: ({ children, title }: { children: ReactNode; title?: string }) => <section>{title ? <h2>{title}</h2> : null}{children}</section>,
  useIsOwner: () => mocks.isOwner,
}));

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function SelectAnotherRepair() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/settings/import/run-1/repair/repair-2')}>Select another repair</button>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SelectAnotherRepair />
      <Location />
      <Routes>
        <Route path="/settings/import/:runId/repair" element={<ImportReferenceRepairPage />} />
        <Route path="/settings/import/:runId/repair/:repairId" element={<ImportReferenceRepairPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function target(id: string, status = 'pending', skipReason: string | null = null) {
  return {
    id, targetKind: 'issue_description', sourceExternalId: id, status, skipReason, referenceCount: 1,
    beforeMd: 'Before ENG-1', afterMd: 'After APP-1', context: { before: 'Before ENG-1', after: 'After APP-1' },
  };
}

function preview(targets = [target('SRC-2', 'skipped', 'stale'), target('SRC-1')], status = 'preview', references = 2) {
  return {
    status, previewHash: 'preview-hash', error: null,
    summary: { targets: Math.max(targets.length, 51), references, applied: 0, skipped: 0, alreadyCorrect: 0, unmapped: 0, ambiguous: 0, stale: 0, missing: 0, codeSkipped: 0 },
    targets,
  };
}

beforeEach(() => {
  cleanup();
  mocks.isOwner = true;
  mocks.repairData = preview();
  mocks.loading = false;
  mocks.queryError = null;
  mocks.queryVariables = [];
  mocks.hookCalls = 0;
  mocks.start.mockReset().mockResolvedValue({ data: { startImportReferenceRepair: { id: 'repair-2' } }, error: null });
  mocks.apply.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.refetch.mockReset();
});

describe('ImportReferenceRepairPage', () => {
  it('shows scan mutation only to owners', async () => {
    renderAt('/settings/import/run-1/repair');
    fireEvent.click(await screen.findByRole('button', { name: m.settingsIntegrations.import.referenceRepair.scan }));
    expect(mocks.start).toHaveBeenCalledWith({ runId: 'run-1' });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/settings/import/run-1/repair/repair-2'));

    cleanup();
    mocks.isOwner = false;
    renderAt('/settings/import/run-1/repair');
    expect(screen.queryByRole('button', { name: m.settingsIntegrations.import.referenceRepair.scan })).toBeNull();
    expect(screen.getByText('Owner only')).toBeTruthy();
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it('shows per-target status and skip reason, and presents only a safe backend error', async () => {
    renderAt('/settings/import/run-1/repair/repair-1');
    expect(screen.getAllByText((_, element) => element?.tagName === 'SPAN' && element.textContent?.includes('Skipped · stale') === true)).toHaveLength(1);
    expect(screen.getByText('SRC-2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: m.settingsIntegrations.import.referenceRepair.apply }));
    expect(await screen.findByText(m.settingsIntegrations.import.referenceRepair.confirmTitle)).toBeTruthy();
    mocks.apply.mockResolvedValueOnce({ data: null, error: { code: 'UNKNOWN', message: 'database password=do-not-show' } });
    fireEvent.click(screen.getByRole('button', { name: m.settingsIntegrations.import.referenceRepair.confirmLabel }));
    expect(await screen.findByText(m.errors.UNKNOWN)).toBeTruthy();
    expect(screen.queryByText(/do-not-show|database password/)).toBeNull();
  });

  it('preserves returned target order, requests stable page offsets, and resets selection state on route change', async () => {
    const { container } = renderAt('/settings/import/run-1/repair/repair-1');
    const initialRows = [...container.querySelectorAll('article')].map((row) => row.querySelector('span')?.textContent);
    expect(initialRows).toEqual(['SRC-2', 'SRC-1']);

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(mocks.queryVariables.at(-1)).toMatchObject({ id: 'repair-1', first: 50, offset: 50 }));

    fireEvent.click(screen.getByRole('button', { name: m.settingsIntegrations.import.referenceRepair.apply }));
    fireEvent.click(await screen.findByRole('button', { name: m.settingsIntegrations.import.referenceRepair.confirmLabel }));
    await waitFor(() => expect(screen.queryByText(m.settingsIntegrations.import.referenceRepair.confirmTitle)).toBeNull());

    mocks.apply.mockResolvedValueOnce({ data: null, error: { code: 'UNKNOWN', message: 'backend detail' } });
    fireEvent.click(screen.getByRole('button', { name: m.settingsIntegrations.import.referenceRepair.apply }));
    fireEvent.click(await screen.findByRole('button', { name: m.settingsIntegrations.import.referenceRepair.confirmLabel }));
    expect(await screen.findByText(m.errors.UNKNOWN)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Select another repair' }));
    await waitFor(() => expect(mocks.queryVariables.at(-1)).toMatchObject({ id: 'repair-2', first: 50, offset: 0 }));
    expect(screen.queryByText(m.errors.UNKNOWN)).toBeNull();
    expect(screen.queryByText(m.settingsIntegrations.import.referenceRepair.confirmTitle)).toBeNull();
  });

  it.each([
    ['scanning', 'Scanning'],
    ['applying', 'Applying'],
    ['failed', 'failed'],
    ['completed', 'Completed'],
    ['superseded', 'superseded'],
  ])('renders the %s lifecycle state', async (status, expected) => {
    mocks.repairData = preview([target('SRC-1')], status);
    renderAt('/settings/import/run-1/repair/repair-1');
    if (status === 'failed') expect(screen.getByText(m.settingsIntegrations.import.referenceRepair.stale)).toBeTruthy();
    if (status === 'scanning') expect(screen.getByText(m.settingsIntegrations.import.referenceRepair.scanning)).toBeTruthy();
    if (status === 'applying') expect(screen.getByText(m.settingsIntegrations.import.referenceRepair.applying)).toBeTruthy();
    if (status === 'completed') expect(screen.getByText(m.settingsIntegrations.import.referenceRepair.completed(0, 0))).toBeTruthy();
    if (status === 'superseded') expect(screen.getByRole('button', { name: m.settingsIntegrations.import.referenceRepair.rescan })).toBeTruthy();
    if (status === 'failed' || status === 'completed') {
      expect(screen.getByRole('button', { name: m.settingsIntegrations.import.referenceRepair.rescan })).toBeTruthy();
    }
    expect(expected.length).toBeGreaterThan(0);
  });

  it('shows unchanged previews without offering apply', () => {
    mocks.repairData = preview([], 'preview', 0);
    renderAt('/settings/import/run-1/repair/repair-1');
    expect(screen.getByText(m.settingsIntegrations.import.referenceRepair.noChanges)).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.settingsIntegrations.import.referenceRepair.apply })).toBeNull();
  });

  it('starts a fresh scan from a completed preview and restricts both mutations to owners', async () => {
    mocks.repairData = preview([target('SRC-1')], 'completed');
    renderAt('/settings/import/run-1/repair/repair-1');
    fireEvent.click(screen.getByRole('button', { name: m.settingsIntegrations.import.referenceRepair.rescan }));
    expect(screen.getByTestId('location').textContent).toBe('/settings/import/run-1/repair');
    fireEvent.click(screen.getByRole('button', { name: m.settingsIntegrations.import.referenceRepair.scan }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith({ runId: 'run-1' }));

    cleanup();
    mocks.isOwner = false;
    mocks.repairData = preview([target('SRC-1')], 'preview');
    renderAt('/settings/import/run-1/repair/repair-1');
    expect(screen.queryByRole('button', { name: m.settingsIntegrations.import.referenceRepair.apply })).toBeNull();
    expect(screen.queryByRole('button', { name: m.settingsIntegrations.import.referenceRepair.rescan })).toBeNull();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it('clears polling when a scanning repair page unmounts', () => {
    mocks.repairData = preview([target('SRC-1')], 'scanning');
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const view = renderAt('/settings/import/run-1/repair/repair-1');
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(setIntervalSpy.mock.results[0]?.value);
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});
