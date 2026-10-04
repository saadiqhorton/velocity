import { useEffect, useState } from 'react';
import { ComponentGallery } from '@velocity/ui';
import { useTheme } from '@/stores/theme';
import { m } from '@/i18n';

const FLAG = 'vel.gallery';

/** Gallery is enabled in dev builds, or with `?enable=1` (persisted per browser) for visual tests. */
function galleryEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    if (new URLSearchParams(window.location.search).get('enable') === '1') window.localStorage.setItem(FLAG, '1');
    return window.localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

export function GalleryScreen() {
  const [enabled] = useState(galleryEnabled);
  const resolved = useTheme((s) => s.resolved);
  const setPref = useTheme((s) => s.setPref);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('theme');
    if (t === 'light' || t === 'dark') setPref(t);
  }, [setPref]);
  if (!enabled) return null;
  return (
    <div className="h-full overflow-y-auto bg-surface" data-theme-name={resolved}>
      <h1 className="sr-only">{m.dev.gallery}</h1>
      <ComponentGallery />
    </div>
  );
}
