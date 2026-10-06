/**
 * Clipboard writes that may wait for data (a prompt built from a query). Safari only
 * allows a write inside the user gesture, so a pending text goes in as a promised
 * ClipboardItem; other browsers fall back to writeText once the text is ready.
 */
export async function copyText(text: string | Promise<string>): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard) return false;
  if (typeof text !== 'string' && typeof ClipboardItem !== 'undefined' && typeof clipboard.write === 'function') {
    try {
      const blob = text.then((t) => new Blob([t], { type: 'text/plain' }));
      await clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return true;
    } catch {
      // Older engines reject promised items: retry with plain text below.
    }
  }
  try {
    await clipboard.writeText(await text);
    return true;
  } catch {
    return false;
  }
}
