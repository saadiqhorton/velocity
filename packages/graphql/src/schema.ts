import { builder } from './builder';
import './refs';
import './types/identity';
import './types/issues';
import './types/planning';
import './types/platform';

/** The one GraphQL schema: web app, public API, MCP and importers (SPEC §5.1 ADR 2). */
export const schema = builder.toSchema({ sortSchema: true });
