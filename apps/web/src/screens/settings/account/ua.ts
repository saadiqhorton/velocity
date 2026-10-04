import { m } from '@/i18n';

/** Summarize a user-agent string as "Chrome on Linux". Order matters: Edge/Opera spoof Chrome, Chrome spoofs Safari. */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return m.settingsAccount.sessions.unknownDevice;
  const browsers: Array<[RegExp, string]> = [
    [/Edg(?:e|A|iOS)?\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/Firefox\/|FxiOS/, 'Firefox'],
    [/Chrome\/|CriOS/, 'Chrome'],
    [/Safari\//, 'Safari'],
    [/curl\//i, 'curl'],
    [/node|undici/i, 'Node.js'],
  ];
  const systems: Array<[RegExp, string]> = [
    [/Android/, 'Android'],
    [/iPhone|iPad|iPod/, 'iOS'],
    [/Windows/, 'Windows'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/CrOS/, 'ChromeOS'],
    [/Linux|X11/, 'Linux'],
  ];
  const browser = browsers.find(([re]) => re.test(ua))?.[1];
  const os = systems.find(([re]) => re.test(ua))?.[1];
  if (browser && os) return m.settingsAccount.sessions.browserOn(browser, os);
  return browser ?? os ?? ua.slice(0, 40);
}
