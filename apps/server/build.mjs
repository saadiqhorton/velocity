// Production bundle (SPEC §5.9): workspace packages are bundled; npm dependencies stay external
// and are installed in the image via `pnpm deploy --prod`. SQL migrations ship next to main.js.
import { build } from 'esbuild';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
// pnpm exposes only the server's direct dependencies at /app/node_modules.
// Bundle dependencies owned solely by workspace packages (Pothos, Octokit, etc.)
// so the flattened server bundle never relies on undeclared root imports.
const pkgs = ['apps/server'];
const external = new Set();
for (const p of pkgs) {
  const pj = JSON.parse(readFileSync(join(root, p, 'package.json'), 'utf8'));
  for (const dep of Object.keys({ ...pj.dependencies, ...pj.peerDependencies })) {
    if (!dep.startsWith('@velocity/')) external.add(dep);
  }
}

rmSync(join(here, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: { main: join(here, 'src/main.ts'), 'migrate-cli': join(here, 'src/migrate-cli.ts'), 'seed-cli': join(here, 'src/seed-cli.ts'), 'admin-cli': join(here, 'src/admin-cli.ts') },
  outdir: join(here, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  legalComments: 'linked',
  // Bare deep imports (e.g. drizzle-orm/pg-core, @modelcontextprotocol/sdk/server/mcp.js) are external too.
  external: [...external].flatMap((d) => [d, `${d}/*`]),
  banner: { js: "import { createRequire as __velocityCreateRequire } from 'node:module'; const require = __velocityCreateRequire(import.meta.url);" },
  logLevel: 'info',
});
cpSync(join(root, 'packages/schema/migrations'), join(here, 'dist/migrations'), { recursive: true });
console.log(`bundled with ${external.size} external dependencies; migrations copied`);
