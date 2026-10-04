import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AGENT_GUIDE } from './guide';

/** SPEC §6.6.2: agent guidance is served through prompts/list. */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'velocity_guide',
    {
      title: 'Velocity agent guide',
      description: 'Tool semantics, identifier syntax, filter DSL cheat sheet, etiquette and error handling for working in Velocity.',
    },
    () => ({
      description: 'Velocity agent guide',
      messages: [{ role: 'user', content: { type: 'text', text: AGENT_GUIDE } }],
    }),
  );
}
