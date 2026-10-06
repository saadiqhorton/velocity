import { useRef } from 'react';
import type { Reference } from '@apollo/client';
import { Button, Icon, IconButton } from '@velocity/ui';
import { DeleteAttachmentDocument, UploadAttachmentDocument } from '@/gql/graphql';
import { useOptimisticMutation } from '@/lib/mutation';
import { formatBytes, formatRelative } from '@/lib/format';
import type { DetailIssue } from './IssueDetail';
import { m } from '@/i18n';

/** Files on the issue (issue page main column, U1): open, upload, delete. */
export function Attachments({ issue }: { issue: DetailIssue }) {
  const input = useRef<HTMLInputElement>(null);
  const [upload, { loading }] = useOptimisticMutation(UploadAttachmentDocument, {
    optimistic: { serverConfirmed: 'The stored file id, size and signed URL come from the server.' },
    rollback: () => m.issuePage.uploadFailed,
    update: (cache, result) => {
      const a = result.data?.uploadAttachment;
      if (!a) return;
      cache.modify({
        id: cache.identify({ __typename: 'Issue' as const, id: issue.id }),
        fields: {
          attachments: (value, { toReference }) => {
            const existing = (value ?? []) as readonly Reference[];
            const ref = toReference(a);
            return ref && !existing.some((e) => e.__ref === ref.__ref) ? [...existing, ref] : existing;
          },
        },
      });
    },
  });
  const [remove] = useOptimisticMutation(DeleteAttachmentDocument, {
    optimistic: () => ({ __typename: 'Mutation' as const, deleteAttachment: true }),
    rollback: () => m.issuePage.attachmentDeleteFailed,
    update: (cache, _res, vars) => {
      cache.modify({
        id: cache.identify({ __typename: 'Issue' as const, id: issue.id }),
        fields: {
          attachments: (existing: readonly Reference[] = [], { readField }) => existing.filter((r) => readField('id', r) !== vars.id),
        },
      });
    },
  });

  return (
    <div className="flex flex-col" data-testid="attachments">
      {issue.attachments.length === 0 ? <p className="px-1 text-base text-fg-subtlest">{m.issuePage.noAttachments}</p> : null}
      {issue.attachments.map((a) => (
        <div key={a.id} className="group/att flex h-8 items-center gap-2 rounded-sm px-1 hover:bg-hover">
          <Icon name="paperclip" className="shrink-0 text-fg-subtlest" />
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-base text-fg hover:underline">
            {a.filename}
          </a>
          <span className="shrink-0 text-sm text-fg-subtlest">
            {formatBytes(a.size)} · {formatRelative(a.createdAt)}
          </span>
          <span className="flex-1" />
          <IconButton
            label={m.issuePage.deleteAttachment(a.filename)}
            size="sm"
            icon={<Icon name="close" />}
            className="opacity-0 group-hover/att:opacity-100 focus:opacity-100"
            onClick={() => void remove({ id: a.id })}
          />
        </div>
      ))}
      <div>
        <input
          ref={input}
          type="file"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload({ file, issueId: issue.id });
          }}
        />
        <Button size="sm" variant="subtle" iconBefore={<Icon name="paperclip" />} disabled={loading} onClick={() => input.current?.click()}>
          {m.issue.attach}
        </Button>
      </div>
    </div>
  );
}
