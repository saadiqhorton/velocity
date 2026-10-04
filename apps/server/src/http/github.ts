import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import type { Services } from '@velocity/services';
import { readBody, sendJson } from './util';

/** GitHub App webhook receiver (SPEC §6.5): verify, dedupe, enqueue — never process inline. */
export async function handleGithubWebhook(services: Services, logger: Logger, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  let raw: Buffer;
  try {
    raw = await readBody(req, 25 * 1024 * 1024);
  } catch {
    return sendJson(res, 413, { error: 'Payload too large' });
  }
  const deliveryId = String(req.headers['x-github-delivery'] ?? '');
  const event = String(req.headers['x-github-event'] ?? '');
  if (!deliveryId || !event) return sendJson(res, 400, { error: 'Missing GitHub delivery headers' });
  try {
    const receipt = await services.github.receiveWebhook({
      deliveryId,
      event,
      signature: (req.headers['x-hub-signature-256'] as string | undefined) ?? null,
      rawBody: raw.toString('utf8'),
    });
    sendJson(res, 202, receipt);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'UNAUTHENTICATED') return sendJson(res, 401, { error: 'Invalid signature' });
    if (code === 'VALIDATION') return sendJson(res, 400, { error: (err as Error).message });
    logger.error({ err }, 'github webhook failed');
    sendJson(res, 500, { error: 'Internal error' });
  }
}

/** Post-install redirect from GitHub: hand off to the SPA, which completes the install with the owner's session. */
export function handleGithubSetup(res: ServerResponse, url: URL): void {
  const installationId = url.searchParams.get('installation_id');
  const target = installationId && /^\d+$/.test(installationId) ? `/settings/integrations/github?installation_id=${installationId}` : '/settings/integrations/github';
  res.writeHead(302, { location: target, 'cache-control': 'no-store' });
  res.end();
}
