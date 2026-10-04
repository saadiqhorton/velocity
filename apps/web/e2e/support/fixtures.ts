import { test as base, expect } from '@playwright/test';
import { resolveEnv } from './env.mjs';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';

const AUTH = resolveEnv().authFile;

interface Guard {
  csp: string[];
  pageErrors: string[];
  consoleErrors: string[];
  /** Set once the test body is over: Playwright's own teardown work (WebKit screenshotter) must not count. */
  closed?: boolean;
  /** Browser noise that is tolerated but still attached to the report (see `isNavigationCancel`). */
  tolerated: string[];
}

const CSP_TEXT = /content security policy|violates the following|refused to (apply|execute|load)/i;

/**
 * WebKit logs "Fetch API cannot load <url> due to access control checks." as a JavaScript-source
 * console error whenever a navigation (reload, goto) cancels an in-flight fetch, even when the app
 * handles the rejection (it does: `runInBackground`). Playwright reports every such console error
 * as a page error on WebKit. Only that message, for a same-origin URL, within a few seconds of a
 * main-frame navigation, is tolerated; anything else still fails the test.
 */
const NAV_CANCEL = /Fetch API cannot load (.+) due to access control checks\.?$/;
const NAV_CANCEL_WINDOW_MS = 3000;

function isNavigationCancel(page: Page, text: string, lastNavigation: number): boolean {
  const url = NAV_CANCEL.exec(text)?.[1]?.replace(/^(https?): \/+/, '$1://');
  if (!url || Date.now() - lastNavigation > NAV_CANCEL_WINDOW_MS) return false;
  try {
    return new URL(url).origin === new URL(page.url() || url).origin;
  } catch {
    return false;
  }
}

/** Hooks a page (and its console) into the guard; CSP violations and uncaught errors fail the test. */
function watch(page: Page, guard: Guard): void {
  let lastNavigation = 0;
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) lastNavigation = Date.now();
  });
  page.on('pageerror', (e) => {
    if (guard.closed) return;
    const text = `${e.name}: ${e.message}`;
    if (isNavigationCancel(page, text, lastNavigation)) guard.tolerated.push(text);
    else guard.pageErrors.push(text);
  });
  page.on('console', (msg) => {
    if (guard.closed || msg.type() !== 'error') return;
    const text = msg.text();
    guard.consoleErrors.push(text);
    if (CSP_TEXT.test(text)) guard.csp.push(text);
  });
}

async function instrument(context: BrowserContext, guard: Guard): Promise<void> {
  await context.exposeBinding('__velCsp', (_s, detail: string) => {
    if (!guard.closed) guard.csp.push(detail);
  });
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // Every violation during the test body is recorded. The guard freezes (`guard.closed`) once the
      // test's context fixture tears down: Playwright's `screenshot: 'only-on-failure'` then takes a
      // temporary pre-close screenshot of every page, and on WebKit its screenshotter injects an inline
      // `<style>body {}</style>` (playwright-core `inPagePrepareForScreenshots`) that the app CSP blocks.
      // That is harness work, not app CSS, so it must not fail a test.
      const w = window as unknown as { __velCsp?: (d: string) => void };
      w.__velCsp?.(`${e.violatedDirective} blocked ${e.blockedURI || 'inline'} (${e.sourceFile ?? ''}:${e.lineNumber ?? 0})`);
    });
  });
  context.on('page', (p) => watch(p, guard));
}

export interface Fixtures {
  guard: Guard;
  /** A fresh signed-in context (own cookies/cache) that is watched by the same guard. */
  newSession: (opts?: { storageState?: string | undefined; viewport?: { width: number; height: number }; colorScheme?: 'dark' | 'light' }) => Promise<{ context: BrowserContext; page: Page }>;
}

export const test = base.extend<Fixtures>({
  guard: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their (empty) dependencies.
    async ({}, use, testInfo) => {
      const guard: Guard = { csp: [], pageErrors: [], consoleErrors: [], tolerated: [] };
      await use(guard);
      if (guard.consoleErrors.length > 0) {
        await testInfo.attach('console-errors', { body: guard.consoleErrors.join('\n'), contentType: 'text/plain' });
      }
      if (guard.tolerated.length > 0) {
        await testInfo.attach('tolerated-page-errors', { body: guard.tolerated.join('\n'), contentType: 'text/plain' });
      }
      expect.soft(guard.csp, 'CSP violations').toEqual([]);
      expect.soft(guard.pageErrors, 'uncaught page errors').toEqual([]);
    },
    { auto: true },
  ],
  context: async ({ context, guard }, use) => {
    await instrument(context, guard);
    await use(context);
    guard.closed = true; // runs before the base context fixture closes the context (and screenshots it)
  },
  newSession: async ({ browser, guard }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (opts = {}) => {
      const context = await (browser as Browser).newContext({
        storageState: opts.storageState ?? AUTH,
        viewport: opts.viewport ?? { width: 1440, height: 900 },
        colorScheme: opts.colorScheme ?? 'dark',
        locale: 'en-US',
        timezoneId: 'UTC',
      });
      contexts.push(context);
      await instrument(context, guard);
      return { context, page: await context.newPage() };
    });
    guard.closed = true;
    for (const c of contexts) await c.close();
  },
});

export { expect };

/** Calls the API as the page's signed-in user (session cookie + CSRF header), for test setup/cleanup. */
export async function graphqlAs(page: Page, query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'vel_csrf')?.value ?? '';
  const res = await page.request.post('/graphql', { data: { query, variables }, headers: { 'x-csrf-token': csrf } });
  const body = (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  expect(body.errors, `GraphQL errors for ${query}`).toBeUndefined();
  return body.data ?? {};
}

/** Unique, human-readable title so specs never collide with each other's issues. */
export function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Opens a team list and waits until rows are interactive. */
export async function gotoTeam(page: Page, key: string, view: 'active' | 'backlog' | 'all' = 'active'): Promise<void> {
  await page.goto(`/team/${key}/${view}`);
  await expect(page.getByTestId('view-header')).toBeVisible();
  await expect(page.getByTestId('issue-row').first()).toBeVisible();
}

export function rowByTitle(page: Page, title: string): Locator {
  return page.getByTestId('issue-row').filter({ hasText: title });
}

/** Creates an issue with the `C` shortcut and returns once its row is visible. */
export async function createIssueViaKeyboard(page: Page, title: string): Promise<Locator> {
  await page.keyboard.press('c');
  const modal = page.getByTestId('create-issue-modal');
  await expect(modal).toBeVisible();
  await page.getByTestId('create-issue-title').fill(title);
  await page.getByTestId('create-issue-submit').click();
  await expect(modal).toBeHidden();
  const row = rowByTitle(page, title);
  await expect(row).toBeVisible();
  return row;
}

/** Types into the open searchable popup (S/P/A/L/M pickers) and confirms the first match with Enter. */
export async function pickFromPopup(page: Page, label: string, query: string, opts: { keepOpen?: boolean } = {}): Promise<void> {
  const box = page.getByRole('combobox', { name: label });
  await expect(box).toBeFocused();
  await box.fill(query);
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');
  if (!opts.keepOpen) await expect(box).toBeHidden();
}

/** Accessible name of the focused element's `aria-label` (rows expose "ENG-12 Title"). */
export async function focusedLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
}

export async function hasPrimaryIndicator(row: Locator): Promise<boolean> {
  return row.evaluate((el) => {
    const c = getComputedStyle(el, '::before').backgroundColor;
    return c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent';
  });
}
