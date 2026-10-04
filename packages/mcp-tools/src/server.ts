import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolError, errorInfo } from './errors';
import type { GraphQLExecutor } from './executor';
import { registerPrompts } from './prompts';
import { createToolContext, toolDefinitions } from './tools';

export interface VelocityMcpServerOptions {
  executor: GraphQLExecutor;
  name?: string;
  version?: string;
}

/** Builds the Velocity MCP server (all tools + prompts). Transport-agnostic. */
export function createVelocityMcpServer(opts: VelocityMcpServerOptions): McpServer {
  const server = new McpServer({ name: opts.name ?? 'velocity', version: opts.version ?? '1.0.0' });
  const ctx = createToolContext(opts.executor);
  for (const def of toolDefinitions) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.shape,
        annotations: { readOnlyHint: def.readOnly, openWorldHint: false, ...(def.readOnly ? {} : { destructiveHint: false }) },
      },
      async (args: unknown): Promise<CallToolResult> => {
        try {
          const out = await def.run(args, ctx);
          return { content: [{ type: 'text', text: out.text }], structuredContent: out.data };
        } catch (e) {
          const err = e instanceof ToolError ? e : new ToolError(`INTERNAL: ${e instanceof Error ? e.message : String(e)}`, 'INTERNAL');
          return { isError: true, content: [{ type: 'text', text: err.message }], structuredContent: { error: errorInfo(err) } };
        }
      },
    );
  }
  registerPrompts(server);
  return server;
}
