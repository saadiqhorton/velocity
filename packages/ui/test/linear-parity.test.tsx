import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriorityIcon, Table, Tabs } from '../src';

describe('PriorityIcon (signal bars)', () => {
  const opaqueBars = (priority: 'high' | 'medium' | 'low') => {
    const { container } = render(<PriorityIcon priority={priority} />);
    return Array.from(container.querySelectorAll('rect')).filter((r) => r.getAttribute('opacity') === '1').length;
  };

  it('fills three, two and one bars for high, medium and low', () => {
    expect(opaqueBars('high')).toBe(3);
    expect(opaqueBars('medium')).toBe(2);
    expect(opaqueBars('low')).toBe(1);
  });

  it('keeps its accessible name', () => {
    render(<PriorityIcon priority="urgent" />);
    expect(screen.getByRole('img', { name: 'Urgent priority' })).toBeTruthy();
  });
});

describe('Tabs pill variant', () => {
  it('renders rounded segments with the selected one filled and no underline rule', () => {
    render(
      <Tabs
        aria-label="Sections"
        variant="pill"
        items={[
          { id: 'a', label: 'One' },
          { id: 'b', label: 'Two' },
        ]}
      />,
    );
    const [one, two] = screen.getAllByRole('tab');
    expect(one?.className).toContain('rounded-full');
    expect(one?.className).toContain('bg-neutral-hover');
    expect(two?.className).not.toContain('bg-neutral-hover');
    expect(screen.getByRole('tablist').className).not.toContain('border-b');
  });
});

describe('Table headers', () => {
  it('are sentence case, not uppercased', () => {
    render(
      <Table
        aria-label="Rows"
        columns={[{ key: 'name', header: 'Name', sortable: true }]}
        rows={[{ id: '1', name: 'Alpha' }]}
        rowKey={(r) => r.id}
      />,
    );
    const header = screen.getByRole('columnheader', { name: /Name/ });
    expect(header.className).not.toContain('uppercase');
    expect(header.querySelector('button')?.className).not.toContain('uppercase');
  });
});

describe('Table cells with in-place property bubbles', () => {
  it('vertically middle-aligns cells so fixed-height triggers sit on the row midline', () => {
    render(
      <Table
        aria-label="Projects"
        columns={[
          { key: 'name', header: 'Name' },
          {
            key: 'lead',
            header: 'Lead',
            render: () => (
              <button type="button" className="inline-flex h-7 items-center">
                No lead
              </button>
            ),
          },
        ]}
        rows={[{ id: '1', name: 'Public launch' }]}
        rowKey={(r) => r.id}
      />,
    );
    const cells = screen.getAllByRole('row')[1]?.querySelectorAll('td');
    expect(cells?.length).toBe(2);
    for (const cell of cells ?? []) {
      expect(cell.className).toContain('align-middle');
    }
  });
});
