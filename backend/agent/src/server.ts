/**
 * MCP server for CupEvent Oracle tools (stdio transport).
 * Run: npm run mcp
 *
 * Verified: @modelcontextprotocol/sdk@1.29.0 exists.
 * Official Injective MCP is InjectiveLabs/mcp-server (trading) — we ship oracle-specific tools.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { tools } from "./tools.js";

const server = new McpServer({
  name: "cup-event-oracle",
  version: "0.1.0",
});

server.tool(
  "get_latest_event",
  "Latest on-chain event for a match from CupEventOracle",
  { matchId: z.number().describe("Match / fixture ID") },
  async ({ matchId }) => {
    const result = await tools.getLatestEvent({ matchId });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_events",
  "All on-chain events for a match",
  { matchId: z.number().describe("Match / fixture ID") },
  async ({ matchId }) => {
    const result = await tools.listEvents({ matchId });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "settle_match",
  "Settle a prediction market after full-time final event is on-chain",
  { matchId: z.number().describe("Match / fixture ID") },
  async ({ matchId }) => {
    const result = await tools.settleMatch({ matchId });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_premium_stats",
  "Purchase premium match analytics via x402 (autonomous payment)",
  { matchId: z.number().describe("Match / fixture ID") },
  async ({ matchId }) => {
    const result = await tools.getPremiumStats({ matchId });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
