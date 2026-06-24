#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerStyleTools } from "./tools/styles.js";
import { registerHealthTools } from "./tools/health.js";
import { registerContextTools } from "./tools/context.js";
import { registerExtractTools } from "./tools/extract.js";
import { registerPresenceTools } from "./tools/presence.js";
import { registerStorageTools } from "./tools/storage.js";
import { PACKAGE_VERSION } from "../version.js";

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "open-styles",
    version: PACKAGE_VERSION,
  });

  registerStyleTools(server);
  registerHealthTools(server);
  registerContextTools(server);
  registerExtractTools(server);
  registerPresenceTools(server);
  registerStorageTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  startMcpServer().catch((err) => {
    process.stderr.write("MCP server error: " + String(err) + "\n");
    process.exit(1);
  });
}
