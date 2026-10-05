# API guide

Velocity exposes a GraphQL API at `POST /graphql`. The same schema serves the application, API clients, MCP tools, and the importer. GraphQL introspection is enabled. The schema source is [`packages/graphql/schema.graphql`](../packages/graphql/schema.graphql).

## Authentication

Create a personal API key in the application settings. A key is shown when created; store it securely and revoke it if exposed. Keys act as their owner's user and have `read` or `write` scope.

Send the key as either header:

```http
Authorization: vel_your_api_key
```

or:

```http
X-Api-Key: vel_your_api_key
```

For browser sessions, the server sets an `httpOnly` `vel_session` cookie and a readable `vel_csrf` cookie. Every cookie-authenticated `POST` must include the matching `X-CSRF-Token` header. API-key requests do not use the CSRF cookie.

## Query example

The `issues` query accepts a filter DSL string, `teamId` or `teamKey`, grouping and ordering options, and `first`/`after` pagination. It returns a cursor connection. `totalCount` is calculated when selected, so omit it when a page alone is sufficient. An issue can be looked up by UUID or canonical identifier such as `ENG-123`.

```sh
curl https://velocity.example/graphql \
  -H 'content-type: application/json' \
  -H 'authorization: vel_your_api_key' \
  --data '{"query":"query { issues(teamKey: \"ENG\", filter: \"statusCategory:in_progress and priority lte:2\", first: 20) { nodes { id identifier title priority } pageInfo { hasNextPage endCursor } } }"}'
```

Filter expressions support comparisons, `and`, `or`, `not`, `in`, and ordering. For example:

```text
assignee:me and statusCategory:in_progress and priority lt:2 and not label:bug order:priority asc
```

The DSL parser is also available to JavaScript/TypeScript consumers from `@velocity/graphql/dsl`: `parseFilter`, `serializeFilter`, `toChips`, `fromChips`, and `FILTER_FIELD_SPECS`. Invalid expressions return a typed validation error with a position and caret.

## Mutations and errors

Use the schema for available queries, mutations, and subscriptions. Errors include an `extensions.code` such as `NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `CONFLICT`, `RATE_LIMITED`, or `UNAUTHENTICATED`. Mutations require a write-scoped API key or an authenticated session with permission for the operation.

Subscriptions use GraphQL over WebSocket at `/graphql` with the `graphql-ws` protocol. Available streams include `workspaceEvents`, `issueUpdated`, `issueCreated`, `notificationCreated`, and `importProgress`. For API-key connections, pass the key in `connectionParams`, for example `{ "authorization": "vel_…" }`. Cookie-authenticated sockets must use an origin matching `APP_URL`.

## Rate limits

Defaults are 1,000 requests per minute per API key and a 50-request-per-second burst. Authentication operations are limited to 10 requests per minute per client IP. Limits are per server process, so separate instances have separate buckets. Responses include `X-RateLimit-*` headers; rejected operations use `RATE_LIMITED` and provide retry timing.

Configure the general limits with `RATE_LIMIT_PER_MINUTE` and `RATE_LIMIT_BURST_PER_SECOND`. The authentication limit is fixed at 10/minute in the current server implementation.

## Webhooks

Workspace owners can register outbound webhooks for supported issue, comment, cycle, project, and import events. Each delivery is an HTTPS `POST` with JSON and these headers:

```text
X-Velocity-Event: issue.updated
X-Velocity-Delivery-Id: <delivery UUID>
X-Velocity-Signature: sha256=<lowercase hex HMAC-SHA256>
```

The signature is HMAC-SHA256 over the exact raw request body, using the webhook's secret. Verify before parsing or acting on the payload, and compare signatures in constant time. Example for Node.js:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyVelocityWebhook(rawBody, header, secret) {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
```

Deliveries time out after 10 seconds. Failed deliveries retry after 1, 5, 15, 30, and 60 minutes, then enter the dead-letter state. Owners can inspect and redeliver them in settings. Private-network webhook targets are blocked unless `ALLOW_PRIVATE_WEBHOOK_TARGETS=1` is deliberately enabled.

## Other endpoints

- `GET /files/:id`: attachment download with an authenticated session/API key or a time-limited signed URL.
- `GET /avatars/:id`: member-authenticated avatar image. Upload or replace your profile image with the `uploadAvatar(file: File!)` GraphQL mutation. PNG, JPEG, GIF, and WebP inputs are decoded and re-encoded as metadata-free WebP, cropped to at most 256×256 pixels. The upload size is capped by `MAX_UPLOAD_MB` (25 MB by default).
- `GET /api/exports/:id/download`: authenticated export download.
- `POST /mcp`: optional Streamable HTTP MCP transport; disabled by default and protected by `MCP_HTTP_TOKEN` when enabled.
