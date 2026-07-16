/**
 * HTTP chat for CupAgent.
 * LLM: Groq (preferred) or OpenAI. Tools resolve fixtures by team name.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import express from "express";
import cors from "cors";
import { tools } from "./tools.js";
import { loadFixtures, resolveMatchId, labelFor } from "./fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

function makeClient(): OpenAI | null {
  if (process.env.GROQ_API_KEY) {
    return new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  if (process.env.OPENAI_API_KEY) {
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return null;
}

const llm = makeClient();
const llmModel =
  process.env.GROQ_API_KEY
    ? process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
    : process.env.OPENAI_MODEL || "gpt-4o-mini";
const llmProvider = process.env.GROQ_API_KEY
  ? "groq"
  : process.env.OPENAI_API_KEY
    ? "openai"
    : "none";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const toolSchema: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_latest_event",
      description:
        "Latest on-chain oracle event for a fixture. Prefer resolving from team names; matchId is internal.",
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "number", description: "Internal fixture id" },
          query: { type: "string", description: "e.g. Mexico vs South Africa" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_events",
      description: "All on-chain events for a fixture",
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "number" },
          query: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "settle_match",
      description: "Settle prediction market after full-time is on-chain",
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "number" },
          query: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_premium_stats",
      description: "Buy premium analytics via x402 for a fixture",
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "number" },
          query: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_fixtures",
      description: "List World Cup fixtures (labels only for the user)",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "optional filter: LIVE, FT, NS",
          },
        },
      },
    },
  },
];

const nameMap: Record<string, keyof typeof tools | "listFixtures"> = {
  get_latest_event: "getLatestEvent",
  list_events: "listEvents",
  settle_match: "settleMatch",
  get_premium_stats: "getPremiumStats",
  list_fixtures: "listFixtures",
};

async function resolveArgs(
  args: { matchId?: number; query?: string },
  userText: string
): Promise<{ matchId: number }> {
  if (args.matchId != null) return { matchId: args.matchId };
  const id = await resolveMatchId(args.query || userText);
  if (id == null) throw new Error("Could not resolve fixture from message");
  return { matchId: id };
}

async function runTool(
  name: string,
  rawArgs: Record<string, unknown>,
  userText: string
) {
  const t0 = Date.now();
  if (name === "list_fixtures") {
    const fixtures = await loadFixtures(true);
    const status = rawArgs.status as string | undefined;
    const list = status
      ? fixtures.filter((f) => f.status === status)
      : fixtures.slice(0, 40);
    return {
      result: list.map((f) => ({
        label: f.label,
        status: f.status,
        score:
          f.scoreHome != null ? `${f.scoreHome}-${f.scoreAway}` : null,
        kickoffUtc: f.kickoffUtc,
        group: f.group,
      })),
      ms: Date.now() - t0,
    };
  }
  const fn = nameMap[name];
  if (!fn || fn === "listFixtures") throw new Error(`unknown tool: ${name}`);
  const { matchId } = await resolveArgs(
    rawArgs as { matchId?: number; query?: string },
    userText
  );
  const raw = await (tools as any)[fn]({ matchId });
  const result = Array.isArray(raw)
    ? { events: raw, _fixture: labelFor(matchId) }
    : { ...raw, _fixture: labelFor(matchId) };
  return {
    result,
    ms: Date.now() - t0,
    matchId,
  };
}

function regexRoute(text: string): { tool: string } | null {
  const lower = text.toLowerCase();
  if (/fixtures|schedule|upcoming|which matches/.test(lower)) {
    return { tool: "list_fixtures" };
  }
  if (/premium|x402|stats|analytics|xg/.test(lower)) {
    return { tool: "get_premium_stats" };
  }
  if (/settle/.test(lower)) return { tool: "settle_match" };
  if (/all\s+(events|goals)|list\s+events|show\s+me\s+all/.test(lower)) {
    return { tool: "list_events" };
  }
  if (/latest|last\s+event|what\s+happened|score|goal/.test(lower)) {
    return { tool: "get_latest_event" };
  }
  return null;
}

function formatAnswer(tool: string, result: unknown): string {
  if (tool === "list_fixtures") {
    const arr = result as Array<{
      label: string;
      status: string;
      score: string | null;
    }>;
    const lines = arr
      .slice(0, 15)
      .map(
        (f) =>
          `• **${f.label}** — ${f.status}${f.score ? ` (${f.score})` : ""}`
      );
    return `Fixtures (sample):\n${lines.join("\n")}`;
  }
  if (tool === "get_latest_event") {
    const e = result as {
      minute: number;
      eventType: string;
      details: string;
      _fixture?: string;
    };
    return `Latest on-chain event for **${e._fixture || "fixture"}**: **${e.eventType}** at minute ${e.minute}.\nDetails: \`${e.details}\``;
  }
  if (tool === "list_events") {
    const wrapped = result as {
      events?: Array<{ minute: number; eventType: string; details: string }>;
      _fixture?: string;
    };
    const arr = wrapped.events || [];
    const lines = arr.map(
      (e) => `- min ${e.minute}: **${e.eventType}** — ${e.details}`
    );
    return `On-chain events for **${wrapped._fixture || "fixture"}**:\n${lines.join("\n") || "(none yet)"}`;
  }
  if (tool === "get_premium_stats") {
    const s = result as {
      xg?: { home: number; away: number };
      possession?: { home: number; away: number };
      _x402?: { paid: boolean; amount: string };
      narrative?: string;
      _fixture?: string;
    };
    const paid = s._x402
      ? `\n\n💳 **x402**: paid ${Number(s._x402.amount) / 1e6} USDC (verified).`
      : "";
    return `Premium analytics for **${s._fixture || "fixture"}**:\n- xG: ${s.xg?.home} – ${s.xg?.away}\n- Possession: ${s.possession?.home}% – ${s.possession?.away}%\n- ${s.narrative || ""}${paid}`;
  }
  if (tool === "settle_match") {
    const r = result as { hash: string; _fixture?: string };
    return `Settled **${r._fixture || "market"}**. Tx: \`${r.hash}\``;
  }
  return JSON.stringify(result, null, 2);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "agent",
    llm: llmProvider,
    model: llm ? llmModel : null,
    oracle: process.env.ORACLE_ADDRESS || null,
    rewards: process.env.REWARDS_ADDRESS || null,
  });
});

app.get("/fixtures", async (_req, res) => {
  try {
    const fixtures = await loadFixtures(true);
    // Strip raw ids from optional strict mode
    res.json({
      fixtures: fixtures.map(({ id, ...rest }) =>
        process.env.HIDE_FIXTURE_IDS === "1" ? rest : { id, ...rest }
      ),
      provider: "feeder",
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const messages = (req.body?.messages || []) as Array<{
      role: string;
      content: string;
    }>;
    const lastUser =
      [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const trace: Array<{
      tool: string;
      args: unknown;
      result: unknown;
      ms: number;
    }> = [];

    const routed = regexRoute(lastUser);
    const useDet =
      !llm ||
      process.env.FORCE_DETERMINISTIC === "1" ||
      /latest event|premium stats|settle|all goals|list events|fixtures|schedule/i.test(
        lastUser
      );

    if (routed && useDet) {
      try {
        const { result, ms } = await runTool(routed.tool, {}, lastUser);
        trace.push({ tool: routed.tool, args: {}, result, ms });
        return res.json({
          answer: formatAnswer(routed.tool, result),
          trace: sanitizeTrace(trace),
          mode: "deterministic",
          llm: llmProvider,
        });
      } catch (e) {
        if (!llm) {
          return res.json({
            answer: `Could not run ${routed.tool}: ${e instanceof Error ? e.message : e}`,
            trace,
            mode: "deterministic-error",
          });
        }
      }
    }

    if (!llm) {
      return res.json({
        answer:
          "I'm CupAgent. Ask about a fixture by **team names** (e.g. \"latest event for Australia vs Turkey\"), \"list fixtures\", or \"premium stats for France\". Set **GROQ_API_KEY** for natural language LLM replies.",
        trace: [],
        mode: "help",
      });
    }

    type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
    const convo: Msg[] = [
      {
        role: "system",
        content:
          "You are CupAgent on Injective. You read the CupEventOracle and can pay for premium stats via x402. Never invent match IDs for the user — talk about teams and scores. Use tools. Prefer list_fixtures then team-name queries.",
      },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    for (let step = 0; step < 5; step++) {
      const r = await llm.chat.completions.create({
        model: llmModel,
        messages: convo,
        tools: toolSchema,
      });
      const msg = r.choices[0].message;
      convo.push(msg);
      if (!msg.tool_calls?.length) {
        return res.json({
          answer: msg.content,
          trace: sanitizeTrace(trace),
          mode: "llm",
          llm: llmProvider,
        });
      }
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        const args = JSON.parse(tc.function.arguments || "{}");
        const { result, ms } = await runTool(tc.function.name, args, lastUser);
        trace.push({ tool: tc.function.name, args, result, ms });
        convo.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }
    res.json({
      answer: "Stopped after 5 tool steps.",
      trace: sanitizeTrace(trace),
      mode: "llm",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Remove raw matchId from traces shown to frontend when possible */
function sanitizeTrace(
  trace: Array<{ tool: string; args: unknown; result: unknown; ms: number }>
) {
  return trace.map((t) => {
    const args = { ...(t.args as object) } as Record<string, unknown>;
    delete args.matchId;
    let result = t.result;
    if (result && typeof result === "object") {
      const r = { ...(result as object) } as Record<string, unknown>;
      delete r.matchId;
      result = r;
    }
    return { ...t, args, result };
  });
}

app.post("/x402-demo", async (req, res) => {
  try {
    const query = String(req.body?.query || req.body?.label || "");
    const matchId =
      (await resolveMatchId(query)) ||
      Number(req.body?.matchId) ||
      (await loadFixtures())[0]?.id;
    if (!matchId) throw new Error("no fixture");
    const t0 = Date.now();
    const result = await tools.getPremiumStats({ matchId });
    res.json({
      result: { ...result, _fixture: labelFor(matchId) },
      ms: Date.now() - t0,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const port = Number(process.env.AGENT_PORT || "4020");
app.listen(port, () => {
  console.log(`agent chat on :${port} (llm=${llmProvider} model=${llmModel})`);
});
