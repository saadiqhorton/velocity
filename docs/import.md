# Import guide

Velocity imports Linear exports, Jira CSV files, Linear API data, and GitHub Issues. The same import pipeline supports the application workflow and the `velocity-import` CLI. Keep source credentials private; the Linear and GitHub API credentials are used by the importer to fetch source data and are not part of the imported bundle.

## Import flow

The pipeline parses or fetches source data, proposes mappings for teams and workflow statuses, runs a dry-run report, and then commits in resumable 500-row chunks. Review warnings and unmapped values before committing. A commit can be followed through the import run status and `importProgress` subscription.

Imports do not overwrite an existing workspace wholesale. Review the suggested mappings and dry-run counts before confirming. Keep a database backup before a large import. The import service suppresses per-issue notifications and webhooks while processing batches, so an imported archive does not send a notification for every row.

## CLI setup

Build the CLI from the repository and invoke it with an API key that has write scope:

```sh
pnpm --filter @velocity/importers build
node packages/importers/dist/cli.js --help
```

You can supply `--url` and `--api-key` options or set `VELOCITY_URL` and `VELOCITY_API_KEY`. CSV data can be supplied as a file path or through standard input. The CLI displays a mapping and dry-run report, asks before committing by default, and polls for completion progress.

## Linear CSV

Export the relevant Linear data as CSV, then run:

```sh
node packages/importers/dist/cli.js linear-csv ./linear-export.csv \
  --url http://localhost:3000 --api-key vel_your_api_key --dry-run
```

Remove `--dry-run` to proceed to the confirmation prompt and commit. Linear CSV import includes issues, teams, statuses, labels, projects, cycles, comments, relations, and sub-issues where source data contains them. Attachments are reported for manual re-upload.

## Jira CSV

Export the Jira project data as CSV and use:

```sh
node packages/importers/dist/cli.js jira-csv ./jira-export.csv \
  --url http://localhost:3000 --api-key vel_your_api_key --dry-run
```

The importer maps projects to teams, issue types to labels, statuses to workflow categories, priorities, sprints to cycles, story points to estimates, and comments. Review warnings for unsupported or unmapped values.

## Linear API

Provide a Linear API key separately from the Velocity key:

```sh
node packages/importers/dist/cli.js linear-api \
  --url http://localhost:3000 --api-key vel_your_api_key \
  --linear-key lin_api_your_key --dry-run
```

The source key is read-only and held in memory for the fetch. The current CLI does not offer team selection for this source; it fetches the available Linear data according to the importer implementation.

## GitHub Issues

Supply a GitHub token and one or more `owner/repository` names:

```sh
node packages/importers/dist/cli.js github \
  --url http://localhost:3000 --api-key vel_your_api_key \
  --github-token ghp_your_token --repos acme/service,acme/web --dry-run
```

The importer maps repositories to Velocity teams, issue state to status, GitHub labels and comments, and assignees when a user can be matched. The CLI currently uses a GitHub token for this source; GitHub App based imports are available through the application integration path.

## Options and environment variables

| Option | Environment variable | Purpose |
|---|---|---|
| `--url` | `VELOCITY_URL` | Velocity server URL |
| `--api-key` | `VELOCITY_API_KEY` | Velocity write API key |
| `--linear-key` | `LINEAR_API_KEY` | Source credential for `linear-api` |
| `--github-token` | `GITHUB_TOKEN` | Source credential for `github` |
| `--repos` | — | Comma-separated GitHub repositories |
| `--dry-run` | — | Print the report and stop without importing |
| `--yes` / `-y` | — | Skip confirmation and commit after dry run |

For a CSV from standard input, omit the file argument and pipe it to the selected CSV importer. `--dry-run` is the recommended first pass:

```sh
cat ./linear-export.csv | node packages/importers/dist/cli.js linear-csv \
  --url http://localhost:3000 --api-key vel_your_api_key --dry-run
```

Check run status in the application or through the `importRun(id: …)` GraphQL query. If a run fails or is interrupted, inspect its status and report before retrying; commit work is chunked and resumable.
