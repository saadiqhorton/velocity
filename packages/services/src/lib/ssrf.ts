/** SSRF private-address blocklist (SPEC §6.4). Unparseable addresses are treated as private (fail closed). */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function parseV4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function isPrivateV4(o: number[]): boolean {
  const [a, b, c, d] = o as [number, number, number, number];
  if (a === 0) return true; // 0/8
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15
  if (a >= 224) return true; // multicast, reserved, broadcast
  void d;
  return false;
}

/** Parse an IPv6 literal into eight 16-bit groups, or null. */
function parseV6(input: string): number[] | null {
  let ip = input;
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  if (isIP(ip) !== 6) return null;
  let tail: number[] = [];
  const lastColon = ip.lastIndexOf(':');
  const lastPart = ip.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    const v4 = parseV4(lastPart);
    if (!v4) return null;
    tail = [((v4[0] as number) << 8) | (v4[1] as number), ((v4[2] as number) << 8) | (v4[3] as number)];
    ip = ip.slice(0, lastColon + 1) + '0:0';
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s === '' ? [] : s.split(':').map((g) => parseInt(g, 16)));
  let groups: number[];
  if (halves.length === 2) {
    const head = toGroups(halves[0] as string);
    const rest = toGroups(halves[1] as string);
    const fill = 8 - head.length - rest.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<number>(fill).fill(0), ...rest];
  } else {
    groups = toGroups(ip);
  }
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  if (tail.length === 2) {
    groups[6] = tail[0] as number;
    groups[7] = tail[1] as number;
  }
  return groups;
}

function v4FromGroups(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}

function isPrivateV6(g: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const firstFiveZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (firstFiveZero && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: and ::1
  if (firstFiveZero && g5 === 0xffff) return isPrivateV4(v4FromGroups(g6, g7)); // ::ffff:a.b.c.d
  if (firstFiveZero && g5 === 0) return true; // deprecated IPv4-compatible ::a.b.c.d (and ::/96 generally)
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isPrivateV4(v4FromGroups(g6, g7)); // 64:ff9b::/96
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true; // 64:ff9b:1::/48 local-use NAT64
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8
  if (g0 === 0x2002) return isPrivateV4(v4FromGroups(g1, g2)); // 6to4 embedding
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard-only 100::/64
  return false;
}

/** True when `ip` is in a private/reserved range or cannot be parsed as an IP. */
export function isPrivateAddress(ip: string): boolean {
  const s = ip.trim().replace(/^\[|\]$/g, '');
  const kind = isIP(s.includes('%') ? s.slice(0, s.indexOf('%')) : s);
  if (kind === 4) {
    const o = parseV4(s);
    return o === null ? true : isPrivateV4(o);
  }
  if (kind === 6) {
    const g = parseV6(s);
    return g === null ? true : isPrivateV6(g);
  }
  return true;
}

export type SsrfErrorCode = 'INVALID_URL' | 'UNSUPPORTED_PROTOCOL' | 'CREDENTIALS_IN_URL' | 'PRIVATE_ADDRESS' | 'DNS_FAILURE';

export class SsrfError extends Error {
  constructor(
    readonly code: SsrfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SsrfError';
  }
}

export interface AssertPublicUrlOptions {
  allowPrivate: boolean;
  lookup?: (host: string) => Promise<string[]>;
}

async function defaultLookup(host: string): Promise<string[]> {
  const res = await dnsLookup(host, { all: true });
  return res.map((r) => r.address);
}

/**
 * Throws `SsrfError` unless `url` is an http(s) URL without credentials whose host
 * (literal or resolved) is public. `allowPrivate` skips only the address checks.
 * Callers that connect afterwards must pin to the returned address to avoid DNS rebinding.
 */
export async function resolvePublicUrl(url: string, opts: AssertPublicUrlOptions): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new SsrfError('INVALID_URL', 'The URL is not valid.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new SsrfError('UNSUPPORTED_PROTOCOL', 'Only http and https URLs are allowed.');
  if (u.username !== '' || u.password !== '') throw new SsrfError('CREDENTIALS_IN_URL', 'URLs must not contain credentials.');
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === '') throw new SsrfError('INVALID_URL', 'The URL has no host.');
  if (opts.allowPrivate) return null;
  if (isIP(host) !== 0) {
    if (isPrivateAddress(host)) throw new SsrfError('PRIVATE_ADDRESS', 'The URL points to a private address.');
    return host;
  }
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) throw new SsrfError('PRIVATE_ADDRESS', 'The URL points to a private address.');
  let addrs: string[];
  try {
    addrs = await (opts.lookup ?? defaultLookup)(host);
  } catch {
    throw new SsrfError('DNS_FAILURE', `Could not resolve ${host}.`);
  }
  if (addrs.length === 0) throw new SsrfError('DNS_FAILURE', `Could not resolve ${host}.`);
  if (addrs.some(isPrivateAddress)) throw new SsrfError('PRIVATE_ADDRESS', 'The URL resolves to a private address.');
  return addrs[0] as string;
}

export async function assertPublicUrl(url: string, opts: AssertPublicUrlOptions): Promise<void> {
  await resolvePublicUrl(url, opts);
}
