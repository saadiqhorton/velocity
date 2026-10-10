#!/usr/bin/env node
// Design verification screenshots.
// Usage: node scripts/screenshots.mjs [baseUrl] [--only=name,name] [--sizes=1440x900,1024x768] [--themes=dark,light]
//        node scripts/screenshots.mjs --pages="settings-labels:/settings/labels,project:/project/<id>" [--out=dir] [--wait=selector]
//   --pages captures only the given name:path pairs (signed in), skipping the built-in flows.
// Requires a running app (Vite dev on :5173 or the API serving dist) and the demo seed.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173';
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? def : hit.slice(name.length + 3);
};
const only = opt('only', '').split(',').filter(Boolean);
const sizes = opt('sizes', '1440x900,1024x768').split(',').map((s) => s.split('x').map(Number));
const themes = opt('themes', 'dark,light').split(',');
const login = opt('login', 'demo');
const password = opt('password', 'correct-horse-battery-staple');
const team = opt('team', 'ENG');
const outDir = opt('out', '') ? `${opt('out', '').replace(/\/$/, '')}/` : fileURLToPath(new URL('../screenshots/', import.meta.url));
const pages = opt('pages', '')
  .split(',')
  .filter(Boolean)
  .map((pair) => {
    const i = pair.indexOf(':');
    return [pair.slice(0, i), pair.slice(i + 1)];
  });
const waitFor = opt('wait', '[data-testid="view-header"]');
const fullPage = args.includes('--full');
mkdirSync(outDir, { recursive: true });

const want = (name) => only.length === 0 || only.includes(name);
const errors = [];

const browser = await chromium.launch();
for (const theme of themes) {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`[${theme} ${width}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => errors.push(`[${theme} ${width}] pageerror ${err.message}`));
    const shot = async (name) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${outDir}${theme}-${width}-${name}.png` });
      console.log(`shot ${theme}-${width}-${name}`);
    };

    if (want('login') && pages.length === 0) {
      await page.goto(`${base}/login`);
      await page.waitForSelector('input[name="login"]');
      await shot('login');
    }
    // Sign in through the API (cookies land in the context).
    const res = await page.request.post(`${base}/graphql`, {
      headers: { 'content-type': 'application/json', origin: base },
      data: { query: 'mutation($i: LoginInput!) { login(input: $i) { csrfToken } }', variables: { i: { login, password } } },
    });
    if (!res.ok()) throw new Error(`login failed ${res.status()}`);

    if (pages.length > 0) {
      for (const [name, path] of pages) {
        await page.goto(`${base}${path}`);
        await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => console.log(`  (no ${waitFor} on ${path})`));
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${outDir}${theme}-${width}-${name}.png`, fullPage });
        console.log(`shot ${outDir}${theme}-${width}-${name}.png`);
      }
      await context.close();
      continue;
    }

    await page.goto(`${base}/team/${team}/active`);
    await page.waitForSelector('[data-testid="issue-row"]', { timeout: 15000 });
    if (want('list')) await shot('list');

    if (want('panel')) {
      await page.keyboard.press('j');
      await page.keyboard.press('j');
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-testid="issue-detail"]', { timeout: 10000 });
      await page.waitForTimeout(600);
      await shot('panel');
      await page.keyboard.press('Escape');
    }
    if (want('palette')) {
      await page.keyboard.press('Control+k');
      await page.waitForSelector('[data-testid="command-palette"]');
      await shot('palette');
      await page.keyboard.press('Escape');
    }
    if (want('create')) {
      await page.keyboard.press('c');
      await page.waitForSelector('[data-testid="create-issue-modal"]');
      await page.waitForTimeout(400);
      await shot('create');
      await page.keyboard.press('Escape');
    }
    if (want('picker')) {
      await page.keyboard.press('j');
      await page.keyboard.press('s');
      await page.waitForSelector('[role="listbox"]');
      await shot('picker');
      await page.keyboard.press('Escape');
    }
    if (want('selection')) {
      await page.keyboard.press('x');
      await page.keyboard.press('j');
      await page.keyboard.press('x');
      await page.waitForSelector('[data-testid="selection-bar"]');
      console.log('listboxes during selection:', await page.locator('[role="listbox"]').count());
      await shot('selection');
      await page.keyboard.press('Escape');
    }
    if (want('board')) {
      await page.keyboard.press('b');
      await page.waitForSelector('[data-testid="board-card"]', { timeout: 10000 });
      await shot('board');
      await page.keyboard.press('b');
    }
    if (want('backlog')) {
      await page.goto(`${base}/team/${team}/backlog`);
      await page.waitForSelector('[data-testid="issue-row"]', { timeout: 10000 });
      await shot('backlog');
    }
    if (want('issue-page')) {
      await page.goto(`${base}/issue/${team}-1`);
      await page.waitForSelector('[data-testid="issue-detail"]', { timeout: 10000 });
      await page.waitForTimeout(600);
      await shot('issue-page');
    }
    for (const [name, path, selector] of [
      ['my-issues', '/my-issues', '[data-testid="view-header"]'],
      ['inbox', '/inbox', '[data-testid="view-header"]'],
      ['projects', '/projects', '[data-testid="view-header"]'],
      ['cycles', `/team/${team}/cycles`, '[data-testid="view-header"]'],
      ['insights', '/insights', '[data-testid="view-header"]'],
      ['views', '/views', '[data-testid="view-header"]'],
      ['search', '/search?q=cache', '[data-testid="view-header"]'],
      ['settings', '/settings', 'main'],
      ['settings-teams', '/settings/teams', 'main'],
      ['gallery', '/__gallery?enable=1', '[data-testid="component-gallery"]'],
    ]) {
      if (!want(name)) continue;
      await page.goto(`${base}${path}`);
      await page.waitForSelector(selector, { timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      if (name === 'gallery') await page.screenshot({ path: `${outDir}${theme}-${width}-${name}.png`, fullPage: true });
      else await shot(name);
    }
    await context.close();
  }
}
await browser.close();
if (errors.length) {
  console.log(`\nconsole errors (${errors.length}):`);
  for (const e of [...new Set(errors)].slice(0, 40)) console.log(`  ${e}`);
}
