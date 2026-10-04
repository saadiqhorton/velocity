import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Table, Tabs } from '../src';

describe('Tabs', () => {
  it('uses ARIA tabs and arrow-key navigation', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        aria-label="Sections"
        onChange={onChange}
        items={[
          { id: 'a', label: 'One', panel: <p>Panel one</p> },
          { id: 'b', label: 'Two', panel: <p>Panel two</p> },
          { id: 'c', label: 'Three', panel: <p>Panel three</p> },
        ]}
      />,
    );
    const [one, two, three] = screen.getAllByRole('tab');
    expect(one?.getAttribute('aria-selected')).toBe('true');
    expect(one?.getAttribute('tabindex')).toBe('0');
    expect(two?.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel one');
    fireEvent.keyDown(one as HTMLElement, { key: 'ArrowRight' });
    expect(two?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(two);
    expect(onChange).toHaveBeenCalledWith('b');
    fireEvent.keyDown(two as HTMLElement, { key: 'End' });
    expect(three?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(three as HTMLElement, { key: 'ArrowRight' });
    expect(one?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(one?.id);
  });
});

interface Row {
  id: string;
  name: string;
}
const rows: Row[] = [
  { id: '1', name: 'Bravo' },
  { id: '2', name: 'Alpha' },
  { id: '3', name: 'Charlie' },
];

describe('Table', () => {
  const renderTable = (extra = {}) =>
    render(
      <Table<Row>
        aria-label="Things"
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: 'name', header: 'Name', sortable: true, sortValue: (r) => r.name },
          { key: 'id', header: 'Id' },
        ]}
        {...extra}
      />,
    );

  it('toggles aria-sort and sorts rows', () => {
    renderTable();
    const header = screen.getByRole('columnheader', { name: /name/i });
    expect(header.getAttribute('aria-sort')).toBe('none');
    const button = screen.getByRole('button', { name: /name/i });
    fireEvent.click(button);
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['Alpha2', 'Bravo1', 'Charlie3']);
    fireEvent.click(button);
    expect(header.getAttribute('aria-sort')).toBe('descending');
    expect(screen.getAllByRole('row')[1]?.textContent).toBe('Charlie3');
    expect(screen.getByRole('columnheader', { name: /id/i }).getAttribute('aria-sort')).toBeNull();
  });

  it('has a roving tabindex moved by arrow keys', () => {
    renderTable({ selectedKeys: ['2'] });
    const body = () => screen.getAllByRole('row').slice(1);
    expect(body().map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    body()[0]?.focus();
    fireEvent.keyDown(body()[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(body()[1]);
    expect(body().map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(body()[1]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(body()[1] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(body()[2]);
  });

  it('renders the empty state slot', () => {
    renderTable({ rows: [], emptyState: <p>Nothing here</p> });
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });
});
