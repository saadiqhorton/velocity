/* global __VU, __ITER */
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { check, fail } from 'k6';
import { authForVu, baseUrl, duration, keys, loginSession, requestHeaders, vus } from './auth.js';

const failedGraphql = new Counter('graphql_errors');

export const options = {
  scenarios: {
    mutation_storm: {
      executor: 'constant-vus',
      vus,
      duration,
    },
  },
  thresholds: {
    'checks{scenario:mutation_storm}': ['rate>0.99'],
    'http_req_failed{scenario:mutation_storm}': ['rate<0.01'],
    graphql_errors: ['count==0'],
  },
};

const seedQuery = `query PerfSeedIssues {
  issues(teamKey: "ENG", first: 100) { nodes { id identifier priority } }
}`;
const updateMutation = `mutation PerfUpdateIssue($id: ID!, $priority: Int!, $title: String!) {
  updateIssue(id: $id, input: { priority: $priority, title: $title }) {
    id identifier priority title
  }
}`;

function post(query, variables, auth, name) {
  return http.post(`${baseUrl}/graphql`, JSON.stringify({ query, variables }), {
    headers: requestHeaders(auth),
    tags: { operation: name },
  });
}

export function setup() {
  const session = keys.length > 0 ? null : loginSession();
  const auth = keys.length > 0 ? null : session;
  const response = post(seedQuery, undefined, auth, 'perf_seed_lookup');
  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }
  if (response.status !== 200 || body?.errors?.length || !Array.isArray(body?.data?.issues?.nodes)) {
    fail(`Could not fetch seeded ENG issues (HTTP ${response.status}). Check the server, API key, and seed database.`);
  }
  if (body.data.issues.nodes.length < vus) {
    fail(`Need at least ${vus} seeded ENG issues for distinct VU targets; found ${body.data.issues.nodes.length}.`);
  }
  return { issues: body.data.issues.nodes, session };
}

export default function (state) {
  const auth = authForVu(state.session);
  // Each VU owns one seeded issue, avoiding row contention and unbounded data growth.
  const issue = state.issues[__VU - 1];
  const priority = (__ITER % 2) + 1;
  const title = `Perf update ${__VU}-${__ITER}`;
  const response = post(updateMutation, { id: issue.id, priority, title }, auth, 'update_issue');
  let body;
  try {
    body = response.json();
  } catch {
    body = null;
  }
  if (body?.errors?.length) failedGraphql.add(body.errors.length);
  check(response, {
    'HTTP status is 200': (r) => r.status === 200,
    'GraphQL has no errors': () => Array.isArray(body?.errors) === false,
    'updated issue matches requested values': () => {
      const updated = body?.data?.updateIssue;
      return updated?.id === issue.id && updated?.title === title && updated?.priority === priority;
    },
  });
}
