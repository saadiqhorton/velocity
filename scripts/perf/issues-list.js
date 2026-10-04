import http from 'k6/http';
import { check, fail } from 'k6';
import { authForVu, baseUrl, duration, keys, loginSession, requestHeaders, vus } from './auth.js';

export const options = {
  scenarios: {
    issue_list: {
      executor: 'constant-vus',
      vus,
      duration,
    },
  },
  thresholds: {
    'http_req_duration{scenario:issue_list}': ['p(95)<150'],
    'checks{scenario:issue_list}': ['rate>0.99'],
    'http_req_failed{scenario:issue_list}': ['rate<0.01'],
  },
};

const fixtureQuery = `query PerfFixture {
  all: issues(first: 1) { totalCount }
  eng: issues(teamKey: "ENG", first: 50) {
    nodes { id identifier title priority }
  }
}`;
const query = `query PerfIssues {
  issues(
    teamKey: "ENG"
    filter: "statusCategory:todo or statusCategory:in_progress order:priority asc"
    first: 50
  ) {
    nodes { id identifier title priority }
    pageInfo { hasNextPage endCursor }
  }
}`;

function post(query, auth, name) {
  return http.post(`${baseUrl}/graphql`, JSON.stringify({ query }), {
    headers: requestHeaders(auth),
    tags: { operation: name },
  });
}

export function setup() {
  const session = keys.length > 0 ? null : loginSession();
  const auth = authForVu(session);
  const response = post(fixtureQuery, auth, 'perf_fixture_check');
  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }
  if (response.status !== 200 || body?.errors?.length || !body?.data?.all || !Array.isArray(body?.data?.eng?.nodes)) {
    fail(`Could not validate seeded issues (HTTP ${response.status}); check the server, credentials, and seed database.`);
  }
  if (body.data.all.totalCount < 10_000) {
    fail(`Expected at least 10,000 issues in the benchmark database; found ${body.data.all.totalCount}.`);
  }
  if (body.data.eng.nodes.length < 50) {
    fail(`Expected at least 50 seeded ENG issues; found ${body.data.eng.nodes.length}.`);
  }
  return session;
}

export default function (session) {
  // A distinct key per VU avoids putting every user in one API-key rate bucket.
  // With fewer keys, the VUs cycle through the supplied credentials.
  const auth = authForVu(session);
  const response = post(query, auth, 'issues_list');

  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }

  check(response, {
    'HTTP status is 200': (r) => r.status === 200,
    'GraphQL has no errors': () => Array.isArray(body?.errors) === false,
    'issue connection is present': () => Array.isArray(body?.data?.issues?.nodes),
    'filtered page has 50 issues': () => body?.data?.issues?.nodes?.length === 50,
    'issue identifiers are present': () => body?.data?.issues?.nodes?.every((issue) => typeof issue.identifier === 'string' && issue.identifier.length > 0),
  });
}
