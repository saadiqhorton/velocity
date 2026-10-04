/** The `vel_csrf` cookie is readable by design; echo it as X-CSRF-Token (SPEC §7.1.2). */
export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = /(?:^|;\s*)vel_csrf=([^;]+)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
