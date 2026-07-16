/**
 * HTTP chat layer for the frontend.
 * Uses OpenAI tool-calling + deterministic regex fallback for demo reliability.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();
import express from "express";
import cors from "cors";
import { tools } from "./tools.js";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const toolSchema: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_latest_event",
      description: "Latest on-chain event for a match",
      parameters: {
        type: "object",
        properties: { matchId: { type: "number" } },
        required: ["matchId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_events",
      description: "All on-chain events for a match",
      parameters: {
        type: "object",
        properties: { matchId: { type: "number" } },
        required: ["matchId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "settle_match",
      description: "Settle prediction market after full-time",
      parameters: {
        type: "object",
        properties: { matchId: { type: "number" } },
        required: ["matchId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_premium_stats",
      description: "Purchase premium analytics via x402",
      parameters: {
        type: "object",
        properties: { matchId: { type: "number" } },
        required: ["matchId"],
      },
    },
  },
];

const nameMap: Record<string, keyof typeof tools> = {
  get_latest_event: "getLatestEvent",
  list_events: "listEvents",
  settle_match: "settleMatch",
  get_premium_stats: "getPremiumStats",
};

async function runTool(name: string, args: { matchId: number }) {
  const fn = nameMap[name];
  if (!fn) throw new Error(`unknown tool: ${name}`);
  const t0 = Date.now();
  const result = await tools[fn](args);
  return { result, ms: Date.now() - t0 };
}

/** Deterministic demo fallback when LLM is missing or fails tool selection */
function regexRoute(text: string): { tool: string; matchId: number } | null {
  const lower = text.toLowerCase();
  const idMatch = text.match(/match\s*#?\s*(\d+)/i) || text.match(/\b(\d{4,})\b/);
  const matchId = idMatch ? Number(idMatch[1]) : Number(process.env.FIXTURE_ID || 2026001);

  if (/premium|x402|stats|analytics|xG|xg/.test(lower)) {
    return { tool: "get_premium_stats", matchId };
  }
  if (/settle/.test(lower)) {
    return { tool: "settle_match", matchId };
  }
  if (/all\s+(events|goals)|list\s+events|show\s+me\s+all/.test(lower)) {
    return { tool: "list_events", matchId };
  }
  if (/latest|last\s+event|what\s+happened|score|goal/.test(lower)) {
    return { tool: "get_latest_event", matchId };
  }
  return null;
}

function formatAnswer(tool: string, result: unknown): string {
  if (tool === "get_latest_event") {
    const e = result as { minute: number; eventType: string; details: string; matchId: number };
    return `Latest on-chain event for match **${e.matchId}**: **${e.eventType}** at minute ${e.minute}. Details: \`${e.details}\`. (read from CupEventOracle on Injective EVM testnet)`;
  }
  if (tool === "list_events") {
    const arr = result as Array<{ minute: number; eventType: string; details: string }>;
    const lines = arr.map((e) => `- min ${e.minute}: **${e.eventType}** — ${e.details}`);
    return `Found **${arr.length}** on-chain events:\n${lines.join("\n")}`;
  }
  if (tool === "get_premium_stats") {
    const s = result as {
      xg?: { home: number; away: number };
      possession?: { home: number; away: number };
      _x402?: { paid: boolean; amount: string };
      narrative?: string;
    };
    const paid = s._x402
      ? `\n\n💳 **x402 payment**: paid ${Number(s._x402.amount) / 1e6} USDC (sig verified).`
      : "";
    return `Premium analytics (x402):\n- xG: ${s.xg?.home} – ${s.xg?.away}\n- Possession: ${s.possession?.home}% – ${s.possession?.away}%\n- ${s.narrative || ""}${paid}`;
  }
  if (tool === "settle_match") {
    const r = result as { hash: string; matchId: number };
    return `Settled market for match **${r.matchId}**. Tx: \`${r.hash}\``;
  }
  return JSON.stringify(result, null, 2);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "agent",
    llm: Boolean(openai),
    oracle: process.env.ORACLE_ADDRESS || null,
    rewards: process.env.REWARDS_ADDRESS || null,
  });
});

app.post("/chat", async (req, res) => {
  try {
    const messages = (req.body?.messages || []) as Array<{
      role: string;
      content: string;
    }>;
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const trace: Array<{ tool: string; args: unknown; result: unknown; ms: number }> = [];

    // Deterministic path for demo reliability
    const routed = regexRoute(lastUser);
    if (routed && (!openai || process.env.FORCE_DETERMINISTIC === "1" || /latest event|premium stats|settle the|all goals|list events/i.test(lastUser))) {
      try {
        const { result, ms } = await runTool(routed.tool, { matchId: routed.matchId });
        trace.push({ tool: routed.tool, args: { matchId: routed.matchId }, result, ms });
        return res.json({
          answer: formatAnswer(routed.tool, result),
          trace,
          mode: "deterministic",
        });
      } catch (e) {
        // fall through to LLM or error message
        if (!openai) {
          return res.json({
            answer: `Tool ${routed.tool} failed: ${e instanceof Error ? e.message : e}. Ensure contracts are deployed and env is set.`,
            trace,
            mode: "deterministic-error",
          });
        }
      }
    }

    if (!openai) {
      if (routed) {
        try {
          const { result, ms } = await runTool(routed.tool, { matchId: routed.matchId });
          trace.push({ tool: routed.tool, args: { matchId: routed.matchId }, result, ms });
          return res.json({
            answer: formatAnswer(routed.tool, result),
            trace,
            mode: "deterministic",
          });
        } catch (e) {
          return res.status(500).json({
            error: e instanceof Error ? e.message : String(e),
            hint: "Set OPENAI_API_KEY or ensure ORACLE_ADDRESS + keys for tools",
          });
        }
      }
      return res.json({
        answer:
          "I'm CupAgent. Try: \"What was the latest event in match 2026001?\", \"Get premium stats for match 2026001\", or \"Settle the market for match 2026001\". (OPENAI_API_KEY not set — using deterministic routing.)",
        trace: [],
        mode: "help",
      });
    }

    type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
    const convo: Msg[] = [
      {
        role: "system",
        content:
          "You are CupAgent, an AI assistant with MCP tools that read live World Cup events from an on-chain oracle on Injective EVM, purchase premium data via x402, and settle prediction markets. Always cite the tool result you used. Prefer calling tools over guessing.",
      },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    for (let step = 0; step < 5; step++) {
      const r = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: convo,
        tools: toolSchema,
      });
      const msg = r.choices[0].message;
      convo.push(msg);
      if (!msg.tool_calls?.length) {
        return res.json({ answer: msg.content, trace, mode: "llm" });
      }
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        const args = JSON.parse(tc.function.arguments || "{}") as { matchId: number };
        const { result, ms } = await runTool(tc.function.name, args);
        trace.push({ tool: tc.function.name, args, result, ms });
        convo.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }
    res.json({ answer: "Stopped after 5 tool steps.", trace, mode: "llm" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/x402-demo", async (req, res) => {
  try {
    const matchId = Number(req.body?.matchId || process.env.FIXTURE_ID || 2026001);
    const t0 = Date.now();
    const result = await tools.getPremiumStats({ matchId });
    res.json({ result, ms: Date.now() - t0 });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const port = Number(process.env.AGENT_PORT || "4020");
app.listen(port, () => {
  console.log(`agent chat on :${port} (llm=${Boolean(openai)})`);
});
