import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import pRetry from "p-retry";
import pino from "pino";
import { getClients, ORACLE_ABI } from "./chain.js";
import { getSportsProvider, type Fixture } from "./providers/index.js";

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

/** Public fixture list for UI — no internal matchId field name emphasized */
function publicFixtures() {
  return fixturesCache.map((f) => ({
    id: f.matchId, // kept for API consumers; UI should not display
    label: `${f.home} vs ${f.away}`,
    home: f.home,
    away: f.away,
    homeFlag: f.homeFlag,
    awayFlag: f.awayFlag,
    kickoffUtc: f.kickoffUtc,
    status: f.status,
    scoreHome: f.scoreHome,
    scoreAway: f.scoreAway,
    group: f.group,
    stage: f.stage,
    source: f.source,
  }));
}

async function loop() {
  status = "running";
  log.info({ provider: provider.name }, "feeder started (real fixtures)");
  while (true) {
    try {
      fixturesCache = await provider.listFixtures();
      const active = fixturesCache.filter((f) =>
        ["LIVE", "HT", "FT"].includes(f.status)
      );
      // Prefer live first, then recent FT for catch-up (limit FT batch)
      const live = active.filter((f) => f.status === "LIVE" || f.status === "HT");
      const ft = active
        .filter((f) => f.status === "FT")
        .slice(0, Number(process.env.FEEDER_FT_BATCH || "8"));
      const work = [...live, ...ft];
      if (work.length === 0) {
        log.info(
          { total: fixturesCache.length },
          "no live/FT fixtures yet — idle poll"
        );
      }
      for (const fx of work) {
        try {
          await tickFixture(fx);
        } catch (e) {
          log.error({ err: e, match: fx.home + " vs " + fx.away }, "tick failed");
        }
      }
      lastError = null;
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
    lastPushAt,
    lastError,
    recentHashes: recentHashes.slice(0, 5),
    oracle: process.env.ORACLE_ADDRESS || null,
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

const port = Number(process.env.FEEDER_PORT || "4030");
app.listen(port, () => log.info({ port }, "feeder API on"));

loop().catch((e) => {
  log.error(e);
  process.exit(1);
});
