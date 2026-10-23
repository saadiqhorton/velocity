import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EmptyState, Field, Lozenge, Pagination, Popover, Radio, RadioGroup, SideNavGroup, Switch, Table, Tabs } from '../src';

describe('Lozenge (A1 radius and weight)', () => {
  it('uses the 4px radius and medium weight', () => {
    render(<Lozenge color="green">Done</Lozenge>);
    const el = screen.getByText('Done');
    expect(el.className).toContain('rounded-xs');
    expect(el.className).not.toContain('rounded-sm');
    expect(el.className).toContain('font-medium');
    expect(el.className).not.toContain('font-semibold');
  });
});

describe('Field label weight', () => {
  it('uses medium emphasis, not semibold', () => {
    render(
      <Field label="Title">
        <input />
      </Field>,
    );
    const label = screen.getByText('Title');
    expect(label.className).toContain('font-medium');
    expect(label.className).not.toContain('font-semibold');
  });
});

describe('Pagination states', () => {
  it('gives the current page medium weight and every other page a pressed fill', () => {
    render(<Pagination page={2} pageCount={5} onPageChange={vi.fn()} />);
    const current = screen.getByRole('button', { name: 'Page 2' });
    const other = screen.getByRole('button', { name: 'Page 3' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.className).toContain('font-medium');
    expect(current.className).not.toContain('font-semibold');
    expect(other.className).toContain('active:bg-pressed');
  });
});

describe('Tabs pressed fill', () => {
  it('gives underline tabs a pressed fill', () => {
    render(
      <Tabs
        aria-label="Sections"
        items={[
          { id: 'a', label: 'One' },
          { id: 'b', label: 'Two' },
        ]}
      />,
    );
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('active:bg-pressed');
    }
  });

  it('keeps the pill variant pressed fill on unselected segments', () => {
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
    const [, two] = screen.getAllByRole('tab');
    expect(two?.className).toContain('active:bg-pressed');
  });
});

describe('Radio and Switch hover states', () => {
  it('gives radios a hover border in the Checkbox pattern', () => {
    render(
      <RadioGroup label="Density">
        <Radio value="compact" label="Compact" />
      </RadioGroup>,
    );
    expect(screen.getByRole('radio', { name: 'Compact' }).className).toContain('hover:border-fg-subtlest');
  });

  it('gives an off switch and an on switch a hover fill', () => {
    const { unmount } = render(<Switch label="Off" />);
    const off = screen.getByRole('switch', { name: 'Off' }).className;
    expect(off).toContain('hover:bg-neutral-hover');
    expect(off).not.toContain('border-input');
    unmount();
    render(<Switch label="On" defaultChecked />);
    expect(screen.getByRole('switch', { name: 'On' }).className).toContain('hover:bg-primary-hover');
  });
});

describe('Popover height', () => {
  it('stays inside the viewport and scrolls internally', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    render(
      <Popover anchorEl={anchor} open>
        <span>Long menu item</span>
      </Popover>,
    );
    const surface = screen.getByText('Long menu item').parentElement as HTMLElement;
    expect(surface.style.maxHeight).toBe('calc(100vh - 16px)');
    expect(surface.style.overflowY).toBe('auto');
    anchor.remove();
  });
});

describe('Table focused row and app-chrome rows', () => {
  interface Row {
    id: string;
    name: string;
  }
  const rows: Row[] = [
    { id: '1', name: 'Bravo' },
    { id: '2', name: 'Alpha' },
  ];
  const renderTable = (extra = {}) =>
    render(
      <Table<Row>
        aria-label="Things"
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={vi.fn()}
        columns={[{ key: 'name', header: 'Name', render: (r) => r.name }]}
        {...extra}
      />,
    );
  const body = () => screen.getAllByRole('row').slice(1);
  // Class names as tokens, so `bg-neutral` never matches inside `focus-visible:bg-neutral`.
  const tokens = (el: Element | null | undefined) => (el?.className ?? '').split(/\s+/);

  it('does not highlight the roving-focus row until it has keyboard focus', () => {
    renderTable();
    // Row 0 is the roving tab stop, but nothing has focus yet: no permanent fill or bar.
    expect(body()[0]?.getAttribute('tabindex')).toBe('0');
    expect(tokens(body()[0])).toContain('focus-visible:bg-neutral');
    expect(tokens(body()[0])).not.toContain('bg-neutral');
    expect(tokens(body()[0]?.querySelector('td'))).toContain('group-focus-visible:border-l-primary');
    expect(tokens(body()[0]?.querySelector('td'))).not.toContain('border-l-primary');
  });

  it('uses focus-visible variants on every row so the fill follows arrow-key focus', () => {
    renderTable();
    body()[0]?.focus();
    fireEvent.keyDown(body()[0] as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(body()[1]);
    for (const row of body()) {
      expect(tokens(row)).toContain('focus-visible:bg-neutral');
      expect(tokens(row)).not.toContain('bg-neutral');
    }
  });

  it('keeps a selected row accented without the focus variants', () => {
    renderTable({ selectedKeys: ['2'] });
    expect(tokens(body()[1])).toContain('bg-primary-subtle');
    expect(tokens(body()[1]?.querySelector('td'))).toContain('border-l-primary');
    expect(tokens(body()[1]?.querySelector('td'))).not.toContain('group-focus-visible:border-l-primary');
  });

  it('uses the default cursor and no text selection on every row', () => {
    renderTable();
    for (const row of body()) {
      expect(row.className).toContain('cursor-default');
      expect(row.className).toContain('select-none');
      expect(row.className).not.toContain('cursor-pointer');
    }
  });
});

describe('SideNavGroup action padding', () => {
  const toggleTokens = (actions?: boolean) => {
    render(
      <SideNavGroup title="Engineering" variant="item" actions={actions ? <button type="button">+</button> : undefined}>
        <span>child</span>
      </SideNavGroup>,
    );
    return (screen.getByRole('button', { name: 'Engineering' }).className ?? '').split(/\s+/);
  };

  it('reserves room for the actions only while they are revealed', () => {
    const tokens = toggleTokens(true);
    expect(tokens).not.toContain('pr-16');
    expect(tokens).toContain('group-hover/navgroup:pr-16');
    expect(tokens).toContain('group-has-[[data-navgroup-actions]:focus-within]/navgroup:pr-16');
  });

  it('reserves no padding when the group has no actions', () => {
    const tokens = toggleTokens(false);
    expect(tokens.some((t) => t.endsWith('pr-16'))).toBe(false);
  });
});

describe('EmptyState hint slot', () => {
  it('renders a keyboard hint under the action when given', () => {
    const { container } = render(<EmptyState message="Nothing here" action={<button type="button">New</button>} hint={<kbd>C</kbd>} />);
    expect(screen.getByText('C').tagName).toBe('KBD');
    expect(container.querySelector('kbd')?.parentElement?.className).toContain('text-fg-subtlest');
  });

  it('renders no hint wrapper when the hint is omitted', () => {
    const { container } = render(<EmptyState message="Nothing here" />);
    expect(container.querySelector('kbd')).toBeNull();
    expect(container.querySelectorAll('div').length).toBe(1);
  });
});
