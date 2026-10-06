# Velocity MCP client

MCP (Model Context Protocol) stdio client for [Velocity](../../README.md). It lets AI agents search, create and update issues in your self-hosted Velocity using an API key. Thirteen tools: `create_issue`, `update_issue`, `get_issue`, `search_issues`, `list_issues`, `add_comment`, `manage_labels`, `set_status`, `assign_issue`, `list_teams`, `list_cycles`, `get_project`, `list_projects`, plus a `velocity_guide` prompt. See [docs/agents.md](../../docs/agents.md).

## Create an API key

In Velocity open Settings > API keys. Use a **read** key for read-only agents and a **write** key for agents that create or change issues.

## Streamable HTTP (Claude Code, Codex, Cursor, VS Code, most clients)

Every Velocity server exposes the tools at `<server>/mcp`, on by default. Authenticate with your API key alone: `X-Api-Key: vel_...` or `Authorization: Bearer vel_...`. (Operators can set `MCP_HTTP_ENABLED=0` to turn it off, or `MCP_HTTP_TOKEN` to additionally require that token as the Bearer, in which case the key goes in `X-Api-Key`.)

Claude Code:

```sh
claude mcp add --transport http velocity https://velocity.example.com/mcp --header "X-Api-Key: vel_your_api_key"
```

Cursor (`.cursor/mcp.json` or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "velocity": {
      "url": "https://velocity.example.com/mcp",
      "headers": { "X-Api-Key": "vel_your_api_key" }
    }
  }
}
```

Codex (CLI and IDE; `~/.codex/config.toml`, or `.codex/config.toml` in a trusted project):

```toml
[mcp_servers.velocity]
url = "https://velocity.example.com/mcp"
http_headers = { "X-Api-Key" = "vel_your_api_key" }
```

VS Code (GitHub Copilot agent mode; `.vscode/mcp.json`, or "MCP: Open User Configuration"). VS Code prompts for the key on first start, so it is not stored in the file:

```json
{
  "inputs": [
    { "type": "promptString", "id": "velocity-api-key", "description": "Velocity API key", "password": true }
  ],
  "servers": {
    "velocity": {
      "type": "http",
      "url": "https://velocity.example.com/mcp",
      "headers": { "X-Api-Key": "${input:velocity-api-key}" }
    }
  }
}
```

## stdio (Claude Desktop, any stdio-only client)

There is no npm package. The Velocity server serves this client as a content-addressed tarball at `<server>/mcp/client-<hash>.tgz` (the exact URL is shown in Settings > MCP), so `npx` runs it straight from your own server. It needs Node.js 22+.

| Variable | Meaning |
|---|---|
| `VELOCITY_URL` | Base URL of your Velocity server (default `http://localhost`) |
| `VELOCITY_API_KEY` | API key `vel_...` (required) |

Claude Desktop (`claude_desktop_config.json`; macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "velocity": {
      "command": "npx",
      "args": ["-y", "https://velocity.example.com/mcp/client-0123456789ab.tgz"],
      "env": {
        "VELOCITY_URL": "https://velocity.example.com",
        "VELOCITY_API_KEY": "vel_your_api_key"
      }
    }
  }
}
```

On start the client registers an MCP session with Velocity (`startMcpSession`), so mutations are audit-logged against the session. Logs go to stderr; stdout is reserved for the protocol.

## Development

```
pnpm --filter @velocity/mcp build     # self-contained bundle dist/index.js + dist/client-<hash>.tgz
VELOCITY_API_KEY=vel_... pnpm --filter @velocity/mcp dev
```

The server build copies the tarball into `apps/server/dist/mcp/`. The tarball is reproducible and named by the first 12 hex characters of its SHA-256, so any client change yields a new URL and npx's cache never serves a stale client; no version bump is needed.
