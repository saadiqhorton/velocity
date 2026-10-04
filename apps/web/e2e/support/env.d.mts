export const WEB_DIR: string;
export const REPO_DIR: string;
export const SERVER_DIR: string;
export interface E2eEnv {
  inCi: boolean;
  appUrl: string;
  port: number;
  databaseUrl: string;
  adminUrl: string;
  dataDir: string;
  authFile: string;
  outputDir: string;
  appSecret: string;
}
export function resolveEnv(): E2eEnv;
export function serverEnv(cfg?: E2eEnv): NodeJS.ProcessEnv;
