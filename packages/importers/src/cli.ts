import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { IMPORT_KINDS, runImport, type ImportKind } from './import-flow';

const HELP = `velocity-import - import data into a Velocity server

Usage:
  velocity-import <linear-csv|jira-csv|linear-api|github> [file] --url <server url> --api-key <vel_...> [options]

Options:
  --url <url>             Velocity server URL (or VELOCITY_URL)
  --api-key <key>         Velocity API key (or VELOCITY_API_KEY)
  --linear-key <key>      Linear API key for linear-api (or LINEAR_API_KEY)
  --github-token <token>  GitHub token for github (or GITHUB_TOKEN)
  --repos <a/b,c/d>       Comma-separated GitHub repos
  --dry-run               Show the dry-run report and stop
  --yes, -y               Skip the confirmation prompt
  --help, -h              Show this help
`;

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        url: { type: 'string' },
        'api-key': { type: 'string' },
        'linear-key': { type: 'string' },
        'github-token': { type: 'string' },
        repos: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        yes: { type: 'boolean', short: 'y', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.error(HELP);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return values.help ? 0 : 2;
  }
  const kind = positionals[0] as ImportKind;
  if (!IMPORT_KINDS.includes(kind)) {
    console.error(`Unknown source "${positionals[0]}". Expected one of: ${IMPORT_KINDS.join(', ')}`);
    return 2;
  }
  const url = values.url ?? process.env.VELOCITY_URL;
  const apiKey = values['api-key'] ?? process.env.VELOCITY_API_KEY;
  if (!url || !apiKey) {
    console.error('--url and --api-key are required');
    return 2;
  }
  return runImport(
    {
      kind,
      file: positionals[1],
      url,
      apiKey,
      linearKey: values['linear-key'] ?? process.env.LINEAR_API_KEY,
      githubToken: values['github-token'] ?? process.env.GITHUB_TOKEN,
      repos: values.repos?.split(',').map((s) => s.trim()).filter(Boolean),
      dryRun: values['dry-run'],
      yes: values.yes,
    },
    {
      print: (l) => console.log(l),
      write: (t) => process.stdout.write(t),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      stdin: process.stdin.isTTY ? undefined : process.stdin,
      confirm: async (q) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          return /^y(es)?$/i.test((await rl.question(q)).trim());
        } finally {
          rl.close();
        }
      },
    },
  );
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
