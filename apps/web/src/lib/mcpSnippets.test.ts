import { describe, expect, it } from 'vitest';
import { claudeCodeCommand, claudeDesktopConfig, codexConfig, cursorConfig, npxCommand, vscodeConfig } from './mcpSnippets';

const tgz = 'https://v.example.com/mcp/client-abcdef012345.tgz';

describe('MCP snippets', () => {
  it('builds the Claude Code command with the key header', () => {
    expect(claudeCodeCommand('https://v.example.com/mcp')).toBe(
      'claude mcp add --transport http velocity https://v.example.com/mcp --header "X-Api-Key: vel_your_api_key"',
    );
  });
  it('builds a Claude Desktop config that runs the served tarball', () => {
    const cfg = JSON.parse(claudeDesktopConfig('https://v.example.com', tgz));
    expect(cfg.mcpServers.velocity).toEqual({
      command: 'npx',
      args: ['-y', tgz],
      env: { VELOCITY_URL: 'https://v.example.com', VELOCITY_API_KEY: 'vel_your_api_key' },
    });
    expect(claudeDesktopConfig('https://v.example.com', tgz)).toContain(`"args": ["-y", "${tgz}"]`);
  });
  it('builds a Cursor mcp.json with url and headers', () => {
    expect(JSON.parse(cursorConfig('https://v.example.com/mcp'))).toEqual({
      mcpServers: { velocity: { url: 'https://v.example.com/mcp', headers: { 'X-Api-Key': 'vel_your_api_key' } } },
    });
  });
  it('builds a Codex config.toml table with url and header', () => {
    const toml = codexConfig('https://v.example.com/mcp');
    expect(toml).toBe(
      '[mcp_servers.velocity]\nurl = "https://v.example.com/mcp"\nhttp_headers = { "X-Api-Key" = "vel_your_api_key" }',
    );
    const lines = toml.split('\n');
    expect(lines[0]).toMatch(/^\[[A-Za-z0-9_.]+\]$/);
    for (const line of lines.slice(1)) expect(line).toMatch(/^[a-z_]+ = ("[^"]*"|\{.*\})$/);
  });
  it('builds a VS Code mcp.json that prompts for the key', () => {
    const cfg = JSON.parse(vscodeConfig('https://v.example.com/mcp'));
    expect(cfg).toEqual({
      inputs: [{ type: 'promptString', id: 'velocity-api-key', description: 'Velocity API key', password: true }],
      servers: {
        velocity: { type: 'http', url: 'https://v.example.com/mcp', headers: { 'X-Api-Key': '${input:velocity-api-key}' } },
      },
    });
    expect(vscodeConfig('https://v.example.com/mcp')).not.toContain('vel_');
  });
  it('builds the npx command', () => {
    expect(npxCommand(tgz)).toBe(`npx -y ${tgz}`);
  });
});
