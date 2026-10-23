import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache } from '@apollo/client';
import { MemoryRouter } from 'react-router-dom';
import { useUi } from '@/stores/ui';
import { IssueSections } from './IssueSections';
import type { DetailIssue } from './IssueDetail';

vi.mock('@/components/issues/actions', () => ({
  useCreateIssue: () => [vi.fn(), {}],
}));

vi.mock('@/lib/mutation', async (orig) => ({
  ...(await orig<typeof import('@/lib/mutation')>()),
  useOptimisticMutation: () => [vi.fn(), { loading: false }],
}));

afterEach(() => useUi.setState({ picker: null }));

const status = { __typename: 'WorkflowStatus', id: 'st-1', name: 'Todo', category: 'todo', color: 'blue', order: 1, description: null, teamId: 'team-1' };

function issueWith(over: Partial<Record<'children' | 'relations' | 'attachments', unknown[]>>): DetailIssue {
  return {
    id: 'issue-1',
    teamId: 'team-1',
    children: [],
    relations: [],
    attachments: [],
    subIssueRollup: { done: 0, total: 0 },
    ...over,
  } as unknown as DetailIssue;
}

const child = {
  id: 'child-1',
  identifier: 'ENG-2',
  title: 'Split the importer',
  priority: 2,
  status,
  assignee: null,
  subIssueRollup: { done: 0, total: 0 },
};

function renderSections(issue: DetailIssue) {
  return render(
    <ApolloProvider client={new ApolloClient({ cache: new InMemoryCache(), link: ApolloLink.empty() })}>
      <MemoryRouter>
        <IssueSections issue={issue} />
      </MemoryRouter>
    </ApolloProvider>,
  );
}

describe('empty sections', () => {
  it('shows no headings or lists for an issue with no sub-issues, relations or files', () => {
    renderSections(issueWith({}));
    expect(screen.queryByRole('heading', { name: 'Sub-issues' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Relations' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Attachments' })).toBeNull();
    expect(screen.queryByText('No attachments.')).toBeNull();
  });

  it('collapses the three empty sections into one action row', () => {
    renderSections(issueWith({}));
    const row = screen.getByTestId('issue-empty-actions');
    const labels = Array.from(row.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Add sub-issue', 'Add relation', 'Attach file']);
  });

  it('opens the inline sub-issue field from the action row, not the full create form', () => {
    renderSections(issueWith({}));
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-issue' }));
    expect(screen.getByLabelText('Sub-issue title')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sub-issues' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add sub-issue' })).toBeNull();
  });

  it('opens the relation picker anchored to the action button', () => {
    renderSections(issueWith({}));
    const button = screen.getByRole('button', { name: 'Add relation' });
    fireEvent.click(button);
    expect(useUi.getState().picker).toEqual({ kind: 'relation', issueIds: ['issue-1'], anchor: button });
  });
});

describe('populated sections', () => {
  it('renders a section with its list and drops that action from the row', () => {
    renderSections(issueWith({ children: [child] }));
    expect(screen.getByRole('heading', { name: 'Sub-issues' })).toBeTruthy();
    expect(screen.getByText('Split the importer')).toBeTruthy();
    expect(screen.queryByTestId('issue-empty-actions')).not.toBeNull();
    const labels = Array.from(screen.getByTestId('issue-empty-actions').querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Add relation', 'Attach file']);
  });

  it('shows the attachments heading and hides the attach action when files exist', () => {
    const file = { id: 'att-1', filename: 'spec.pdf', mime: 'application/pdf', size: 2048, url: 'https://files.test/spec.pdf', createdAt: '2026-10-01T09:00:00.000Z' };
    renderSections(issueWith({ attachments: [file] }));
    expect(screen.getByRole('heading', { name: 'Attachments' })).toBeTruthy();
    expect(screen.getByText('spec.pdf')).toBeTruthy();
    const labels = Array.from(screen.getByTestId('issue-empty-actions').querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).not.toContain('Attach file');
  });
});
