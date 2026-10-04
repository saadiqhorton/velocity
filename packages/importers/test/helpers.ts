import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const fixturePath = (n: string): string => join(dir, n);
export const fixtureText = (n: string): string => readFileSync(fixturePath(n), 'utf8');
export const fixtureJson = <T = unknown>(n: string): T => JSON.parse(fixtureText(n)) as T;

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}
