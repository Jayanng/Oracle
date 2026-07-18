/**
 * MCP server for CupEvent Oracle tools (stdio transport).
 * Run: npm run mcp
 *
 * 8 tools registered:
 *   - Oracle reads: get_latest_event, list_events
 *   - x402: get_premium_stats
 *   - Fan drops: create_drop, whitelist_drop, check_drop_eligibility, pay_drop
 *   - Feeder marketplace: feeder_earnings, withdraw_feeder_earnings
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { tools } from "./tools.js";

const server = new McpServer({
  name: "cup-event-oracle",
  version: "0.1.0",
});

// ---- Oracle reads ----

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

// ---- x402 ----

server.tool(
  "get_premium_stats",
  "Purchase premium match analytics via x402: returns calibrated win probabilities (home/draw/away), most-likely scorelines, expected goals, form, H2H and a model/provenance block. Use for match previews and outcome predictions.",
  { matchId: z.number().describe("Match / fixture ID") },
  async ({ matchId }) => {
    const result = await tools.getPremiumStats({ matchId });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Fan drops ----

server.tool(
  "create_drop",
  "Create a sponsor-funded fan drop. Sponsor must have approved USDC to the FanDrops contract. Returns dropId.",
  {
    matchId: z.number().describe("Match / fixture ID"),
    eventType: z.enum(["goal", "card", "sub", "halftime", "final"]).describe("Oracle event type that triggers the drop"),
    minuteFrom: z.number().describe("Inclusive start minute for oracle event window"),
    minuteTo: z.number().describe("Inclusive end minute for oracle event window"),
    perWinnerAmountUsdc: z.string().describe("USDC amount as decimal string, e.g. \"0.5\""),
    maxWinners: z.number().describe("Maximum number of winners"),
  },
  async ({ matchId, eventType, minuteFrom, minuteTo, perWinnerAmountUsdc, maxWinners }) => {
    const result = await tools.createDrop({ matchId, eventType, minuteFrom, minuteTo, perWinnerAmountUsdc, maxWinners });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "whitelist_drop",
  "Whitelist wallets for an existing fan drop. AGENT_ROLE required.",
  {
    dropId: z.number().describe("Drop ID"),
    wallets: z.array(z.string()).describe("Array of wallet addresses (0x-prefixed)"),
  },
  async ({ dropId, wallets }) => {
    const result = await tools.whitelistDrop({ dropId, wallets });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "check_drop_eligibility",
  "Check if a wallet is eligible, has already claimed, and whether the oracle event has fired for a drop.",
  {
    dropId: z.number().describe("Drop ID"),
    wallet: z.string().describe("Wallet address to check (0x-prefixed)"),
  },
  async ({ dropId, wallet }) => {
    const result = await tools.checkDropEligibility({ dropId, wallet });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "pay_drop",
  "Trigger payout for a whitelisted wallet from a drop. Same-chain by default, or specify destinationDomain for CCTP cross-chain.",
  {
    dropId: z.number().describe("Drop ID"),
    wallet: z.string().describe("Wallet address to receive payout (0x-prefixed)"),
    destinationDomain: z.number().optional().describe("CCTP destination domain (0=Sepolia, 29=Injective same-chain). Omit for same-chain."),
  },
  async ({ dropId, wallet, destinationDomain }) => {
    const result = await tools.payDrop({ dropId, wallet, destinationDomain });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Feeder marketplace ----

server.tool(
  "feeder_earnings",
  "Check a feeder's earned USDC, event count, and total paid out from the OracleTreasury.",
  {
    feeder: z.string().describe("Feeder wallet address (0x-prefixed)"),
  },
  async ({ feeder }) => {
    const result = await tools.feederEarnings({ feeder });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "withdraw_feeder_earnings",
  "Withdraw earned USDC from the OracleTreasury. Same-chain by default, or specify destinationDomain for CCTP cross-chain.",
  {
    amount: z.string().describe("USDC amount as decimal string, e.g. \"10.50\""),
    destinationDomain: z.number().optional().describe("CCTP destination domain (0=Sepolia). Omit for same-chain Injective."),
  },
  async ({ amount, destinationDomain }) => {
    const result = await tools.withdrawFeederEarnings({ amount, destinationDomain });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
