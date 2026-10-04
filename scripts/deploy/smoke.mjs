#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const baseUrl = (process.env.BASE_URL ?? 'http://localhost:8089').replace(/\/$/, '');
const requireWeb = process.env.REQUIRE_WEB !== '0';
const graphqlUrl = `${baseUrl}/graphql`;

function check(condition, message) {
  assert.ok(condition, message);
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  let body = null;
  try {
    body = await response.json();
  } catch {
    // The caller reports a useful assertion for unexpected response bodies.
  }
  return { response, body };
}

async function graphql(query, variables = {}, auth = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth.cookie) headers.cookie = auth.cookie;
  if (auth.csrf) headers['x-csrf-token'] = auth.csrf;
  const result = await requestJson(graphqlUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  return result;
}

function assertGraphqlOk({ response, body }, label) {
  check(response.status === 200, `${label}: expected HTTP 200, got ${response.status}`);
  check(body && !body.errors?.length, `${label}: GraphQL returned errors`);
  return body.data;
}

function authCookie(setCookies) {
  const values = new Map();
  for (const value of setCookies) {
    const pair = value.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator > 0) values.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  const session = values.get('vel_session');
  const csrf = values.get('vel_csrf');
  check(session && csrf, 'setupWorkspace did not set the expected session and CSRF cookies');
  return { cookie: `vel_session=${session}; vel_csrf=${csrf}` };
}

async function checkWeb() {
  const { response, body } = await (async () => {
    const r = await fetch(`${baseUrl}/`);
    return { response: r, body: await r.text() };
  })();
  check(response.status === 200, `SPA root: expected HTTP 200, got ${response.status}`);
  check(/<!doctype html/i.test(body) && /<html\b/i.test(body), 'SPA root did not return HTML');

  const assets = [...body.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi)]
    .map((match) => match[1])
    .filter((path) => !path.startsWith('http://') && !path.startsWith('https://'));
  const jsAssets = assets.filter((path) => /\.js(?:\?|$)/i.test(path));
  check(jsAssets.length > 0, 'SPA HTML did not reference a JavaScript asset');

  for (const asset of assets) {
    const assetUrl = new URL(asset, `${baseUrl}/`);
    const assetResponse = await fetch(assetUrl);
    check(assetResponse.status === 200, `SPA asset ${assetUrl.pathname}: expected HTTP 200, got ${assetResponse.status}`);
    const data = await assetResponse.arrayBuffer();
    check(data.byteLength > 0, `SPA asset ${assetUrl.pathname} was empty`);
  }
}

async function main() {
  const setup = await graphql('query SmokeSetupStatus { setupStatus { needsSetup setupCompleted } }');
  const setupData = assertGraphqlOk(setup, 'setupStatus');
  check(setupData.setupStatus.needsSetup === true, 'Refusing to write: deployment is not fresh (needsSetup is false)');

  const suffix = `${Date.now()}${randomBytes(3).toString('hex')}`;
  const username = `smoke${suffix}`;
  const password = randomBytes(24).toString('base64url');
  const workspaceName = `Deployment smoke ${suffix}`;
  const setupMutation = `mutation SmokeSetup($input: SetupWorkspaceInput!) {
    setupWorkspace(input: $input) { csrfToken user { id username } }
  }`;
  const setupResult = await graphql(setupMutation, {
    input: { workspaceName, username, password, name: 'Smoke Test Owner' },
  });
  const setupCookies = setupResult.response.headers.getSetCookie?.() ?? [];
  const auth = authCookie(setupCookies);
  const setupPayload = assertGraphqlOk(setupResult, 'setupWorkspace').setupWorkspace;
  auth.csrf = setupPayload.csrfToken;
  check(setupPayload.user.username === username, 'setupWorkspace returned an unexpected owner');

  const unauth = await graphql('mutation SmokeUnauth { createTeam(input: { key: "UNAUTH", name: "Unauthorized" }) { id } }');
  check(unauth.body?.errors?.some((error) => error.extensions?.code === 'UNAUTHENTICATED'), 'Unauthenticated mutation was not rejected');

  const csrfDenied = await graphql('mutation SmokeCsrf { completeSetup }', {}, { cookie: auth.cookie });
  check(csrfDenied.body?.errors?.some((error) => error.extensions?.code === 'FORBIDDEN'), 'Cookie-authenticated mutation without CSRF token was not rejected');

  const teamKey = `SM${randomBytes(3).toString('hex').toUpperCase()}`;
  const createTeam = await graphql(
    'mutation SmokeTeam($input: CreateTeamInput!) { createTeam(input: $input) { id key name } }',
    { input: { key: teamKey, name: 'Smoke Test Team' } },
    auth,
  );
  const team = assertGraphqlOk(createTeam, 'createTeam').createTeam;
  check(team.key === teamKey, 'createTeam returned an unexpected team key');

  const issueTitle = `Deployment smoke issue ${suffix}`;
  const createIssue = await graphql(
    'mutation SmokeIssue($input: CreateIssueInput!) { createIssue(input: $input) { id identifier title } }',
    { input: { teamId: team.id, title: issueTitle } },
    auth,
  );
  const issue = assertGraphqlOk(createIssue, 'createIssue').createIssue;
  check(issue.title === issueTitle && issue.identifier.startsWith(`${teamKey}-`), 'createIssue returned unexpected issue data');

  const complete = await graphql('mutation SmokeCompleteSetup { completeSetup }', {}, auth);
  check(assertGraphqlOk(complete, 'completeSetup').completeSetup === true, 'completeSetup did not return true');

  const verifyIssue = await graphql(
    'query SmokeVerifyIssue($id: ID!) { issue(id: $id) { id identifier title team { key } } }',
    { id: issue.id },
    auth,
  );
  const savedIssue = assertGraphqlOk(verifyIssue, 'verify issue').issue;
  check(savedIssue?.id === issue.id && savedIssue.title === issueTitle && savedIssue.team?.key === teamKey, 'created issue could not be read back');

  const [ready, metrics] = await Promise.all([
    fetch(`${baseUrl}/readyz`),
    fetch(`${baseUrl}/metrics`),
  ]);
  check(ready.status === 200, `readyz: expected HTTP 200, got ${ready.status}`);
  const readyBody = await ready.json();
  check(readyBody.ok === true, 'readyz reported an unhealthy deployment');
  check(metrics.status === 403, `metrics: expected external HTTP 403, got ${metrics.status}`);

  if (requireWeb) await checkWeb();

  console.log(`Smoke passed: setup, team ${teamKey}, issue ${issue.identifier}, CSRF/auth rejection, readiness, metrics protection${requireWeb ? ', SPA and assets' : ''}.`);
}

main().catch((error) => {
  console.error(`Deployment smoke failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
