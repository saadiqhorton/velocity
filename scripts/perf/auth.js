/* global __ENV, __VU */
import http from 'k6/http';
import { fail } from 'k6';

export const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
export const vus = Number(__ENV.VUS || 25);
export const duration = __ENV.DURATION || '3m';
export const keys = (__ENV.API_KEYS || __ENV.API_KEY || '').split(',').map((v) => v.trim()).filter(Boolean);

export function loginSession() {
  if (!__ENV.LOGIN || !__ENV.PASSWORD) {
    fail('Set API_KEY/API_KEYS or both LOGIN and PASSWORD.');
  }
  const query = 'mutation PerfLogin($input: LoginInput!) { login(input: $input) { csrfToken } }';
  const response = http.post(`${baseUrl}/graphql`, JSON.stringify({
    query,
    variables: { input: { login: __ENV.LOGIN, password: __ENV.PASSWORD } },
  }), { headers: { 'Content-Type': 'application/json' }, tags: { operation: 'perf_login' } });
  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }
  const sessionCookie = response.cookies?.vel_session?.[0]?.value;
  if (response.status !== 200 || body?.errors?.length || !sessionCookie || !body?.data?.login?.csrfToken) {
    fail(`Login failed (HTTP ${response.status}); check credentials, setup, and the 10/min auth limit.`);
  }
  return { cookie: `vel_session=${sessionCookie}; vel_csrf=${body.data.login.csrfToken}`, csrf: body.data.login.csrfToken };
}

export function requestHeaders(auth) {
  if (keys.length > 0) return { 'Content-Type': 'application/json', Authorization: keys[Math.max(0, __VU - 1) % keys.length] };
  return { 'Content-Type': 'application/json', Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf };
}

export function authForVu(session) {
  if (keys.length > 0) return null;
  return session;
}
