import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import pRetry from "p-retry";
import pino from "pino";
import { getClients, ORACLE_ABI, REWARDS_ABI } from "./chain.js";
import { getSportsProvider, type Fixture } from "./providers/index.js";
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

/** Fixtures we've already opened a market for — avoids redundant calls. */
const openedMarkets = new Set<number>();
let settlerGranted = false;

/**
 * Ensure a prediction market is open on CupRewards for a fixture.
 * - Grants SETTLER_ROLE to the feeder wallet once (idempotent)
 * - Calls openMarket(matchId, closesAt=kickoff) for any fixture not yet opened
 * - closesAt is set to the fixture kickoff time so the market auto-locks at kickoff
 */
async function ensureMarketOpen(fx: Fixture) {
  const { wallet, pub, account, rewards } = getClients();
  if (!rewards) return;

  // Grant SETTLER_ROLE to self once
  if (!settlerGranted) {
    try {
      const hasRole = (await pub.readContract({
        address: rewards,
        abi: REWARDS_ABI,
        functionName: "hasRole",
        args: [
          (await pub.readContract({
            address: rewards,
            abi: REWARDS_ABI,
            functionName: "SETTLER_ROLE",
          })) as `0x${string}`,
          account.address,
        ],
      })) as boolean;
      if (!hasRole) {
        const h = await wallet.writeContract({
          address: rewards,
          abi: REWARDS_ABI,
          functionName: "grantRole",
          args: [
            (await pub.readContract({
              address: rewards,
              abi: REWARDS_ABI,
              functionName: "SETTLER_ROLE",
            })) as `0x${string}`,
            account.address,
          ],
        } as any);
        await pub.waitForTransactionReceipt({ hash: h });
        log.info({ hash: h, account: account.address }, "granted SETTLER_ROLE to feeder");
      }
      settlerGranted = true;
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : e }, "could not grant SETTLER_ROLE");
      return;
    }
  }

  if (openedMarkets.has(fx.matchId)) return;

  // Check if a market already exists on-chain
  let existing: bigint = 0n;
  try {
    const m = (await pub.readContract({
      address: rewards,
      abi: REWARDS_ABI,
      functionName: "markets",
      args: [BigInt(fx.matchId)],
    })) as readonly [bigint, bigint, number, bigint, bigint, bigint, boolean];
    existing = m[1]; // closesAt
  } catch {
    /* ignore — will try to open */
  }
  if (existing > 0n) {
    openedMarkets.add(fx.matchId);
    return;
  }

  // closesAt = fixture kickoff time. Market auto-locks at kickoff.
  let closesAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  if (fx.kickoffUtc) {
    const ts = Date.parse(fx.kickoffUtc);
    if (!Number.isNaN(ts)) {
      closesAt = Math.floor(ts / 1000);
    }
  }

  try {
    const hash = await wallet.writeContract({
      address: rewards,
      abi: REWARDS_ABI,
      functionName: "openMarket",
      args: [BigInt(fx.matchId), BigInt(closesAt)],
    } as any);
    await pub.waitForTransactionReceipt({ hash });
    openedMarkets.add(fx.matchId);
    log.info({ hash, matchId: fx.matchId, closesAt }, "market opened");
  } catch (e) {
    log.warn({ err: e instanceof Error ? e.message : e, matchId: fx.matchId }, "openMarket failed");
  }
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

async function loop() {
  status = "running";
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

      // Open prediction markets only for UPCOMING fixtures (NS/TBD).
      // Staking on finished/live matches makes no sense — the outcome is already known.
      if (process.env.REWARDS_ADDRESS) {
        const upcoming = fixturesCache.filter((f) => f.status === "NS" || f.status === "TBD");
        for (const fx of upcoming) {
          if (openedMarkets.has(fx.matchId)) continue;
          try {
            await ensureMarketOpen(fx);
          } catch (e) {
            log.warn({ err: e, matchId: fx.matchId }, "ensureMarketOpen failed");
          }
        }
      }

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
    marketsOpened: openedMarkets.size,
    lastPushAt,
    lastError,
    recentHashes: recentHashes.slice(0, 5),
    oracle: process.env.ORACLE_ADDRESS || null,
    rewards: process.env.REWARDS_ADDRESS || null,
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

    const home = fx.home;
    const away = fx.away;
    const status = fx.status;
    const score = (fx.scoreHome != null && fx.scoreAway != null)
      ? { home: fx.scoreHome, away: fx.scoreAway }
      : undefined;

    const goalEvents = events.filter((e) => e.type === "goal");
    const cardEvents = events.filter((e) => e.type === "card");
    const goals = { home: score?.home ?? 0, away: score?.away ?? 0 };
    const cards = { home: 0, away: 0 };
    for (const e of cardEvents) {
      const t = (e.details.team as string || "").toLowerCase();
      if (t === home.toLowerCase()) cards.home++;
      else if (t === away.toLowerCase()) cards.away++;
      else cards.home++;
    }

    // Compute team form stats from last 5 finished fixtures
    const formHome = sortedFixtures
      .filter((f) => f.status === "FT" && (f.home === home || f.away === home))
      .slice(0, 5);
    const formAway = sortedFixtures
      .filter((f) => f.status === "FT" && (f.home === away || f.away === away))
      .slice(0, 5);

    let hw = 0, hd = 0, hl = 0;
    let hGoalsFor = 0, hGoalsAgainst = 0;
    const hSeq: string[] = [];
    for (const f of formHome) {
      const ms = f.home === home ? (f.scoreHome ?? 0) : (f.scoreAway ?? 0);
      const os = f.home === home ? (f.scoreAway ?? 0) : (f.scoreHome ?? 0);
      hGoalsFor += ms; hGoalsAgainst += os;
      if (ms > os) { hw++; hSeq.push("W"); }
      else if (ms < os) { hl++; hSeq.push("L"); }
      else { hd++; hSeq.push("D"); }
    }
    let aw = 0, ad = 0, al = 0;
    let aGoalsFor = 0, aGoalsAgainst = 0;
    const aSeq: string[] = [];
    for (const f of formAway) {
      const ms = f.home === away ? (f.scoreHome ?? 0) : (f.scoreAway ?? 0);
      const os = f.home === away ? (f.scoreAway ?? 0) : (f.scoreHome ?? 0);
      aGoalsFor += ms; aGoalsAgainst += os;
      if (ms > os) { aw++; aSeq.push("W"); }
      else if (ms < os) { al++; aSeq.push("L"); }
      else { ad++; aSeq.push("D"); }
    }

    const hasGameData = status === "FT" || status === "LIVE" || status === "HT";
    const nHome = formHome.length || 1;
    const nAway = formAway.length || 1;

    // Shots: from actual events if match has data, else from form-based expected goals
    const expectedHomeGoals = hasGameData ? goals.home : hGoalsFor / nHome;
    const expectedAwayGoals = hasGameData ? goals.away : aGoalsFor / nAway;
    const expectedHomeShots = Math.round(expectedHomeGoals / 0.12);
    const expectedAwayShots = Math.round(expectedAwayGoals / 0.12);

    const shots = {
      home: Math.max(hasGameData ? (goals.home * 8 + cards.away * 2) : expectedHomeShots, hasGameData ? 3 : 5),
      away: Math.max(hasGameData ? (goals.away * 8 + cards.home * 2) : expectedAwayShots, hasGameData ? 3 : 5),
    };
    const totalShots = shots.home + shots.away;
    const possession = totalShots > 0
      ? { home: Math.round((shots.home / totalShots) * 100), away: Math.round((shots.away / totalShots) * 100) }
      : { home: 50, away: 50 };
    const xg = {
      home: Math.round((expectedHomeGoals * 0.85 + shots.home * 0.12) * 100) / 100,
      away: Math.round((expectedAwayGoals * 0.85 + shots.away * 0.12) * 100) / 100,
    };

    const h2hList = sortedFixtures.filter(
      (f) => f.status === "FT" &&
        ((f.home === home && f.away === away) || (f.home === away && f.away === home))
    );
    let h2h = null as string | null;
    if (h2hList.length > 0) {
      let hw2 = 0, aw2 = 0, d2 = 0;
      for (const f of h2hList) {
        if (f.scoreHome == null || f.scoreAway == null) continue;
        if (f.home === home) {
          if (f.scoreHome > f.scoreAway) hw2++;
          else if (f.scoreHome < f.scoreAway) aw2++;
          else d2++;
        } else {
          if (f.scoreAway > f.scoreHome) hw2++;
          else if (f.scoreAway < f.scoreHome) aw2++;
          else d2++;
        }
      }
      h2h = `${home} ${hw2} · Draws ${d2} · ${away} ${aw2} (last ${h2hList.length} meetings)`;
    }

    let prediction = { winner: "Draw", confidence: "low", reasoning: "Similar recent form." };
    if (status === "FT") {
      if (goals.home > goals.away) prediction = { winner: home, confidence: "confirmed", reasoning: `${home} ${goals.home}–${goals.away} ${away}` };
      else if (goals.away > goals.home) prediction = { winner: away, confidence: "confirmed", reasoning: `${away} ${goals.away}–${goals.home} ${home}` };
      else prediction = { winner: "Draw", confidence: "confirmed", reasoning: `${goals.home}–${goals.away} draw` };
    } else if (status === "LIVE" || status === "HT") {
      const diff = goals.home - goals.away;
      const lastMinute = events.length > 0 ? events[events.length - 1].minute : 0;
      const remaining = 90 - lastMinute;
      if (diff > 1) {
        prediction = { winner: home, confidence: "high", reasoning: `${home} is strongly favored — they lead by ${diff} goals with ${remaining} minutes remaining. ${away} would need a remarkable comeback to turn this around.` };
      } else if (diff < -1) {
        prediction = { winner: away, confidence: "high", reasoning: `${away} is strongly favored — they lead by ${-diff} goals with ${remaining} minutes remaining. ${home} faces an uphill battle to equalize.` };
      } else if (diff === 1 && remaining < 15) {
        prediction = { winner: home, confidence: "high", reasoning: `${home} leads by 1 goal with only ${remaining} minutes left. ${away} has very little time to find an equalizer — ${home} should hold on for the win.` };
      } else if (diff === -1 && remaining < 15) {
        prediction = { winner: away, confidence: "high", reasoning: `${away} leads by 1 goal with only ${remaining} minutes left. ${home} has very little time to find an equalizer — ${away} should hold on for the win.` };
      } else if (diff === 1) {
        prediction = { winner: home, confidence: "medium", reasoning: `${home} leads by 1 goal with ${remaining} minutes remaining. ${away} still has time to equalize, but ${home} has the advantage and should win if they maintain their lead.` };
      } else if (diff === -1) {
        prediction = { winner: away, confidence: "medium", reasoning: `${away} leads by 1 goal with ${remaining} minutes remaining. ${home} still has time to equalize, but ${away} has the advantage and should win if they maintain their lead.` };
      } else if (diff === 0) {
        prediction = { winner: "Draw", confidence: "medium", reasoning: `The match is level at ${goals.home}-${goals.away} with ${remaining} minutes remaining. Both teams are evenly poised — this could go either way, but a draw is a strong possibility.` };
      }
    } else {
      const homeFormPts = hw * 3 + hd;
      const awayFormPts = aw * 3 + ad;
      const homeGd = hGoalsFor - hGoalsAgainst;
      const awayGd = aGoalsFor - aGoalsAgainst;
      const homeAvgGf = nHome > 0 ? hGoalsFor / nHome : 0;
      const awayAvgGf = nAway > 0 ? aGoalsFor / nAway : 0;
      const homeAvgGa = nHome > 0 ? hGoalsAgainst / nHome : 0;
      const awayAvgGa = nAway > 0 ? aGoalsAgainst / nAway : 0;

      const homeFormStr = `W${hw}D${hd}L${hl} (${hGoalsFor}:${hGoalsAgainst})`;
      const awayFormStr = `W${aw}D${ad}L${al} (${aGoalsFor}:${aGoalsAgainst})`;

      if (homeFormPts > awayFormPts + 2) {
        prediction = { winner: home, confidence: "high", reasoning: `${home} should win because they have significantly stronger recent form (${homeFormStr}) compared to ${away} (${awayFormStr}). ${home} averages ${homeAvgGf.toFixed(1)} goals per game and has a goal difference of +${homeGd}, giving them a clear edge in both attack and overall consistency.` };
      } else if (awayFormPts > homeFormPts + 2) {
        prediction = { winner: away, confidence: "high", reasoning: `${away} should win because they have significantly stronger recent form (${awayFormStr}) compared to ${home} (${homeFormStr}). ${away} averages ${awayAvgGf.toFixed(1)} goals per game and has a goal difference of +${awayGd}, giving them a clear edge in both attack and overall consistency.` };
      } else if (homeFormPts > awayFormPts) {
        prediction = { winner: home, confidence: "medium", reasoning: `${home} is likely to win because they edge ${away} on form points (${homeFormPts} vs ${awayFormPts}). While both teams are close, ${home}'s recent record of ${homeFormStr} gives them a slight but meaningful advantage over ${away}'s ${awayFormStr}.` };
      } else if (awayFormPts > homeFormPts) {
        prediction = { winner: away, confidence: "medium", reasoning: `${away} is likely to win because they edge ${home} on form points (${awayFormPts} vs ${homeFormPts}). While both teams are close, ${away}'s recent record of ${awayFormStr} gives them a slight but meaningful advantage over ${home}'s ${homeFormStr}.` };
      } else if (homeGd - awayGd > 2) {
        prediction = { winner: home, confidence: "medium", reasoning: `${home} should win because, despite identical win records, ${home} has a much better goal difference (+${homeGd} vs +${awayGd}). ${home} has scored ${hGoalsFor} and conceded only ${hGoalsAgainst} (${homeAvgGa.toFixed(1)}/game), while ${away} has scored ${aGoalsFor} and conceded ${aGoalsAgainst} (${awayAvgGa.toFixed(1)}/game). ${home}'s superior defense should be the deciding factor.` };
      } else if (awayGd - homeGd > 2) {
        prediction = { winner: away, confidence: "medium", reasoning: `${away} should win because, despite identical win records, ${away} has a much better goal difference (+${awayGd} vs +${homeGd}). ${away} has scored ${aGoalsFor} and conceded only ${aGoalsAgainst} (${awayAvgGa.toFixed(1)}/game), while ${home} has scored ${hGoalsFor} and conceded ${hGoalsAgainst} (${homeAvgGa.toFixed(1)}/game). ${away}'s superior defense should be the deciding factor.` };
      } else if (homeAvgGf - awayAvgGf > 0.5) {
        prediction = { winner: home, confidence: "low", reasoning: `This match could go either way, but ${home} has a slight edge because they score significantly more goals (${homeAvgGf.toFixed(1)} vs ${awayAvgGf.toFixed(1)} per game). Both teams have similar form (${homeFormStr} vs ${awayFormStr}), so ${home}'s attacking firepower may be the difference in a tight match.` };
      } else if (awayAvgGf - homeAvgGf > 0.5) {
        prediction = { winner: away, confidence: "low", reasoning: `This match could go either way, but ${away} has a slight edge because they score significantly more goals (${awayAvgGf.toFixed(1)} vs ${homeAvgGf.toFixed(1)} per game). Both teams have similar form (${awayFormStr} vs ${homeFormStr}), so ${away}'s attacking firepower may be the difference in a tight match.` };
      } else if (homeGd > awayGd) {
        prediction = { winner: home, confidence: "low", reasoning: `${home} has a marginal edge due to a slightly better goal difference (+${homeGd} vs +${awayGd}). Both teams are very evenly matched on form (${homeFormStr} vs ${awayFormStr}), so this is likely to be a close game, with ${home} just edging it.` };
      } else if (awayGd > homeGd) {
        prediction = { winner: away, confidence: "low", reasoning: `${away} has a marginal edge due to a slightly better goal difference (+${awayGd} vs +${homeGd}). Both teams are very evenly matched on form (${awayFormStr} vs ${homeFormStr}), so this is likely to be a close game, with ${away} just edging it.` };
      } else {
        prediction = { winner: "Draw", confidence: "low", reasoning: `This match may likely end in a draw because both teams are near-identical across all metrics — same form (${homeFormStr} vs ${awayFormStr}), same goal difference (+${homeGd}), and similar scoring rates (${homeAvgGf.toFixed(1)} vs ${awayAvgGf.toFixed(1)} goals/game). There is no clear advantage for either side.` };
      }
    }

    let narrative = prediction.reasoning;
    if (h2h) narrative += ` | H2H: ${h2h}`;
    narrative += ` | ${home} ${hSeq.join("")} (${hGoalsFor}:${hGoalsAgainst}) vs ${away} ${aSeq.join("")} (${aGoalsFor}:${aGoalsAgainst})`;

    res.json({
      matchId: id,
      home,
      away,
      score,
      status,
      goals: { home: goals.home, away: goals.away, timeline: goalEvents.map((e) => ({ minute: e.minute, scorer: (e.details.player || e.details.team || "Unknown") as string })) },
      cards,
      shots,
      possession,
      xg,
      form: {
        home: `${hSeq.join("")} (W${hw}D${hd}L${hl}, ${hGoalsFor}:${hGoalsAgainst})`,
        away: `${aSeq.join("")} (W${aw}D${ad}L${al}, ${aGoalsFor}:${aGoalsAgainst})`,
      },
      h2h,
      prediction,
      narrative,
      _source: `feeder-${fx.source || "unknown"}`,
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
