import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { assertPublicUrl, isPrivateAddress, resolvePublicUrl, SsrfError } from '../../src/lib/ssrf';
import { postPinnedWebhook } from '../../src/webhooks';

describe('isPrivateAddress IPv4', () => {
  it.each([
    '0.0.0.0', '0.255.255.255', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.255.255.254',
    '169.254.169.254', '169.254.0.1', '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.0.255', '192.168.0.1', '192.168.255.255',
    '198.18.0.1', '198.19.255.255', '224.0.0.1', '239.255.255.255', '240.0.0.1', '254.254.254.254', '255.255.255.255',
  ])('%s is private', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each([
    '1.1.1.1', '8.8.8.8', '9.255.255.255', '11.0.0.1', '100.63.255.255', '100.128.0.1', '126.255.255.255', '128.0.0.1',
    '169.253.255.255', '169.255.0.1', '172.15.255.255', '172.32.0.1', '192.0.1.1', '192.0.2.1', '192.167.255.255', '192.169.0.1',
    '198.17.255.255', '198.20.0.1', '223.255.255.255', '93.184.216.34',
  ])('%s is public', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe('isPrivateAddress IPv6', () => {
  it.each([
    '::', '::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'fd12:3456::1', 'fdff:ffff::', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'ff02::1', 'ff00::',
    '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:192.168.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '[::1]',
    '64:ff9b::10.0.0.1', '64:ff9b::7f00:1', '64:ff9b::c0a8:1', '64:ff9b:1::1', '::127.0.0.1', '2002:7f00:1::', '2001:db8::1', 'fec0::1',
  ])('%s is private', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each([
    '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::8.8.8.8', '64:ff9b::808:808', '2002:808:808::', '2a00:1450:4001::1',
  ])('%s is public', (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe('isPrivateAddress invalid input fails closed', () => {
  it.each(['', 'localhost', 'example.com', '999.1.1.1', '1.2.3', '1.2.3.4.5', '01.02.03.04x', 'gggg::1', '1::2::3', 'http://1.1.1.1'])('%j', (s) =>
    expect(isPrivateAddress(s)).toBe(true),
  );
});

describe('assertPublicUrl', () => {
  const strict = { allowPrivate: false };
  const lookupTo = (...addrs: string[]) => vi.fn(async () => addrs);

  it('allows public literal IPs and hosts resolving publicly (no DNS for literals)', async () => {
    const lookup = lookupTo('1.1.1.1');
    await expect(assertPublicUrl('https://8.8.8.8/hook', { ...strict, lookup })).resolves.toBeUndefined();
    await expect(assertPublicUrl('https://[2606:4700:4700::1111]/x', { ...strict, lookup })).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
    await expect(assertPublicUrl('https://hooks.example.com/x?y=1', { ...strict, lookup })).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith('hooks.example.com');
    await expect(assertPublicUrl('http://hooks.example.com:8080/x', { ...strict, lookup })).resolves.toBeUndefined();
  });
  it.each([
    'http://127.0.0.1/', 'https://10.0.0.5:8443/x', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://127.1/', 'http://0/', 'http://localhost/', 'http://LOCALHOST:3000/',
    'http://foo.localhost/', 'http://localhost./',
  ])('blocks %s', async (u) => {
    const lookup = lookupTo('1.1.1.1');
    await expect(assertPublicUrl(u, { ...strict, lookup })).rejects.toMatchObject({ code: 'PRIVATE_ADDRESS' });
  });
  it('blocks hosts resolving to any private address (mixed answers)', async () => {
    await expect(assertPublicUrl('https://evil.example/x', { ...strict, lookup: lookupTo('1.1.1.1', '10.0.0.1') })).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl('https://evil.example/x', { ...strict, lookup: lookupTo('::1') })).rejects.toMatchObject({ code: 'PRIVATE_ADDRESS' });
    await expect(assertPublicUrl('https://evil.example/x', { ...strict, lookup: lookupTo('::ffff:10.0.0.1') })).rejects.toMatchObject({ code: 'PRIVATE_ADDRESS' });
  });
  it('reports DNS failures and empty answers', async () => {
    await expect(assertPublicUrl('https://nx.example/', { ...strict, lookup: async () => { throw new Error('ENOTFOUND'); } })).rejects.toMatchObject({ code: 'DNS_FAILURE' });
    await expect(assertPublicUrl('https://nx.example/', { ...strict, lookup: async () => [] })).rejects.toMatchObject({ code: 'DNS_FAILURE' });
  });
  it('rejects non-http(s) schemes', async () => {
    for (const u of ['ftp://example.com/', 'file:///etc/passwd', 'gopher://x/', 'javascript:alert(1)', 'data:text/plain,hi'])
      await expect(assertPublicUrl(u, { ...strict, lookup: lookupTo('1.1.1.1') })).rejects.toMatchObject({ code: expect.stringMatching(/UNSUPPORTED_PROTOCOL|INVALID_URL/) });
    await expect(assertPublicUrl('ftp://example.com/', { allowPrivate: true })).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL' });
  });
  it('rejects credentials and invalid URLs', async () => {
    const lookup = lookupTo('1.1.1.1');
    await expect(assertPublicUrl('https://user:pw@example.com/', { ...strict, lookup })).rejects.toMatchObject({ code: 'CREDENTIALS_IN_URL' });
    await expect(assertPublicUrl('https://user@example.com/', { ...strict, lookup })).rejects.toMatchObject({ code: 'CREDENTIALS_IN_URL' });
    await expect(assertPublicUrl('https://:pw@example.com/', { allowPrivate: true })).rejects.toMatchObject({ code: 'CREDENTIALS_IN_URL' });
    await expect(assertPublicUrl('not a url', { ...strict, lookup })).rejects.toMatchObject({ code: 'INVALID_URL' });
    await expect(assertPublicUrl('', { ...strict, lookup })).rejects.toMatchObject({ code: 'INVALID_URL' });
  });
  it('allowPrivate skips address checks but not scheme/credential checks and never does DNS', async () => {
    const lookup = lookupTo('10.0.0.1');
    await expect(assertPublicUrl('http://127.0.0.1:8080/hook', { allowPrivate: true, lookup })).resolves.toBeUndefined();
    await expect(assertPublicUrl('http://localhost/hook', { allowPrivate: true, lookup })).resolves.toBeUndefined();
    await expect(assertPublicUrl('https://internal.corp/hook', { allowPrivate: true, lookup })).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
  it('error is a typed Error', async () => {
    const e = await assertPublicUrl('http://127.0.0.1', strict).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SsrfError);
    expect(e).toBeInstanceOf(Error);
    expect((e as SsrfError).name).toBe('SsrfError');
  });
  it('default resolver handles literal IPs and localhost without network', async () => {
    await expect(assertPublicUrl('http://localhost:3000', strict)).rejects.toMatchObject({ code: 'PRIVATE_ADDRESS' });
    await expect(assertPublicUrl('http://127.0.0.1:3000', strict)).rejects.toMatchObject({ code: 'PRIVATE_ADDRESS' });
  });
});

it('pins a webhook connection to the address returned by validation', async () => {
  const receiver = createServer(async (req, res) => {
    expect(req.headers.host).toMatch(/^rebind\.example:/);
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    expect(body).toBe('{"ok":true}');
    res.writeHead(204);
    res.end();
  });
  await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
  const address = receiver.address();
  if (!address || typeof address === 'string') throw new Error('Receiver address missing');
  try {
    const target = `http://rebind.example:${address.port}/hook`;
    expect(await resolvePublicUrl(target, { allowPrivate: false, lookup: async () => ['8.8.8.8'] })).toBe('8.8.8.8');
    expect(await postPinnedWebhook(target, '127.0.0.1', { 'content-type': 'application/json' }, '{"ok":true}')).toBe(204);
  } finally {
    await new Promise<void>(resolve => receiver.close(() => resolve()));
  }
});
