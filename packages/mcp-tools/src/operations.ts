/** Every GraphQL document the MCP tools use. Issue payloads always carry the canonical `identifier`. */

export const ISSUE_CORE_FRAGMENT = /* GraphQL */ `
  fragment IssueCore on Issue {
    id
    identifier
    title
    priority
    estimate
    url
    createdAt
    updatedAt
    completedAt
    status { id name category }
    assignee { id username name }
    team { id key name }
    labels { id name }
    project { id name }
    cycle { id number name }
    parent { identifier title }
  }
`;

export const ISSUE_DETAIL_FRAGMENT = /* GraphQL */ `
  fragment IssueDetail on Issue {
    ...IssueCore
    descriptionMd
    creator { id username name }
    milestone { id name }
    subIssueRollup { done total }
    children { identifier title status { name category } assignee { username } }
    relations { id type issue { identifier title status { name category } } }
    githubLinks { id kind repo prNumber title state url headBranch commitSha mergedAt closesIssue }
    comments { id bodyMd createdAt editedAt source authorName author { username name } }
  }
  ${ISSUE_CORE_FRAGMENT}
`;

export const RESOLVE_ISSUE = /* GraphQL */ `
  query ResolveIssue($id: ID!) {
    issue(id: $id) {
      id
      identifier
      title
      status { id name category }
      labels { id name }
      team { id key name statuses { id name category } }
    }
  }
`;

export const TEAM_BY_KEY = /* GraphQL */ `
  query TeamByKey($key: String!) {
    team(key: $key) {
      id
      key
      name
      statuses { id name category }
    }
  }
`;

export const ALL_TEAM_KEYS = /* GraphQL */ `
  query TeamKeys { teams { key name } }
`;

export const LABELS = /* GraphQL */ `
  query Labels { labels { id name isGroup } }
`;

export const VIEWER = /* GraphQL */ `
  query Viewer { viewer { id username name } }
`;

export const USERS = /* GraphQL */ `
  query Users { users { id username name } }
`;

export const LIST_TEAMS = /* GraphQL */ `
  query ListTeams {
    teams {
      id
      key
      name
      description
      cycleEnabled
      estimateScale
      openIssueCount
      statuses { id name category }
      members { username name }
    }
    labels { id name isGroup }
  }
`;

export const CREATE_ISSUE = /* GraphQL */ `
  mutation CreateIssue($input: CreateIssueInput!) {
    createIssue(input: $input) { ...IssueCore }
  }
  ${ISSUE_CORE_FRAGMENT}
`;

export const UPDATE_ISSUE = /* GraphQL */ `
  mutation UpdateIssue($id: ID!, $input: UpdateIssueInput!, $expectedUpdatedAt: DateTime) {
    updateIssue(id: $id, input: $input, expectedUpdatedAt: $expectedUpdatedAt) { ...IssueCore }
  }
  ${ISSUE_CORE_FRAGMENT}
`;

export const GET_ISSUE = /* GraphQL */ `
  query GetIssue($id: ID!) {
    issue(id: $id) { ...IssueDetail }
  }
  ${ISSUE_DETAIL_FRAGMENT}
`;

export const SEARCH_ISSUES = /* GraphQL */ `
  query SearchIssues($query: String!, $limit: Int) {
    search(query: $query, types: [issue], limit: $limit) {
      rank
      issue { ...IssueCore }
    }
  }
  ${ISSUE_CORE_FRAGMENT}
`;

export const LIST_ISSUES = /* GraphQL */ `
  query ListIssues($filter: String, $teamKey: String, $first: Int, $after: String) {
    issues(filter: $filter, teamKey: $teamKey, first: $first, after: $after) {
      totalCount
      pageInfo { endCursor hasNextPage }
      nodes { ...IssueCore }
    }
  }
  ${ISSUE_CORE_FRAGMENT}
`;

export const ADD_COMMENT = /* GraphQL */ `
  mutation AddComment($issueId: ID!, $bodyMd: String!) {
    createComment(issueId: $issueId, bodyMd: $bodyMd) {
      id
      bodyMd
      createdAt
      author { username name }
      issue { identifier url }
    }
  }
`;

export const LIST_CYCLES = /* GraphQL */ `
  query ListCycles($teamKey: String, $first: Int) {
    cycles(teamKey: $teamKey, first: $first, includeClosed: true) {
      id
      number
      name
      startsAt
      endsAt
      closedAt
      isActive
      isUpcoming
      team { key }
      stats { scopeCount scopePoints completedCount completedPoints canceledCount carriedOverCount addedAfterStartCount removedCount }
      liveStats { scopeCount scopePoints completedCount completedPoints startedCount canceledCount addedAfterStartCount }
    }
  }
`;

export const PROJECT_FIELDS = /* GraphQL */ `
  fragment ProjectFields on Project {
    id
    name
    status
    health
    targetDate
    url
    archivedAt
    lead { username name }
    teams { key name }
    progress { done total percent pointsDone pointsTotal }
  }
`;

export const GET_PROJECT = /* GraphQL */ `
  query GetProject($id: ID!) {
    project(id: $id) {
      ...ProjectFields
      descriptionMd
      milestones { id name status targetDate description progress { done total percent pointsDone pointsTotal } }
    }
  }
  ${PROJECT_FIELDS}
`;

export const LIST_PROJECTS = /* GraphQL */ `
  query ListProjects($status: [ProjectStatus!], $teamId: ID, $includeArchived: Boolean) {
    projects(status: $status, teamId: $teamId, includeArchived: $includeArchived) { ...ProjectFields }
  }
  ${PROJECT_FIELDS}
`;

export const PARSE_FILTER = /* GraphQL */ `
  query ParseFilter($dsl: String!) {
    parseFilter(dsl: $dsl) { ok canonical error { message position caret } }
  }
`;
