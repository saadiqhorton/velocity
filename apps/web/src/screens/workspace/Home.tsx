import { Navigate } from 'react-router-dom';
import { useWorkspace } from '@/app/workspace';

/** Default landing: the first team's Active screen (SPEC §4.11.1). */
export function Home() {
  const { teams } = useWorkspace();
  const first = teams[0];
  return <Navigate to={first ? `/team/${first.key}/active` : '/my-issues'} replace />;
}
