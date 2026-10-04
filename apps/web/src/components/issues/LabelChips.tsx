import type { PaletteColor } from '@/gql/graphql';
import { ColorDot } from '@/components/common/EntityIcons';

/** Condensed label lozenges for dense rows (SPEC §4.10.2): dot + name, then "+N". */
export function LabelChips({ labels, max = 2 }: { labels: readonly { id: string; name: string; color: PaletteColor }[]; max?: number }) {
  const shown = labels.slice(0, max);
  const rest = labels.length - shown.length;
  return (
    <span className="hidden items-center gap-1 md:flex">
      {shown.map((l) => (
        <span
          key={l.id}
          className="inline-flex h-5 max-w-28 items-center gap-1 rounded-sm border border-border px-1.5 text-sm text-fg-subtle"
        >
          <ColorDot color={l.color} size={6} />
          <span className="truncate">{l.name}</span>
        </span>
      ))}
      {rest > 0 ? (
        <span className="inline-flex h-5 items-center rounded-sm border border-border px-1.5 text-sm text-fg-subtle" title={labels.slice(max).map((l) => l.name).join(', ')}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
