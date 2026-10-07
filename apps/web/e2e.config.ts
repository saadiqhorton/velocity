import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { chatgpt } from 'e2e/oauth/chatgpt';

const slot = /^[1-9]$/.test(process.env.E2E_SLOT ?? '') ? process.env.E2E_SLOT! : '9';
const appUrl = process.env.E2E_APP_URL ?? `http://localhost:32${slot}0`;
const commandEnv = {
  E2E_SLOT: slot,
  E2E_APP_URL: appUrl,
  ...(process.env.E2E_DATABASE_URL ? { E2E_DATABASE_URL: process.env.E2E_DATABASE_URL } : {}),
  ...(process.env.E2E_ADMIN_DATABASE_URL ? { E2E_ADMIN_DATABASE_URL: process.env.E2E_ADMIN_DATABASE_URL } : {}),
};

export default {
  tests: 'agent-e2e/**/*.e2e.ts',
  workers: 1,
  assertionTimeout: 10_000,
  timeout: 180_000,
  reporters: ['list', 'markdown'],
  agents: {
    default: {
      model: chatgpt(process.env.AGENT_E2E_MODEL ?? 'gpt-6-luna'),
      system: 'Act like a user who understands their goal but has no knowledge of Velocity selectors, shortcuts, or implementation details.',
      context: 'Velocity is an issue tracker. The Engineering team has key ENG. Issue priority and workflow status are separate properties.',
    },
  },
  credentials: {
    'velocity-owner': {
      username: process.env.E2E_USER_VELOCITY_OWNER_USERNAME ?? 'agent-e2e-owner',
      password: () => process.env.E2E_USER_VELOCITY_OWNER_PASSWORD ?? '',
    },
  },
  targets: [{
    name: 'velocity-web',
    engine: web(),
    app: {
      url: appUrl,
      readyUrl: `${appUrl}/healthz`,
      command: {
        executable: 'node',
        args: ['e2e/support/server.mjs'],
        env: commandEnv,
        startupTimeout: 120_000,
        shutdownTimeout: 15_000,
        log: '.e2e/logs/app.log',
      },
    },
  }],
} satisfies E2EConfig;
