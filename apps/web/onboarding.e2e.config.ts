import { randomBytes } from 'node:crypto';
import type { E2EConfig } from 'e2e';
import baseConfig from './e2e.config.js';

const onboardingUrl = 'http://localhost:3280';
const onboardingPassword = `${randomBytes(32).toString('base64url')}a1!`;
const baseTarget = baseConfig.targets[0];

if (!baseTarget?.app?.command) {
  throw new Error('The onboarding target requires the shared local E2E server command.');
}

export default {
  ...baseConfig,
  projectId: 'velocity-fresh-onboarding',
  tests: 'agent-e2e/onboarding.e2e.ts',
  cache: { mode: 'read-write', dir: '.e2e/onboarding-cache' },
  agents: {
    ...baseConfig.agents,
    default: {
      ...baseConfig.agents?.default,
      context: 'Velocity is an issue tracker for software teams.',
    },
  },
  credentials: {
    ...baseConfig.credentials,
    'velocity-first-owner': {
      username: 'first-owner',
      password: () => onboardingPassword,
    },
  },
  targets: [{
    ...baseTarget,
    name: 'velocity-fresh-onboarding',
    app: {
      ...baseTarget.app,
      url: onboardingUrl,
      identity: 'velocity-fresh-onboarding',
      readyUrl: `${onboardingUrl}/healthz`,
      command: {
        ...baseTarget.app.command,
        env: {
          ...baseTarget.app.command.env,
          E2E_SLOT: '8',
          E2E_APP_URL: onboardingUrl,
          E2E_DATABASE_URL: 'postgres://velocity:velocity@localhost:54320/velocity_e2e_web_onboarding',
          E2E_ADMIN_DATABASE_URL: 'postgres://velocity:velocity@localhost:54320/postgres',
        },
      },
    },
  }],
} satisfies E2EConfig;
