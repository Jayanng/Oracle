import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import pRetry from "p-retry";
import pino from "pino";
import { getClients, ORACLE_ABI } from "./chain.js";
import { parseAbi } from "viem";
import { getSportsProvider, type Fixture, type MatchEvent } from "./providers/index.js";
import { computePremiumAnalytics } from "./analytics.js";
import { getTeamStrength, type TeamStrength } from "./providers/apiFootballHistory.js";
import { sortFixturesTournamentDesc } from "./providers/sort.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const log = pino({
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty" },
});

const provider = getSportsProvider();
const pushed = new Set<string>();
let lastPushAt = 0;
let status: "idle" | "running" | "error" = "idle";
let lastError: string | null = null;
const recentHashes: string[] = [];
let fixturesCache: Fixture[] = [];
/** Rotate which finished fixtures we catch up so we cover more than one batch. */
let ftCursor = 0;

async function pushEvent(
  matchId: bigint,
  minute: number,
  type: string,
  details: object
) {
  const { wallet, pub, oracle } = getClients();
  if (!oracle) throw new Error("ORACLE_ADDRESS not set");
  const hash = await pRetry(
    () =>
      wallet.writeContract({
        address: oracle,
        abi: ORACLE_ABI,
        functionName: "addEvent",
        args: [matchId, minute, "football", type, JSON.stringify(details)],
      } as any),
    { retries: 3 }
  );
  await pub.waitForTransactionReceipt({ hash });
  lastPushAt = Date.now();
  recentHashes.unshift(hash);
  if (recentHashes.length > 20) recentHashes.pop();
  log.info({ hash, type, minute, matchId: matchId.toString() }, "event pushed");
  return hash;
}

async function tickFixture(fx: Fixture) {
  // Only pull events for live or finished (catch-up)
  if (fx.status !== "LIVE" && fx.status !== "HT" && fx.status !== "FT") return;
  const events = await provider.getEvents(fx.matchId);
  for (const e of events) {
    const uid = `${fx.matchId}:${e.uid}`;
    if (pushed.has(uid)) continue;
    // Do not overwrite final { home: score, away: score } with team names
    await pushEvent(BigInt(fx.matchId), e.minute, e.type, {
      homeTeam: fx.home,
      awayTeam: fx.away,
      ...e.details,
    });
    pushed.add(uid);
  }
}

/** Public fixture list for UI — tournament order: Final → group stage first matchday */
function publicFixtures() {
  return sortFixturesTournamentDesc(fixturesCache).map((f) => ({
    id: f.matchId, // backend only; UI shows label/teams
    label: `${f.home} vs ${f.away}`,
    home: f.home,
    away: f.away,
    homeFlag: f.homeFlag,
    awayFlag: f.awayFlag,
    kickoffUtc: f.kickoffUtc,
    kickoffUtcLabel: f.kickoffUtcLabel || f.kickoffUtc,
    status: f.status,
    scoreHome: f.scoreHome,
    scoreAway: f.scoreAway,
    group: f.group,
    stage: f.stage,
    stageLabel: stageLabel(f),
    source: f.source,
  }));
}

function stageLabel(f: Fixture): string {
  const s = (f.stage || "").toLowerCase();
  if (s === "final") return "Final";
  if (s === "third") return "3rd place";
  if (s === "sf") return "Semi-final";
  if (s === "qf") return "Quarter-final";
  if (s === "r16") return "Round of 16";
  if (s === "r32") return "Round of 32";
  if (s === "group") {
    const id = f.matchId;
    let md = 1;
    if (id >= 25 && id <= 48) md = 2;
    if (id >= 49 && id <= 72) md = 3;
    return `Group ${f.group || "?"} · MD${md}`;
  }
  return f.stage || f.group || "";
}

async function logTreasuryEarnings() {
  const treasury = process.env.TREASURY_ADDRESS;
  if (!treasury) return;
  try {
    const { pub } = getClients();
    const TREASURY_ABI_CHECK = parseAbi([
      "function earnedBy(address feeder) view returns (uint256)",
      "function feederEventCount(address feeder) view returns (uint256)",
      "function totalRevenue() view returns (uint256)",
    ]);
    const { account } = getClients();
    const earned = await pub.readContract({
      address: treasury as `0x${string}`,
      abi: TREASURY_ABI_CHECK,
      functionName: "earnedBy",
      args: [account.address],
    });
    const eventCount = await pub.readContract({
      address: treasury as `0x${string}`,
      abi: TREASURY_ABI_CHECK,
      functionName: "feederEventCount",
      args: [account.address],
    });
    log.info(
      { earned: Number(earned) / 1e6, eventCount: Number(eventCount) },
      "treasury earnings at startup"
    );
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : e }, "could not read treasury earnings");
  }
}

async function loop() {
  status = "running";
  await logTreasuryEarnings();
  log.info({ provider: provider.name }, "feeder started (real fixtures)");
  while (true) {
    try {
      try {
        fixturesCache = await provider.listFixtures();
      } catch (e) {
        // Keep processing last good fixture list if provider is briefly down
        if (!fixturesCache.length) throw e;
        lastError = e instanceof Error ? e.message : String(e);
        log.warn(
          { err: lastError, cached: fixturesCache.length },
          "listFixtures failed — using cached fixtures"
        );
      }

      const active = fixturesCache.filter((f) =>
        ["LIVE", "HT", "FT"].includes(f.status)
      );
      // Prefer live first, then rotate FT catch-up so more than 8 matches get on-chain
      const live = active.filter((f) => f.status === "LIVE" || f.status === "HT");
      const allFt = active.filter((f) => f.status === "FT");
      const batch = Math.max(1, Number(process.env.FEEDER_FT_BATCH || "12"));
      const ft =
        allFt.length === 0
          ? []
          : Array.from({ length: Math.min(batch, allFt.length) }, (_, i) => {
              return allFt[(ftCursor + i) % allFt.length];
            });
      if (allFt.length > 0) {
        ftCursor = (ftCursor + batch) % allFt.length;
      }
      const work = [...live, ...ft];
      if (work.length === 0) {
        log.info(
          { total: fixturesCache.length },
          "no live/FT fixtures yet — idle poll"
        );
      } else {
        log.info(
          {
            live: live.length,
            ftBatch: ft.length,
            ftTotal: allFt.length,
            sample: work.slice(0, 3).map((w) => `${w.home} vs ${w.away}`),
          },
          "feeder tick batch"
        );
      }

      // Markets are no longer opened automatically — the old prediction market
      // has been replaced by FanDrops + OracleTreasury.

      for (const fx of work) {
        try {
          await tickFixture(fx);
        } catch (e) {
          log.error({ err: e, match: fx.home + " vs " + fx.away }, "tick failed");
        }
      }
      lastError = null;
      status = "running";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      status = "error";
      log.error(e);
    }
    await new Promise((r) =>
      setTimeout(r, Number(process.env.FEEDER_POLL_MS || "45000"))
    );
  }
}

const app = express();
app.use(cors());
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "feeder",
    provider: provider.name,
    status,
    fixtures: fixturesCache.length,
    drops: process.env.DROPS_ADDRESS || null,
    lastPushAt,
    lastError,
    recentHashes: recentHashes.slice(0, 5),
    oracle: process.env.ORACLE_ADDRESS || null,
    treasury: process.env.TREASURY_ADDRESS || null,
  });
});

app.get("/fixtures", async (_req, res) => {
  try {
    if (!fixturesCache.length) fixturesCache = await provider.listFixtures();
    res.json({ fixtures: publicFixtures(), provider: provider.name });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/fixtures/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const fx = await provider.getFixture(id);
    if (!fx) return res.status(404).json({ error: "not found" });
    const events = await provider.getEvents(id);
    res.json({
      fixture: publicFixtures().find((f) => f.id === id) || {
        ...fx,
        id: fx.matchId,
        label: `${fx.home} vs ${fx.away}`,
      },
      events: events.map((e) => ({
        minute: e.minute,
        type: e.type,
        details: e.details,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/premium-stats/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const fx = await provider.getFixture(id);
    if (!fx) return res.status(404).json({ error: "not found" });
    const events = await provider.getEvents(id);
    const allFixtures = fixturesCache.length ? fixturesCache : await provider.listFixtures();
    const sortedFixtures = sortFixturesTournamentDesc(allFixtures);

    // Oracle-native goal timeline: prefer on-chain verified events when the
    // oracle contract is configured. Best-effort - never breaks the endpoint.
    let oracleEvents: MatchEvent[] = [];
    const oracleAddr = process.env.ORACLE_ADDRESS as `0x${string}` | undefined;
    if (oracleAddr) {
      try {
        const { pub } = getClients();
        const READ_ORACLE_ABI = parseAbi([
          "function getEvents(uint256) view returns ((uint256,uint64,uint32,string,string,string,address)[])",
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (await pub.readContract({
          address: oracleAddr,
          abi: READ_ORACLE_ABI,
          functionName: "getEvents",
          args: [BigInt(id)],
        } as any)) as Array<
          [bigint, bigint, number, string, string, string, `0x${string}`]
        >;
        oracleEvents = rows
          .filter((r) => r[4] === "goal")
          .map((r) => {
            let details: Record<string, unknown> = {};
            try {
              details = JSON.parse(r[5] || "{}");
            } catch {
              details = {};
            }
            return {
              uid: `oracle:goal:${id}:${r[2]}`,
              minute: r[2],
              type: "goal",
              details,
            };
          });
      } catch (e) {
        log.warn(
          { err: e instanceof Error ? e.message : e },
          "oracle read skipped"
        );
      }
    }

    // Best-effort api-football historical enrichment (free-plan safe: cached,
    // budget-guarded, never throws). Falls back to null -> engine uses Elo prior.
    let historyHome: TeamStrength | null = null;
    let historyAway: TeamStrength | null = null;
    if (process.env.SPORTS_API_KEY) {
      try {
        [historyHome, historyAway] = await Promise.all([
          getTeamStrength(fx.home),
          getTeamStrength(fx.away),
        ]);
        if (historyHome || historyAway) {
          log.info(
            { home: historyHome?.sample, away: historyAway?.sample },
            "api-football history enriched"
          );
        }
      } catch (e) {
        log.warn(
          { err: e instanceof Error ? e.message : e },
          "api-football history skipped"
        );
      }
    }

    const stats = computePremiumAnalytics({
      fx,
      events,
      oracleEvents,
      allFixtures: sortedFixtures,
      historyHome,
      historyAway,
    });
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
const port = Number(process.env.FEEDER_PORT || "4030");
app.listen(port, () => log.info({ port }, "feeder API on"));

loop().catch((e) => {
  log.error(e);
  process.exit(1);
});
