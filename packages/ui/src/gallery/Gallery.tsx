import { useState } from 'react';
import type { ReactNode } from 'react';
import { STATUS_COLORS } from '@velocity/tokens';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { Button, IconButton } from '../components/Button';
import type { ButtonSize, ButtonVariant } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { EmptyState } from '../components/EmptyState';
import { Field } from '../components/Field';
import { Flag, FlagProvider, useFlags } from '../components/Flag';
import { Icon } from '../components/Icon';
import { InlineMessage, Banner } from '../components/InlineMessage';
import type { MessageAppearance } from '../components/InlineMessage';
import { Kbd } from '../components/Kbd';
import { Lozenge, StatusDot } from '../components/Lozenge';
import type { LozengeAppearance } from '../components/Lozenge';
import { Menu, MenuGroup, MenuItem, MenuSeparator, SubMenu, DropdownMenu } from '../components/Menu';
import { ConfirmDialog, Modal } from '../components/Modal';
import { OptionList } from '../components/OptionList';
import type { PopupOption } from '../components/OptionList';
import { Pagination } from '../components/Pagination';
import { PopupSelect } from '../components/PopupSelect';
import { PriorityIcon } from '../components/PriorityIcon';
import type { Priority } from '../components/PriorityIcon';
import { ProgressBar } from '../components/ProgressBar';
import { Radio, RadioGroup } from '../components/Radio';
import { Select } from '../components/Select';
import { SideNav, SideNavGroup, SideNavItem } from '../components/SideNav';
import { Skeleton } from '../components/Skeleton';
import { Spinner } from '../components/Spinner';
import { StatusIcon } from '../components/StatusIcon';
import type { StatusCategory } from '../components/StatusIcon';
import { Switch } from '../components/Switch';
import { Table } from '../components/Table';
import { Tabs } from '../components/Tabs';
import { TextArea, TextField } from '../components/TextField';
import { Tooltip } from '../components/Tooltip';
import { iconMap } from '../icons';
import type { IconName } from '../icons';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-b border-border py-4" data-gallery-section={title}>
      <h2 className="mb-3 text-md font-semibold text-fg">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-40 shrink-0 pt-1 font-mono text-sm text-fg-subtle">{label}</div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const variants: ButtonVariant[] = ['primary', 'default', 'subtle', 'link', 'danger'];
const sizes: ButtonSize[] = ['sm', 'md', 'lg'];
const appearances: LozengeAppearance[] = ['default', 'success', 'removed', 'inprogress', 'new', 'moved'];
const messageAppearances: MessageAppearance[] = ['info', 'warning', 'error', 'success', 'discovery'];
const priorities: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];
const categories: StatusCategory[] = ['backlog', 'todo', 'in_progress', 'done', 'canceled'];

const people: PopupOption[] = [
  { value: 'ada', label: 'Ada Lovelace', group: 'Members', icon: <Avatar name="Ada Lovelace" size={20} /> },
  { value: 'grace', label: 'Grace Hopper', group: 'Members', icon: <Avatar name="Grace Hopper" size={20} /> },
  { value: 'alan', label: 'Alan Turing', group: 'Members', icon: <Avatar name="Alan Turing" size={20} /> },
  { value: 'bot', label: 'Triage bot', group: 'Integrations', icon: <Avatar name="Triage bot" size={20} /> },
  { value: 'off', label: 'Archived user', group: 'Integrations', disabled: true },
];

const statusOptions: PopupOption[] = [
  { value: 'backlog', label: 'Backlog', icon: <StatusIcon category="backlog" /> },
  { value: 'todo', label: 'Todo', icon: <StatusIcon category="todo" /> },
  { value: 'in_progress', label: 'In progress', icon: <StatusIcon category="in_progress" /> },
  { value: 'done', label: 'Done', icon: <StatusIcon category="done" /> },
  { value: 'canceled', label: 'Canceled', icon: <StatusIcon category="canceled" /> },
];

const labelOptions: PopupOption[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature' },
  { value: 'docs', label: 'Documentation' },
];

interface DemoRow {
  id: string;
  title: string;
  status: string;
  estimate: number;
}
const demoRows: DemoRow[] = [
  { id: 'ENG-101', title: 'Sync cycle scope on update', status: 'In progress', estimate: 3 },
  { id: 'ENG-102', title: 'Webhook retries drop payload', status: 'Todo', estimate: 2 },
  { id: 'ENG-103', title: 'Export issues as CSV', status: 'Done', estimate: 5 },
];

function ToastButtons() {
  const { showFlag } = useFlags();
  return (
    <>
      <Button onClick={() => showFlag({ title: 'Issue created', severity: 'success', action: { label: 'View', onClick: () => undefined } })}>
        Show success flag
      </Button>
      <Button onClick={() => showFlag({ title: 'Could not save changes', description: 'Check your connection and retry.', severity: 'error' })}>
        Show error flag
      </Button>
      <Button onClick={() => showFlag({ title: 'Import started', severity: 'info' })}>Show info flag</Button>
    </>
  );
}

function Interactive() {
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [single, setSingle] = useState<string | null>('todo');
  const [multi, setMulti] = useState<string[]>(['bug']);
  const [switchOn, setSwitchOn] = useState(true);
  const [tab, setTab] = useState('comments');
  const [page, setPage] = useState(3);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedRows, setSelectedRows] = useState<string[]>(['ENG-102']);
  const [dirty, setDirty] = useState(true);

  return (
    <>
      <Section title="Button">
        {variants.map((v) => (
          <Row key={v} label={v}>
            {sizes.map((s) => (
              <Button key={s} variant={v} size={s}>
                {s === 'sm' ? 'Small' : s === 'md' ? 'Medium' : 'Large'}
              </Button>
            ))}
            <Button variant={v} disabled>
              Disabled
            </Button>
            <Button variant={v} loading>
              Loading
            </Button>
            <Button variant={v} iconBefore={<Icon name="add" />}>
              Icon before
            </Button>
            <Button variant={v} iconAfter={<Icon name="chevron-down" />}>
              Icon after
            </Button>
          </Row>
        ))}
        <Row label="IconButton">
          {sizes.map((s) => (
            <IconButton key={s} size={s} label={`More actions (${s})`} icon={<Icon name="more" size={20} />} />
          ))}
          <IconButton variant="default" label="Add issue" icon={<Icon name="add" size={20} />} />
          <IconButton variant="danger" label="Delete issue" icon={<Icon name="trash" size={20} />} />
          <IconButton label="Unavailable" disabled icon={<Icon name="edit" size={20} />} />
        </Row>
      </Section>

      <Section title="Form fields">
        <div className="grid max-w-2xl grid-cols-2 gap-4">
          <TextField label="Title" placeholder="Issue title" helperText="Shown in lists and search." />
          <TextField label="Title (small)" size="sm" defaultValue="ENG-101" />
          <TextField label="Estimate" required error="Estimate must be a number." defaultValue="abc" />
          <TextField label="Disabled" disabled defaultValue="Read only" />
          <TextArea label="Description" rows={3} helperText="Markdown is supported." />
          <TextArea label="Notes" size="sm" error="Notes are too long." defaultValue="Long text" />
          <Field label="Team" helperText="Native select, 15 options or fewer.">
            <Select
              options={[
                { value: 'eng', label: 'Engineering' },
                { value: 'des', label: 'Design' },
                { value: 'ops', label: 'Operations', disabled: true },
              ]}
            />
          </Field>
          <Select label="Priority" size="sm" error="Select a priority." options={[{ value: '', label: 'No priority' }, { value: 'high', label: 'High' }]} />
        </div>
      </Section>

      <Section title="Popup select">
        <Row label="single / multi / creatable">
          <PopupSelect label="Status" options={statusOptions} value={single} onChange={setSingle} />
          <PopupSelect label="Assignee" options={people} placeholder="Assignee" />
          <PopupSelect
            label="Labels"
            multiple
            options={labelOptions}
            value={multi}
            onChange={setMulti}
            placeholder="Labels"
            onCreate={(q) => setMulti([...multi, q])}
          />
        </Row>
        <Row label="OptionList (static)">
          <div className="w-60 rounded-md border border-border bg-overlay">
            <OptionList
              id="gallery-optionlist"
              aria-label="Assignee options"
              options={people}
              selectedValues={['grace']}
              activeValue="ada"
              onActiveChange={() => undefined}
              onSelect={() => undefined}
            />
          </div>
          <div className="w-60 rounded-md border border-border bg-overlay">
            <OptionList
              id="gallery-optionlist-multi"
              aria-label="Label options"
              multiple
              options={labelOptions}
              selectedValues={['bug', 'docs']}
              activeValue="feature"
              onActiveChange={() => undefined}
              onSelect={() => undefined}
              create={{ label: 'Create "Regression"', onSelect: () => undefined }}
            />
          </div>
          <div className="w-60 rounded-md border border-border bg-overlay">
            <OptionList
              id="gallery-optionlist-empty"
              aria-label="Empty options"
              options={[]}
              selectedValues={[]}
              activeValue={null}
              onActiveChange={() => undefined}
              onSelect={() => undefined}
            />
          </div>
        </Row>
      </Section>

      <Section title="Checkbox, Radio, Switch">
        <Row label="Checkbox">
          <Checkbox label="Unchecked" />
          <Checkbox label="Checked" defaultChecked />
          <Checkbox label="Indeterminate" indeterminate />
          <Checkbox label="Disabled" disabled />
          <Checkbox label="Disabled checked" disabled defaultChecked />
        </Row>
        <Row label="RadioGroup">
          <RadioGroup label="Layout" defaultValue="list">
            <Radio value="list" label="List" />
            <Radio value="board" label="Board" />
            <Radio value="timeline" label="Timeline" disabled />
          </RadioGroup>
          <RadioGroup label="Density" orientation="horizontal" defaultValue="compact">
            <Radio value="compact" label="Compact" />
            <Radio value="comfortable" label="Comfortable" />
          </RadioGroup>
        </Row>
        <Row label="Switch">
          <Switch label="Enabled" checked={switchOn} onChange={setSwitchOn} />
          <Switch label="Off" defaultChecked={false} />
          <Switch label="Disabled" disabled />
          <Switch aria-label="Compact mode" defaultChecked />
        </Row>
      </Section>

      <Section title="Menu">
        <Row label="DropdownMenu">
          <DropdownMenu trigger={<IconButton label="Issue actions" icon={<Icon name="more" size={20} />} />}>
            <MenuGroup heading="Issue">
              <MenuItem icon={<Icon name="edit" />} shortcut={<Kbd>E</Kbd>}>
                Edit
              </MenuItem>
              <MenuItem icon={<Icon name="copy" />}>Copy link</MenuItem>
              <SubMenu label="Move to" icon={<Icon name="team" />}>
                <MenuItem>Engineering</MenuItem>
                <MenuItem>Design</MenuItem>
              </SubMenu>
            </MenuGroup>
            <MenuGroup>
              <MenuItem icon={<Icon name="archive" />}>Archive</MenuItem>
              <MenuItem danger icon={<Icon name="trash" />}>
                Delete
              </MenuItem>
            </MenuGroup>
          </DropdownMenu>
        </Row>
        <Row label="Menu (static)">
          <div className="w-56 rounded-md border border-border bg-overlay shadow-overlay">
            <Menu aria-label="Static menu">
              <MenuGroup heading="Group heading">
                <MenuItem>Rest</MenuItem>
                <MenuItem disabled>Disabled</MenuItem>
                <MenuItem icon={<Icon name="link" />} shortcut={<Kbd keys={['G', 'I']} />}>
                  With shortcut
                </MenuItem>
              </MenuGroup>
              <MenuSeparator />
              <MenuItem danger>Danger</MenuItem>
            </Menu>
          </div>
        </Row>
      </Section>

      <Section title="Modal & confirm">
        <Row label="Triggers">
          <Button onClick={() => setModal(true)}>Open modal</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Open confirm dialog
          </Button>
        </Row>
        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title="Create issue"
          size="md"
          isDirty={dirty}
          onSubmit={() => setModal(false)}
          footer={
            <>
              <Button onClick={() => setModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setModal(false)}>
                Create issue
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <TextField label="Title" onChange={() => setDirty(true)} />
            <TextArea label="Description" />
          </div>
        </Modal>
        <ConfirmDialog
          open={confirm}
          onClose={() => setConfirm(false)}
          onConfirm={() => setConfirm(false)}
          title="Delete issue ENG-101?"
          description="This permanently removes the issue and its comments."
          confirmLabel="Delete issue"
        />
      </Section>

      <Section title="Flags">
        <Row label="Live">
          <ToastButtons />
        </Row>
        <Row label="Static">
          <div className="flex w-80 flex-col gap-2">
            {(['info', 'success', 'warning', 'error'] as const).map((s) => (
              <Flag
                key={s}
                flag={{ id: `static-${s}`, title: `${s[0]?.toUpperCase() ?? ''}${s.slice(1)} flag`, description: 'Operational detail.', severity: s, persistent: true, action: s === 'success' ? { label: 'View', onClick: () => undefined } : undefined }}
                onDismiss={() => undefined}
              />
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Tabs">
        <Tabs
          aria-label="Issue sections"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'comments', label: 'Comments', panel: <p className="text-base text-fg-subtle">No comments yet.</p> },
            { id: 'activity', label: 'Activity', panel: <p className="text-base text-fg-subtle">No activity yet.</p> },
            { id: 'github', label: 'GitHub', panel: <p className="text-base text-fg-subtle">No linked pull requests.</p> },
            { id: 'locked', label: 'Disabled', disabled: true },
          ]}
        />
      </Section>

      <Section title="Table">
        <Table<DemoRow>
          aria-label="Issues"
          rows={demoRows}
          rowKey={(r) => r.id}
          defaultSort={{ key: 'id', direction: 'asc' }}
          selectedKeys={selectedRows}
          onSelectionChange={setSelectedRows}
          columns={[
            { key: 'id', header: 'Key', sortable: true, sortValue: (r) => r.id, render: (r) => <span className="font-mono text-sm text-fg-subtle">{r.id}</span> },
            { key: 'title', header: 'Title', sortable: true, sortValue: (r) => r.title },
            { key: 'status', header: 'Status', render: (r) => <Lozenge appearance={r.status === 'Done' ? 'success' : r.status === 'Todo' ? 'default' : 'inprogress'}>{r.status}</Lozenge> },
            { key: 'estimate', header: 'Estimate', sortable: true, sortValue: (r) => r.estimate, align: 'right' },
          ]}
        />
        <Table<DemoRow>
          aria-label="Empty issues"
          rows={[]}
          rowKey={(r) => r.id}
          columns={[{ key: 'id', header: 'Key' }, { key: 'title', header: 'Title' }]}
          emptyState={<EmptyState message="No issues match this view." action={<Button variant="primary">Create issue</Button>} />}
        />
      </Section>

      <Section title="Pagination">
        <Pagination page={page} pageCount={12} onPageChange={setPage} />
        <Pagination page={1} pageCount={3} onPageChange={() => undefined} />
      </Section>

      <Section title="Side navigation">
        <div className="w-55 rounded-md bg-sunken p-2">
          <SideNav aria-label="Gallery navigation">
            <SideNavItem icon={<Icon name="inbox" />} trailing={<Badge value={4} />}>
              Inbox
            </SideNavItem>
            <SideNavItem icon={<Icon name="my-issues" />} selected>
              My issues
            </SideNavItem>
            <SideNavGroup title="Teams" collapsed={collapsed} onCollapsedChange={setCollapsed}>
              <SideNavItem icon={<Icon name="active" />}>Active</SideNavItem>
              <SideNavItem icon={<Icon name="backlog" />}>Backlog</SideNavItem>
            </SideNavGroup>
            <SideNavGroup title="Views" defaultCollapsed>
              <SideNavItem>Hidden item</SideNavItem>
            </SideNavGroup>
          </SideNav>
        </div>
      </Section>
    </>
  );
}

export function ComponentGallery() {
  const iconNames = Object.keys(iconMap) as IconName[];
  return (
    <FlagProvider>
      <div className="bg-surface p-6 text-base text-fg" data-testid="component-gallery">
        <h1 className="mb-2 text-xl font-semibold">Component gallery</h1>

        <Interactive />

        <Section title="Lozenge, StatusDot, Badge, Kbd">
          <Row label="Lozenge appearance">
            {appearances.map((a) => (
              <Lozenge key={a} appearance={a}>
                {a}
              </Lozenge>
            ))}
          </Row>
          <Row label="Lozenge color">
            {STATUS_COLORS.map((c) => (
              <Lozenge key={c} color={c}>
                {c}
              </Lozenge>
            ))}
          </Row>
          <Row label="StatusDot">
            {STATUS_COLORS.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 text-base">
                <StatusDot color={c} />
                {c}
              </span>
            ))}
          </Row>
          <Row label="Badge">
            <Badge value={3} />
            <Badge value={120} />
            <Badge value={7} appearance="primary" />
            <Badge value={9} appearance="danger" />
          </Row>
          <Row label="Kbd">
            <Kbd>C</Kbd>
            <Kbd keys={['G', 'B']} />
            <Kbd keys={['Ctrl', 'K']} />
          </Row>
        </Section>

        <Section title="Avatar">
          <Row label="sizes">
            {([16, 20, 24, 32] as const).map((s) => (
              <Avatar key={s} name="Ada Lovelace" size={s} />
            ))}
            <Avatar name="Grace Hopper" size={32} />
            <Avatar name="Alan Turing" size={32} />
            <Avatar name="Broken Image" src="/missing.png" size={32} />
          </Row>
        </Section>

        <Section title="Priority & status icons">
          <Row label="PriorityIcon">
            {priorities.map((p) => (
              <PriorityIcon key={p} priority={p} />
            ))}
            {priorities.map((p) => (
              <PriorityIcon key={`l-${p}`} priority={p} size={20} />
            ))}
          </Row>
          <Row label="StatusIcon">
            {categories.map((c) => (
              <StatusIcon key={c} category={c} />
            ))}
            {STATUS_COLORS.map((c) => (
              <StatusIcon key={c} category="in_progress" color={c} label={`In progress (${c})`} />
            ))}
          </Row>
        </Section>

        <Section title="Messages">
          {messageAppearances.map((a) => (
            <InlineMessage key={a} appearance={a} title={`${a} message`}>
              Operational detail text for the {a} appearance.
            </InlineMessage>
          ))}
          <Banner appearance="warning" title="Cycle ends in 2 days" action={<Button variant="link">View cycle</Button>} onDismiss={() => undefined}>
            12 issues are still open.
          </Banner>
          <Banner appearance="error">You are offline. Changes will sync when you reconnect.</Banner>
        </Section>

        <Section title="Tooltip">
          <Row label="hover or focus">
            <Tooltip content="Copy issue link">
              <Button>Hover me</Button>
            </Tooltip>
          </Row>
        </Section>

        <Section title="Loading">
          <Row label="Spinner">
            <Spinner />
            <Spinner size={20} />
            <Spinner size={24} />
          </Row>
          <Row label="Skeleton">
            <div className="w-80">
              <Skeleton rows={3} />
            </div>
            <Skeleton width={96} height={32} />
          </Row>
          <Row label="ProgressBar">
            <div className="w-80 flex flex-col gap-3">
              <ProgressBar value={0} label="Import progress" showPercent />
              <ProgressBar value={45} label="Import progress" showPercent />
              <ProgressBar value={100} label="Import progress" showPercent />
              <ProgressBar value={60} label="Page load" thin />
            </div>
          </Row>
        </Section>

        <Section title="Breadcrumbs">
          <Breadcrumbs items={[{ label: 'Settings', href: '#settings' }, { label: 'Workspace' }]} />
          <Breadcrumbs
            items={[
              { label: 'Settings', href: '#settings' },
              { label: 'Teams', href: '#teams' },
              { label: 'Engineering', href: '#eng' },
              { label: 'Workflow', href: '#workflow' },
              { label: 'Statuses' },
            ]}
          />
        </Section>

        <Section title="Empty state">
          <EmptyState icon="inbox" message="No notifications." action={<Button variant="primary">Create issue</Button>} />
        </Section>

        <Section title="Icons">
          <div className="grid grid-cols-6 gap-2">
            {iconNames.map((n) => (
              <div key={n} className="flex items-center gap-2 text-sm text-fg-subtle">
                <Icon name={n} size={20} className="text-fg" />
                <span className="font-mono">{n}</span>
              </div>
            ))}
          </div>
          <Row label="sizes">
            <Icon name="star-filled" size={16} />
            <Icon name="star-filled" size={20} />
            <Icon name="star-filled" size={24} />
          </Row>
        </Section>
      </div>
    </FlagProvider>
  );
}
