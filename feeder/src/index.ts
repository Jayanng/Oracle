import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config(); // local override
import cors from "cors";
import axios from "axios";
import pRetry from "p-retry";
import pino from "pino";
import { getClients, ORACLE_ABI } from "./chain.js";
import { DEMO_SCRIPT, runSimulator } from "./simulator.js";

const log = pino({
  transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
});

const mode = process.env.FEEDER_MODE || "simulator";
const fixtureId = Number(process.env.FIXTURE_ID || "2026001");
const pushed = new Set<string>();
let lastPushAt = 0;
let status: "idle" | "running" | "error" = "idle";
let lastError: string | null = null;
const recentHashes: string[] = [];

type ApiEvent = {
  id?: string;
  time: { elapsed: number };
  type: string;
  detail: string;
  team: { name: string };
  player?: { name: string };
};

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
  log.info({ hash, type, minute }, "event pushed");
  return hash;
}

async function fetchLiveEvents(id: number): Promise<ApiEvent[]> {
  const API = process.env.SPORTS_API_BASE || "https://v3.football.api-sports.io";
  const KEY = process.env.SPORTS_API_KEY;
  if (!KEY) throw new Error("SPORTS_API_KEY required in live mode");
  const { data } = await axios.get(`${API}/fixtures/events`, {
    params: { fixture: id },
    headers: { "x-apisports-key": KEY },
  });
  return data.response ?? [];
}

async function fetchFixtureStatus(id: number) {
  const API = process.env.SPORTS_API_BASE || "https://v3.football.api-sports.io";
  const KEY = process.env.SPORTS_API_KEY!;
  const { data } = await axios.get(`${API}/fixtures`, {
    params: { id },
    headers: { "x-apisports-key": KEY },
  });
  return data.response?.[0];
}

async function tickLive(id: number) {
  const events = await fetchLiveEvents(id);
  for (const e of events) {
    const uid = `${id}:${e.time.elapsed}:${e.type}:${e.team.name}:${e.player?.name ?? ""}`;
    if (pushed.has(uid)) continue;
    await pushEvent(BigInt(id), e.time.elapsed, e.type.toLowerCase(), {
      team: e.team.name,
      player: e.player?.name,
      detail: e.detail,
    });
    pushed.add(uid);
  }
  const fx = await fetchFixtureStatus(id);
  if (fx?.fixture?.status?.short === "FT") {
    const uid = `${id}:FT`;
    if (!pushed.has(uid)) {
      await pushEvent(BigInt(id), 90, "final", {
        home: fx.goals.home,
        away: fx.goals.away,
      });
      pushed.add(uid);
    }
  }
}

async function runLiveLoop() {
  status = "running";
  log.info({ fixtureId, mode: "live" }, "live feeder started");
  while (true) {
    try {
      await tickLive(fixtureId);
      lastError = null;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      log.error(e);
      status = "error";
    }
    await new Promise((r) => setTimeout(r, 45_000));
  }
}

async function runSimOnce() {
  const { wallet, pub, oracle } = getClients();
  if (!oracle) {
    log.warn("ORACLE_ADDRESS not set — simulator will only log offline");
    status = "running";
    for (const step of DEMO_SCRIPT) {
      log.info({ step }, "offline sim (no oracle)");
      lastPushAt = Date.now();
      await new Promise((r) => setTimeout(r, 5_000));
    }
    return;
  }
  status = "running";
  log.info({ fixtureId, oracle, mode: "simulator" }, "simulator feeder started");
  await runSimulator({
    wallet,
    pub,
    oracle,
    matchId: BigInt(fixtureId),
    intervalMs: Number(process.env.SIM_INTERVAL_MS || "5000"),
    log,
    onEvent: (_e, hash) => {
      recentHashes.unshift(hash);
      if (recentHashes.length > 20) recentHashes.pop();
      lastPushAt = Date.now();
    },
  });
  // loop forever for long-running demos: re-run with new match id offset
  let n = 1;
  while (true) {
    await new Promise((r) => setTimeout(r, 30_000));
    const mid = BigInt(fixtureId + n);
    log.info({ matchId: mid.toString() }, "replaying simulator for new matchId");
    await runSimulator({
      wallet,
      pub,
      oracle,
      matchId: mid,
      intervalMs: Number(process.env.SIM_INTERVAL_MS || "5000"),
      log,
      onEvent: (_e, hash) => {
        recentHashes.unshift(hash);
        if (recentHashes.length > 20) recentHashes.pop();
        lastPushAt = Date.now();
      },
    });
    n++;
  }
}

// Health HTTP
const app = express();
app.use(cors());
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "feeder",
    mode,
    status,
    fixtureId,
    lastPushAt,
    lastError,
    recentHashes: recentHashes.slice(0, 5),
    oracle: process.env.ORACLE_ADDRESS || null,
  });
});
app.get("/script", (_req, res) => res.json({ script: DEMO_SCRIPT }));

const port = Number(process.env.FEEDER_PORT || "4030");
app.listen(port, () => log.info({ port }, "feeder health on"));

async function main() {
  if (mode === "live") await runLiveLoop();
  else await runSimOnce();
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
