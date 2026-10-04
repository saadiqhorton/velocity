import client from 'prom-client';

/** Prometheus metrics (SPEC §7.4). */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'velocity_' });

export const httpDuration = new client.Histogram({
  name: 'velocity_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const graphqlDuration = new client.Histogram({
  name: 'velocity_graphql_operation_duration_seconds',
  help: 'GraphQL operation duration by root field',
  labelNames: ['type', 'field'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const wsConnections = new client.Gauge({ name: 'velocity_ws_connections', help: 'Open GraphQL WebSocket connections', registers: [registry] });
export const outboxLag = new client.Gauge({ name: 'velocity_outbox_lag_seconds', help: 'Age of the oldest unpublished outbox event', registers: [registry] });
export const queueDepth = new client.Gauge({ name: 'velocity_queue_depth', help: 'Queued jobs per queue', labelNames: ['queue'] as const, registers: [registry] });
export const jobFailures = new client.Counter({ name: 'velocity_job_failures_total', help: 'Failed jobs', labelNames: ['queue'] as const, registers: [registry] });
export const rateLimited = new client.Counter({ name: 'velocity_rate_limited_total', help: 'Rejected requests', labelNames: ['kind'] as const, registers: [registry] });
