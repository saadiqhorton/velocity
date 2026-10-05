# @velocity/mcp

MCP (Model Context Protocol) server for [Velocity](../../README.md). It lets AI agents search, create and update issues in your self-hosted Velocity using an API key. Thirteen tools: `create_issue`, `update_issue`, `get_issue`, `search_issues`, `list_issues`, `add_comment`, `manage_labels`, `set_status`, `assign_issue`, `list_teams`, `list_cycles`, `get_project`, `list_projects`, plus a `velocity_guide` prompt. See [docs/agents.md](../../docs/agents.md).

## Create an API key

In Velocity open Settings > API keys. Use a **read** key for read-only agents and a **write** key for agents that create or change issues.

## stdio (Claude Desktop, Cursor, Claude Code)

Environment:

| Variable | Meaning |
|---|---|
| `VELOCITY_URL` | Base URL of your Velocity server (default `http://localhost`) |
| `VELOCITY_API_KEY` | API key `vel_...` (required) |

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "velocity": {
      "command": "npx",
      "args": ["-y", "@velocity/mcp"],
      "env": {
        "VELOCITY_URL": "https://velocity.example.com",
        "VELOCITY_API_KEY": "vel_xxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "velocity": {
      "command": "npx",
      "args": ["-y", "@velocity/mcp"],
      "env": {
        "VELOCITY_URL": "https://velocity.example.com",
        "VELOCITY_API_KEY": "vel_xxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Claude Code: `claude mcp add velocity -e VELOCITY_URL=https://velocity.example.com -e VELOCITY_API_KEY=vel_... -- npx -y @velocity/mcp`

On start the server registers an MCP session with Velocity (`startMcpSession`), so mutations are audit-logged against the session. Logs go to stderr; stdout is reserved for the protocol.

## Streamable HTTP (remote agents, opt-in)

The Velocity server can expose the same tools at `<server>/mcp`. It is off by default; enable it by setting `MCP_HTTP_ENABLED=1` and `MCP_HTTP_TOKEN` (at least 24 characters) on the server. Clients send two headers:

```
Authorization: Bearer <MCP_HTTP_TOKEN>
X-Api-Key: vel_xxxxxxxxxxxxxxxx
```

Example client config:

```json
{
  "mcpServers": {
    "velocity": {
      "url": "https://velocity.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_HTTP_TOKEN>",
        "X-Api-Key": "vel_xxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## Development

```
pnpm --filter @velocity/mcp build     # esbuild bundle -> dist/index.js
VELOCITY_API_KEY=vel_... pnpm --filter @velocity/mcp dev
```
