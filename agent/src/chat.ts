/**
 * HTTP chat for CupAgent.
 * LLM: Groq (preferred) or OpenAI. Tools resolve fixtures by team name.
 *
 * 9 tools across 4 categories:
 *   1) READ oracle events
 *   2) BUY premium analytics via x402
 *   3) MANAGE fan drops (create, whitelist, check, pay)
 *   4) MANAGE feeder earnings (check, withdraw)
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
  // --- Oracle reads ---
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
  // --- x402 ---
  {
    type: "function",
    function: {
      name: "get_premium_stats",
      description: "Buy premium match analytics via x402. Returns calibrated win probabilities (home/draw/away), most-likely scorelines, expected goals, form, H2H, and a model/provenance block. Use for match previews and outcome predictions",
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "number" },
          query: { type: "string" },
        },
      },
    },
  },
  // --- Fan drops ---
  {
    type: "function",
    function: {
      name: "create_drop",
      description:
        "Create a sponsor-funded fan drop. Sponsor must have approved USDC to the FanDrops contract. Returns dropId.",
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "number", description: "Match/fixture ID" },
          eventType: {
            type: "string",
            enum: ["goal", "card", "sub", "halftime", "final"],
            description: "Oracle event type that triggers the drop",
          },
          minuteFrom: { type: "number", description: "Inclusive start minute for oracle event window" },
          minuteTo: { type: "number", description: "Inclusive end minute for oracle event window" },
          perWinnerAmountUsdc: {
            type: "string",
            description: 'USDC amount as decimal string, e.g. "0.5"',
          },
          maxWinners: { type: "number", description: "Maximum number of winners" },
        },
        required: [
          "matchId",
          "eventType",
          "minuteFrom",
          "minuteTo",
          "perWinnerAmountUsdc",
          "maxWinners",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "whitelist_drop",
      description:
        "Whitelist wallets for an existing fan drop. AGENT_ROLE required.",
      parameters: {
        type: "object",
        properties: {
          dropId: { type: "number", description: "Drop ID" },
          wallets: {
            type: "array",
            items: { type: "string" },
            description: "Array of wallet addresses (0x-prefixed)",
          },
        },
        required: ["dropId", "wallets"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_drop_eligibility",
      description:
        "Check if a wallet is eligible, has already claimed, and whether the oracle event has fired for a drop.",
      parameters: {
        type: "object",
        properties: {
          dropId: { type: "number", description: "Drop ID" },
          wallet: {
            type: "string",
            description: "Wallet address to check (0x-prefixed)",
          },
        },
        required: ["dropId", "wallet"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pay_drop",
      description:
        "Trigger payout for a whitelisted wallet from a drop. Same-chain by default, or specify destinationDomain for CCTP cross-chain.",
      parameters: {
        type: "object",
        properties: {
          dropId: { type: "number", description: "Drop ID" },
          wallet: {
            type: "string",
            description: "Wallet address to receive payout (0x-prefixed)",
          },
          destinationDomain: {
            type: "number",
            description:
              "CCTP destination domain (0=Sepolia). Omit for same-chain Injective.",
          },
        },
        required: ["dropId", "wallet"],
      },
    },
  },
  // --- Feeder marketplace ---
  {
    type: "function",
    function: {
      name: "feeder_earnings",
      description:
        "Check a feeder's earned USDC, event count, and total paid out from the OracleTreasury.",
      parameters: {
        type: "object",
        properties: {
          feeder: {
            type: "string",
            description: "Feeder wallet address (0x-prefixed)",
          },
        },
        required: ["feeder"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "withdraw_feeder_earnings",
      description:
        "Withdraw earned USDC from the OracleTreasury. Same-chain by default, or specify destinationDomain for CCTP cross-chain.",
      parameters: {
        type: "object",
        properties: {
          amount: {
            type: "string",
            description: 'USDC amount as decimal string, e.g. "10.50"',
          },
          destinationDomain: {
            type: "number",
            description:
              "CCTP destination domain (0=Sepolia). Omit for same-chain Injective.",
          },
        },
        required: ["amount"],
      },
    },
  },
  // --- Utility ---
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
  get_premium_stats: "getPremiumStats",
  create_drop: "createDrop",
  whitelist_drop: "whitelistDrop",
  check_drop_eligibility: "checkDropEligibility",
  pay_drop: "payDrop",
  feeder_earnings: "feederEarnings",
  withdraw_feeder_earnings: "withdrawFeederEarnings",
  list_fixtures: "listFixtures",
};

async function resolveArgs(
  args: { matchId?: number; query?: string },
  userText: string
): Promise<{ matchId: number } | null> {
  if (args.matchId != null) return { matchId: args.matchId };
  const id = await resolveMatchId(args.query || userText);
  if (id == null) return null;
  return { matchId: id };
}

async function runTool(
  name: string,
  rawArgs: Record<string, unknown>,
  userText: string,
  wallet?: string
) {
  const t0 = Date.now();

  // list_fixtures is handled inline (no chain call)
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
        score: f.scoreHome != null ? `${f.scoreHome}-${f.scoreAway}` : null,
        kickoffUtc: f.kickoffUtc,
        group: f.group,
      })),
      ms: Date.now() - t0,
    };
  }

  // Tools that need matchId resolution
  const needsMatchId = ["getLatestEvent", "listEvents", "getPremiumStats"];
  const fn = nameMap[name];
  if (!fn || fn === "listFixtures") throw new Error(`unknown tool: ${name}`);

  if (needsMatchId.includes(fn)) {
    const resolved = await resolveArgs(
      rawArgs as { matchId?: number; query?: string },
      userText
    );
    if (!resolved) {
      return {
        result: {
          _error: "no_fixture",
          message:
            "I couldn't find a match matching those team names. Try asking for 'list fixtures' first, or use team names from the fixture list.",
        },
        ms: Date.now() - t0,
      };
    }
    const { matchId } = resolved;
    const raw = await (tools as any)[fn]({ matchId });
    const result = Array.isArray(raw)
      ? { events: raw, _fixture: labelFor(matchId) }
      : { ...raw, _fixture: labelFor(matchId) };

    // Auto-whitelist user on the match's drop after successful x402 premium purchase
    if (fn === "getPremiumStats" && (raw as any)?._x402?.paid && wallet) {
      try {
        const dropId = await tools.resolveDropId(matchId);
        if (dropId != null) {
          await (tools as any).whitelistDrop({ dropId, wallets: [wallet] });
          result._whitelisted = true;
          result._dropId = dropId;
          result._autoWhitelistMsg = `You've been whitelisted for Drop #${dropId} — go to the Rewards tab to claim!`;
        } else {
          console.warn(`No active drop found for matchId ${matchId}`);
        }
      } catch (e) {
        console.warn("Auto-whitelist failed:", e);
      }
    }

    return { result, ms: Date.now() - t0, matchId };
  }

  // Tools that accept raw args directly (drops, feeder earnings)
  const raw = await (tools as any)[fn](rawArgs);
  const result =
    typeof raw === "object" && raw !== null
      ? { ...raw, _fixture: rawArgs.matchId ? labelFor(rawArgs.matchId as number) : undefined }
      : raw;
  return { result, ms: Date.now() - t0 };
}

function regexRoute(text: string): { tool: string; status?: string } | null {
  const lower = text.toLowerCase();
  // Feeder queries
  if (/feeder\s*earnings|how\s+much.*earned|feeder\s*stats/.test(lower)) {
    return { tool: "feeder_earnings" };
  }
  if (/withdraw.*earnings|withdraw.*feeder|cctp.*withdraw/.test(lower)) {
    return { tool: "withdraw_feeder_earnings" };
  }
  // Drop queries
  if (/create.*drop|create.*fan.*drop|sponsor.*drop/.test(lower)) {
    return { tool: "create_drop" };
  }
  if (/whitelist|add.*wallet|add.*wallets/.test(lower)) {
    return { tool: "whitelist_drop" };
  }
  if (/check.*eligib|am.*i.*eligible|can.*i.*claim/.test(lower)) {
    return { tool: "check_drop_eligibility" };
  }
  if (/pay.*drop|payout|claim.*drop/.test(lower)) {
    return { tool: "pay_drop" };
  }
  // Existing routes (unchanged)
  if (/fixtures|schedule|upcoming|which matches|finished/.test(lower)) {
    return { tool: "list_fixtures", status: /finished/.test(lower) ? "FT" : undefined };
  }
  if (/premium|x402|stats|analytics|xg|predictions?|predict/.test(lower)) {
    return { tool: "get_premium_stats" };
  }
  if (/all\s+(events|goals)|list\s+events|show\s+me\s+all/.test(lower)) {
    return { tool: "list_events" };
  }
  if (/latest|last\s+event|what\s+happened|score|goal|live/.test(lower)) {
    return { tool: "get_latest_event" };
  }
  return null;
}

function formatAnswer(tool: string, result: unknown): string {
  const r = result as Record<string, unknown> | undefined;

  if (r?._error === "no_fixture") {
    return r.message as string;
  }
  if (r?._error === "no_events") {
    const fixture = (r._fixture as string) || `match ${r.matchId}`;
    return `**${fixture}** has no events on-chain yet.${
      r.message ? ` ${r.message}` : ""
    } Try asking for 'list fixtures' to see which matches are live.`;
  }
  if (r?._error === "x402_failed" || r?._error === "x402") {
    return (
      `💳 **x402 payment step** (this is not an agent outage).\n\n` +
      `${r.message || "Payment required."}\n\n` +
      `_HTTP 402 = Payment Required — the paywall is working on Injective._ ` +
      `For demos without Circle USDC, set \`X402_MODE=demo\` on the x402 service and restart it.`
    );
  }
  if (r?._error === "analytics_unavailable") {
    return (
      `💳 **Payment processed**, but premium analytics are temporarily unavailable.\n\n` +
      `${r.message || "The feeder could not be reached."} No data was fabricated — please retry shortly.`
    );
  }

  switch (tool) {
    case "list_fixtures": {
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
    case "get_latest_event": {
      const e = result as {
        minute: number;
        eventType: string;
        details: string;
        _fixture?: string;
      };
      return `Latest on-chain event for **${e._fixture || "fixture"}**: **${e.eventType}** at minute ${e.minute}.\nDetails: \`${e.details}\``;
    }
    case "list_events": {
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
    case "get_premium_stats": {
      const s = result as Record<string, unknown>;
      const xg = s.xg as { home?: number; away?: number } | undefined;
      const possession = s.possession as
        | { home?: number; away?: number }
        | undefined;
      const shots = s.shots as { home?: number; away?: number } | undefined;
      const form = s.form as { home?: string; away?: string } | undefined;
      const prediction = s.prediction as
        | { winner?: string; confidence?: string; reasoning?: string }
        | undefined;
      const h2h = s.h2h as string | undefined;
      const score = s.score as { home?: number; away?: number } | undefined;
      const status = s.status as string | undefined;
      const x402 = s._x402 as
        | {
            paid?: boolean;
            protocol?: string;
            network?: string;
            transaction?: string;
            chainId?: number;
          }
        | undefined;
      const explorer =
        process.env.INJ_EVM_EXPLORER ||
        "https://testnet.blockscout.injective.network";
      const homeName = (s.home as string) || "Home";
      const awayName = (s.away as string) || "Away";
      const fixtureName =
        (s._fixture as string) || `${homeName} vs ${awayName}`;
      const statusEmoji =
        status === "FT"
          ? "🏁"
          : status === "LIVE" || status === "HT"
            ? "🔴"
            : "📋";
      const predEmoji =
        prediction?.confidence === "high"
          ? "⭐"
          : prediction?.confidence === "medium"
            ? "⚡"
            : "🤝";

      let lines = `**${fixtureName}** ${statusEmoji} ${status || ""}`;
      if (score && (score.home != null || score.away != null)) {
        lines += `\n📊 Score: ${homeName} **${score.home ?? 0}** – **${score.away ?? 0}** ${awayName}`;
      }
      if (xg)
        lines += `\n🎯 xG: ${homeName} **${xg.home ?? "?"}** – **${xg.away ?? "?"}** ${awayName}`;
      if (shots)
        lines += `\n🥅 Shots: ${homeName} **${shots.home ?? "?"}** – **${shots.away ?? "?"}** ${awayName}`;
      if (possession)
        lines += `\n⚽ Possession: ${homeName} **${possession.home ?? "?"}%** – **${possession.away ?? "?"}%** ${awayName}`;
      if (form)
        lines += `\n📈 Form: ${homeName} **${form.home || "—"}** — ${awayName} **${form.away || "—"}**`;
      if (h2h) lines += `\n🔄 H2H: ${h2h}`;
      if (prediction?.winner) {
        lines += `\n${predEmoji} Prediction: **${prediction.winner}** (${prediction.confidence || ""})`;
        if (prediction.reasoning) lines += ` — ${prediction.reasoning}`;
      }

      let paid = "";
      if (s._paid || x402?.paid) {
        paid = `\n\n💳 **x402**: premium data paid autonomously${
          x402?.protocol ? ` (${x402.protocol})` : ""
        }${x402?.network ? ` on ${x402.network}` : " on Injective"}.`;
        if (x402?.transaction && String(x402.transaction).startsWith("0x")) {
          const txHash = String(x402.transaction);
          const shortTx = `${txHash.slice(0, 10)}…${txHash.slice(-6)}`;
          const txUrl = `${explorer}/tx/${txHash}`;
          paid += `\n🔗 **Settle tx:** [${shortTx}](${txUrl})`;
        } else if (String(x402?.protocol || "").includes("demo")) {
          paid +=
            "\n_Note: demo-eip712 is signature-only (not a USDC transfer on explorer). Use official mode for verifiable settle._";
        }
      }
      const rewardMsg = s._autoWhitelistMsg as string | undefined;
      return lines + paid + (rewardMsg ? `\n\n🎁 ${rewardMsg}` : "");
    }
    case "create_drop": {
      const d = result as { dropId?: number; txHash?: string; totalFunded?: string };
      return `✅ **Drop created!**\nDrop ID: **${d.dropId}**\nFunded: **${d.totalFunded}**\nTx: \`${d.txHash}\``;
    }
    case "whitelist_drop": {
      const w = result as { walletsWhitelisted?: number; txHash?: string };
      return `✅ **Whitelist successful** — ${w.walletsWhitelisted} wallet(s) added.\nTx: \`${w.txHash}\``;
    }
    case "check_drop_eligibility": {
      const c = result as {
        eligible?: boolean;
        alreadyClaimed?: boolean;
        oracleReady?: boolean;
        active?: boolean;
        perWinnerAmount?: string;
      };
      const status = c.active ? "🟢 Active" : "🔴 Inactive";
      const elig = c.eligible ? "✅ Eligible" : "❌ Not eligible";
      const claimed = c.alreadyClaimed ? "✅ Already claimed" : "❌ Not claimed yet";
      const oracle = c.oracleReady ? "✅ Oracle event has fired" : "⏳ Oracle event not yet fired";
      return `**Drop eligibility check:**\n${status}\n${elig}\n${claimed}\n${oracle}\nPer-winner: **${c.perWinnerAmount}**`;
    }
    case "pay_drop": {
      const p = result as { txHash?: string; crossChain?: boolean; destinationDomain?: number };
      const mode = p.crossChain ? `cross-chain (domain ${p.destinationDomain})` : "same-chain";
      return `✅ **Payout triggered!**\nMode: ${mode}\nTx: \`${p.txHash}\``;
    }
    case "feeder_earnings": {
      const f = result as {
        earnedUsdc?: string;
        eventCount?: number;
        totalPaid?: string;
      };
      return `**Feeder earnings:**\nEarned: **${f.earnedUsdc} USDC**\nEvents submitted: **${f.eventCount}**\nTotal withdrawn: **${f.totalPaid} USDC**`;
    }
    case "withdraw_feeder_earnings": {
      const w = result as { txHash?: string; crossChain?: boolean; cctpNonce?: string };
      return `✅ **Withdrawal complete!**\nMode: ${w.crossChain ? "Cross-chain" : "Same-chain"}\nTx: \`${w.txHash}\``;
    }
    default:
      return JSON.stringify(result, null, 2);
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "agent",
    llm: llmProvider,
    model: llm ? llmModel : null,
    oracle: process.env.ORACLE_ADDRESS || null,
    treasury: process.env.TREASURY_ADDRESS || null,
    drops: process.env.DROPS_ADDRESS || null,
  });
});

app.get("/fixtures", async (_req, res) => {
  try {
    const fixtures = await loadFixtures(true);
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
    const userWallet = (req.body?.wallet || "") as string;
    const lastUser =
      [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const trace: Array<{
      tool: string;
      args: unknown;
      result: unknown;
      ms: number;
    }> = [];

    // Simple greetings
    if (/^(hi|hello|hey|yo|sup)\b/i.test(lastUser.trim())) {
      return res.json({
        answer:
          "Hello! I'm CupAgent. Ask about a World Cup fixture by **team names**, create **fan drops**, check **feeder earnings**, or buy **premium stats** via x402.",
        trace: [],
        mode: "greeting",
        llm: llmProvider,
      });
    }

    const routed = regexRoute(lastUser);
    const useDet =
      !llm ||
      process.env.FORCE_DETERMINISTIC === "1" ||
      /latest event|premium stats|all goals|list events|fixtures|schedule|finished|live|predictions?|predict|create.*drop|whitelist|feeder.*earnings|withdraw.*earnings/i.test(
        lastUser
      );

    if (routed && useDet) {
      try {
        const detArgs = routed.status ? { status: routed.status } : {};
        const { result, ms } = await runTool(routed.tool, detArgs, lastUser, userWallet);
        trace.push({ tool: routed.tool, args: detArgs, result, ms });
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
          "I'm CupAgent. I can:\n- Read on-chain events (\"latest event for Mexico vs South Africa\")\n- Buy premium stats (\"premium stats for France\")\n- Create fan drops (\"create a drop: 0.5 USDC each to first 20 wallets when Argentina scores\")\n- Check feeder earnings (\"how much have I earned as a feeder?\")\n- List fixtures (\"list fixtures\")\n\nSet **GROQ_API_KEY** for natural language LLM replies.",
        trace: [],
        mode: "help",
      });
    }

    type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
    const convo: Msg[] = [
      {
        role: "system",
        content:
          "You are CupAgent on Injective. You have four categories of tools:\n" +
          "1) READ oracle events (get_latest_event, list_events).\n" +
          "2) BUY premium analytics from a paywalled endpoint via x402 (get_premium_stats).\n" +
          "3) MANAGE fan drops sponsored by brands (create_drop, whitelist_drop, check_drop_eligibility, pay_drop).\n" +
          "4) MANAGE feeder earnings from the oracle data marketplace (feeder_earnings, withdraw_feeder_earnings).\n\n" +
          "Never invent match IDs — always ask the user or use list_events to discover them. " +
          "When paying drops or withdrawing earnings, ask the user which destination chain they want " +
          "(Injective same-chain, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, or Avalanche Fuji). " +
          "CCTP destination domain numbers: Injective=29 (same-chain), Ethereum Sepolia=0, Base Sepolia=6, Arbitrum Sepolia=2, Avalanche Fuji=1. " +
          "If they don't specify, default to same-chain (29).\n\n" +
"PREMIUM ANALYTICS - how to interpret get_premium_stats output:\n" +
"The tool returns a probabilistic match model (Poisson/Dixon-Coles). Always lean on these fields when writing a preview:\n" +
"  - probabilities: { home, draw, away } - calibrated three-way win probabilities (0..1). Lead with these.\n" +
"  - scorelines: top 5 most-likely scorelines with probabilities. Mention the top 1-2.\n" +
"  - expectedGoals: { home, away } - the model's expected goals (xG).\n" +
"  - prediction.winner + confidence - derived from the probabilities; do not contradict it.\n" +
"  - model.inputs + model.dataCoverage - what data drove the prediction (elo-prior, api-football-history, world-cup-form, head-to-head, oracle-events). Cite this so the user knows the basis.\n" +
"  - form, h2h, narrative - supporting qualitative context.\n" +
"Do NOT just repeat a winner label. Give the three-way odds, the likeliest scoreline(s), expected goals, and the data coverage. " +
"If model.inputs is only elo-prior (no history, no WC form), say confidence is lower and the prediction is prior-based. " +
"For LIVE matches, probabilities are live win probabilities conditioned on the current score and minute.",
      },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    for (let step = 0; step < 5; step++) {
      let r;
      try {
        r = await llm.chat.completions.create({
          model: llmModel,
          messages: convo,
          tools: toolSchema,
        });
      } catch (llmErr) {
        const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
        return res.json({
          answer:
            `I encountered an issue contacting the LLM (${msg}). Try a more specific query like "list fixtures" or "latest event for England vs France" — I can handle those without the LLM.`,
          trace: sanitizeTrace(trace),
          mode: "llm-error",
          llm: llmProvider,
        });
      }
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
        const { result, ms } = await runTool(tc.function.name, args, lastUser, userWallet);
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

/** Remove sensitive fields from traces shown to frontend */
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

app.post("/x402-premium", async (req, res) => {
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

app.post("/api/whitelist", async (req, res) => {
  try {
    const wallet = req.body?.wallet || req.body?.address;
    if (!wallet) throw new Error("wallet/address required");

    let dropId = req.body?.dropId;
    let created = false;
    // Resolve dropId from matchId when only a match is given (x402 page flow).
    if ((dropId === undefined || dropId === null) && req.body?.matchId != null) {
      const matchId = Number(req.body.matchId);
      dropId = await tools.resolveDropId(matchId);

      // No drop for this match yet — auto-create a small sponsor-funded drop so
      // the pay -> whitelist -> claim flow works for ANY match, then whitelist.
      if (dropId === null || dropId === undefined) {
        console.log(`[whitelist] no drop for match ${matchId}; auto-creating…`);
        const drop = await tools.createDrop({
          matchId,
          eventType: "goal",
          minuteFrom: 1,
          minuteTo: 120,
          perWinnerAmountUsdc: process.env.AUTO_DROP_AMOUNT_USDC || "0.02",
          maxWinners: Number(process.env.AUTO_DROP_MAX_WINNERS || "20"),
        });
        dropId = drop.dropId;
        created = true;
        console.log(
          `[whitelist] created Drop #${dropId} for match ${matchId} (${drop.totalFunded})`
        );
      }
    }
    if (dropId === undefined || dropId === null)
      throw new Error("dropId or matchId required");

    const result = await tools.whitelistDrop({ dropId, wallets: [wallet] });
    res.json({ ...result, dropId, created });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const port = Number(process.env.AGENT_PORT || "4020");
app.listen(port, () => {
  console.log(`agent chat on :${port} (llm=${llmProvider} model=${llmModel})`);
});
