import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSidebar } from '@/stores/sidebar';
import { Sidebar } from './Sidebar';

/** Below 768px the sidebar becomes a drawer (SPEC §4.10.2). */
export function MobileNav() {
  const open = useSidebar((s) => s.drawerOpen);
  const setOpen = useSidebar((s) => s.setDrawerOpen);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, setOpen]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 md:hidden" style={{ zIndex: 'var(--ds-z-index-modal)' }}>
      <div className="absolute inset-0 bg-blanket" aria-hidden="true" onClick={() => setOpen(false)} />
      <div
        className="relative h-full w-(--ds-layout-sidebar)"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        <Sidebar className="h-full w-full" />
      </div>
    </div>
  );
}
