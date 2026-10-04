import { Lozenge } from '@velocity/ui';
import { m } from '@/i18n';

export function RunStatus({ status }: { status: string }) {
  const t = m.settingsIntegrations.import.status;
  const color = status === 'completed' ? 'green' : status === 'failed' ? 'red' : status === 'committing' ? 'blue' : status === 'canceled' ? 'grey' : status === 'ready' ? 'purple' : 'yellow';
  const label = status in t ? t[status as keyof typeof t] : status;
  return <Lozenge color={color}>{label}</Lozenge>;
}

export function sourceLabel(source: string): string {
  const t = m.settingsIntegrations.import.sources;
  return source in t ? t[source as keyof typeof t] : source;
}
