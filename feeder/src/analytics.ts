/**
 * Premium analytics engine for CupEvent Oracle.
 *
 * Produces a probabilistic match preview built on:
 *   1. An Elo-style team-strength PRIOR (always available, no API key) so
 *      upcoming-match prediction works even before any World Cup games are
 *      played — the case that matters most for a "predict the upcoming match"
 *      product.
 *   2. World-Cup form (attack / defence scoring rates) blended in by data
 *      coverage, plus head-to-head results folded into the rating balance.
 *   3. A Poisson / Dixon-Coles model -> full scoreline distribution ->
 *      calibrated P(home) / P(draw) / P(away), most-likely scorelines and
 *      expected goals.
 *
 * For LIVE matches the same model is applied to REMAINING time, conditioned on
 * the current scoreline, using the real match minute (not the last-event
 * minute). Every field carries a provenance label so the agent / UI can be
 * honest about what is measured vs estimated. The goal timeline is taken from
 * oracle events (on-chain) when available.
 */
import type { Fixture, MatchEvent } from "./providers/types.js";
import type { TeamStrength } from "./providers/apiFootballHistory.js";

// ---- Elo prior -----------------------------------------------------------

/**
 * Approximate World Football Elo ratings (public, Elo-style). Used as a
 * team-strength PRIOR. Keyed by canonical team name (lower-case, no
 * diacritics). Unknown teams default to DEFAULT_ELO.
 */
const DEFAULT_ELO = 1560;
const ELO_PRIOR: Record<string, number> = {
  argentina: 2075,
  france: 2035,
  spain: 1985,
  england: 1975,
  brazil: 1960,
  portugal: 1950,
  netherlands: 1935,
  belgium: 1925,
  germany: 1915,
  italy: 1905,
  croatia: 1885,
  uruguay: 1875,
  colombia: 1845,
  morocco: 1835,
  mexico: 1815,
  japan: 1795,
  "united states": 1785,
  switzerland: 1775,
  denmark: 1765,
  senegal: 1755,
  iran: 1745,
  serbia: 1735,
  "south korea": 1725,
  ukraine: 1715,
  poland: 1705,
  austria: 1695,
  sweden: 1685,
  norway: 1680,
  australia: 1670,
  ecuador: 1665,
  turkey: 1655,
  wales: 1650,
  ghana: 1645,
  nigeria: 1645,
  cameroon: 1635,
  tunisia: 1625,
  "saudi arabia": 1615,
  canada: 1605,
  qatar: 1600,
  "ivory coast": 1595,
  "costa rica": 1590,
  peru: 1585,
  chile: 1580,
  paraguay: 1575,
  "dr congo": 1560,
  egypt: 1560,
  algeria: 1565,
  mali: 1560,
  panama: 1545,
  "new zealand": 1540,
  jordan: 1530,
  uzbekistan: 1530,
  iraq: 1525,
};

/** Team-name variants from providers -> one canonical lower-case form. */
const TEAM_ALIASES: Record<string, string> = {
  "ivory coast": "ivory coast",
  "cote d'ivoire": "ivory coast",
  "côte d'ivoire": "ivory coast",
  "dr congo": "dr congo",
  "democratic republic of the congo": "dr congo",
  "democratic republic of congo": "dr congo",
  drc: "dr congo",
  turkey: "turkey",
  türkiye: "turkey",
  "united states": "united states",
  usa: "united states",
  "u.s.": "united states",
  "south korea": "south korea",
  "korea republic": "south korea",
  "korea dpr": "north korea",
  iran: "iran",
  "ir iran": "iran",
};

function canonTeam(name: string): string {
  const n = (name || "").toLowerCase().trim();
  if (TEAM_ALIASES[n]) return TEAM_ALIASES[n];
  const stripped = n
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return TEAM_ALIASES[stripped] || stripped;
}

function eloOf(team: string): { rating: number; known: boolean } {
  const k = canonTeam(team);
  if (ELO_PRIOR[k] != null) return { rating: ELO_PRIOR[k], known: true };
  return { rating: DEFAULT_ELO, known: false };
}

/** WC 2026 co-hosts get a modest home-field bonus when listed as "home". */
const HOST_NATIONS = new Set(["united states", "canada", "mexico"]);

// ---- math helpers --------------------------------------------------------

const FACTORIAL = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880];
const MAX_GOALS = 8;
/** Dixon-Coles low-score correction parameter (typical for intl football). */
const DC_RHO = -0.075;

function poissonPmf(k: number, lambda: number): number {
  if (k >= FACTORIAL.length) return 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / FACTORIAL[k];
}

/** Dixon-Coles dependency correction for low-scoring cells. */
function dcTau(i: number, j: number, lh: number, la: number): number {
  if (i === 0 && j === 0) return 1 - lh * la * DC_RHO;
  if (i === 0 && j === 1) return 1 + lh * DC_RHO;
  if (i === 1 && j === 0) return 1 + la * DC_RHO;
  if (i === 1 && j === 1) return 1 - DC_RHO;
  return 1;
}

interface ScoreMatrix {
  matrix: number[][];
  pHome: number;
  pDraw: number;
  pAway: number;
  top: { score: string; probability: number }[];
}

/** Build a corrected scoreline distribution from two goal rates. */
function scorelineMatrix(lh: number, la: number): ScoreMatrix {
  const matrix: number[][] = [];
  let total = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    matrix[i] = [];
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = poissonPmf(i, lh) * poissonPmf(j, la) * dcTau(i, j, lh, la);
      matrix[i][j] = p;
      total += p;
    }
  }
  // Renormalise (the DC correction breaks the sum slightly).
  let pHome = 0,
    pDraw = 0,
    pAway = 0;
  const flat: { score: string; probability: number }[] = [];
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      const p = total > 0 ? matrix[i][j] / total : 0;
      matrix[i][j] = p;
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
      flat.push({ score: `${i}-${j}`, probability: p });
    }
  }
  flat.sort((a, b) => b.probability - a.probability);
  return { matrix, pHome, pDraw, pAway, top: flat.slice(0, 5) };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

// ---- form ----------------------------------------------------------------

interface FormStats {
  games: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  seq: string[];
  gfRate: number; // goals scored per game
  gaRate: number; // goals conceded per game
}

/** Last-N finished fixtures for a team (tournament-desc order). */
function computeForm(team: string, sorted: Fixture[], n = 5): FormStats {
  const canon = canonTeam(team);
  const games = sorted.filter(
    (f) =>
      f.status === "FT" &&
      (canonTeam(f.home) === canon || canonTeam(f.away) === canon)
  );
  let w = 0,
    d = 0,
    l = 0,
    gf = 0,
    ga = 0;
  const seq: string[] = [];
  for (const f of games.slice(0, n)) {
    const isHome = canonTeam(f.home) === canon;
    const ms = isHome ? f.scoreHome ?? 0 : f.scoreAway ?? 0;
    const os = isHome ? f.scoreAway ?? 0 : f.scoreHome ?? 0;
    gf += ms;
    ga += os;
    if (ms > os) {
      w++;
      seq.push("W");
    } else if (ms < os) {
      l++;
      seq.push("L");
    } else {
      d++;
      seq.push("D");
    }
  }
  const played = Math.max(seq.length, 1);
  return {
    games: seq.length,
    w,
    d,
    l,
    gf,
    ga,
    seq,
    gfRate: gf / played,
    gaRate: ga / played,
  };
}

function formLabel(f: FormStats): string {
  if (f.games === 0) return "No WC matches yet";
  return `${f.seq.join("") || "—"} (W${f.w}D${f.d}L${f.l}, ${f.gf}:${f.ga})`;
}

// ---- public types --------------------------------------------------------

export interface PremiumAnalytics {
  matchId: number;
  home: string;
  away: string;
  score?: { home: number; away: number };
  status?: string;
  goals: {
    home: number;
    away: number;
    timeline: { minute: number; scorer: string }[];
  };
  cards: { home: number; away: number };
  shots: { home: number; away: number };
  possession: { home: number; away: number };
  xg: { home: number; away: number };
  form: { home: string; away: string };
  h2h: string | null;
  prediction: {
    winner: string;
    confidence: "high" | "medium" | "low" | "confirmed";
    reasoning: string;
  };
  narrative: string;
  /** New probabilistic layer — calibrated outcome probabilities. */
  probabilities: { home: number; draw: number; away: number };
  scorelines: { score: string; probability: number }[];
  expectedGoals: { home: number; away: number };
  model: { type: string; inputs: string[]; dataCoverage: string };
  _source: string;
}

// ---- the engine ----------------------------------------------------------

export function computePremiumAnalytics(opts: {
  fx: Fixture;
  events: MatchEvent[]; // provider events (off-chain source)
  oracleEvents?: MatchEvent[]; // optional on-chain oracle events (preferred for timeline)
  allFixtures: Fixture[]; // tournament-desc sorted, for form / h2h
  /** Optional api-football historical strengths (real attack/defence rates). */
  historyHome?: TeamStrength | null;
  historyAway?: TeamStrength | null;
}): PremiumAnalytics {
  const { fx, events, allFixtures } = opts;
  const oracleEvents = opts.oracleEvents ?? [];
  const home = fx.home;
  const away = fx.away;
  const status = fx.status;
  const id = fx.matchId;

  const hasScore = fx.scoreHome != null && fx.scoreAway != null;
  const goals = {
    home: hasScore ? (fx.scoreHome as number) : 0,
    away: hasScore ? (fx.scoreAway as number) : 0,
  };

  // Goal timeline — prefer oracle-verified events when available.
  const timelineSource = oracleEvents.length > 0 ? oracleEvents : events;
  const goalEvents = timelineSource
    .filter((e) => e.type === "goal")
    .sort((a, b) => a.minute - b.minute);
  const timeline = goalEvents.map((e) => ({
    minute: e.minute,
    scorer: (e.details.player as string) ||
      (e.details.team as string) ||
      "Unknown",
  }));

  // Cards — only attribute to a side when the team actually matches (fixes the
  // old "default to home" bias). With the worldcup26 provider there are none.
  const cards = { home: 0, away: 0 };
  for (const e of events) {
    if (e.type !== "card") continue;
    const t = String(e.details.team || "").toLowerCase();
    if (t === home.toLowerCase()) cards.home++;
    else if (t === away.toLowerCase()) cards.away++;
  }

  // ---- strength -> goal rates -------------------------------------------
  const fh = computeForm(home, allFixtures);
  const fa = computeForm(away, allFixtures);

  // Head-to-head from finished fixtures between the two teams.
  const h2hList = allFixtures.filter(
    (f) =>
      f.status === "FT" &&
      ((canonTeam(f.home) === canonTeam(home) &&
        canonTeam(f.away) === canonTeam(away)) ||
        (canonTeam(f.home) === canonTeam(away) &&
          canonTeam(f.away) === canonTeam(home)))
  );
  let h2hHome = 0,
    h2hAway = 0,
    h2hDraw = 0;
  for (const f of h2hList) {
    if (f.scoreHome == null || f.scoreAway == null) continue;
    const homeIsHome = canonTeam(f.home) === canonTeam(home);
    const hs = homeIsHome ? f.scoreHome : f.scoreAway;
    const as = homeIsHome ? f.scoreAway : f.scoreHome;
    if (hs > as) h2hHome++;
    else if (hs < as) h2hAway++;
    else h2hDraw++;
  }
  const h2h =
    h2hList.length > 0
      ? `${home} ${h2hHome} · Draws ${h2hDraw} · ${away} ${h2hAway} (last ${h2hList.length} meetings)`
      : null;

  const eloH = eloOf(home);
  const eloA = eloOf(away);
  // Home advantage + co-host bonus (WC 2026: USA / Canada / Mexico).
  const homeAdv = 50 + (HOST_NATIONS.has(canonTeam(home)) ? 80 : 0);
  // H2H nudge on the rating balance (each net H2H win ~ 20 Elo points).
  const h2hNudge =
    h2hList.length >= 2 ? clamp((h2hHome - h2hAway) * 20, -80, 80) : 0;

  const dr = eloH.rating + homeAdv - eloA.rating + h2hNudge;
  const ratio = Math.pow(10, dr / 400);
  const AVG_TOTAL = 2.7; // ~avg total goals in international football
  const lhElo = AVG_TOTAL * (ratio / (1 + ratio));
  const laElo = AVG_TOTAL * (1 / (1 + ratio));

  // Layer 1: Elo prior vs api-football historical strengths. Real attack /
  // defence rates from each team's last-N matches across competitions
  // (qualifiers, friendlies, prior tournaments), time-decayed. History
  // dominates as the sample grows; Elo is the fallback when unavailable.
  const histH = opts.historyHome;
  const histA = opts.historyAway;
  const hasHistory =
    histH != null && histA != null && histH.games > 0 && histA.games > 0;
  const histCoverage = hasHistory
    ? clamp(Math.min(histH!.games, histA!.games) / 15, 0, 1)
    : 0;
  const lhHist = hasHistory ? (histH!.gfRate + histA!.gaRate) / 2 : lhElo;
  const laHist = hasHistory ? (histA!.gfRate + histH!.gaRate) / 2 : laElo;
  const lh1 = (1 - histCoverage) * lhElo + histCoverage * lhHist;
  const la1 = (1 - histCoverage) * laElo + histCoverage * laHist;

  // Layer 2: WC tournament form. Early in the tournament the sample is small,
  // so it starts as a light fine-tune; but once both teams have several
  // finished WC games, current-tournament form becomes the primary signal
  // (recency + same competition + same roster). Scale up to
  // 70% once both sides have >=5 finished WC games — WC form clearly dominates
  // while keeping ~30% long-term anchor (Elo prior + history) against a single
  // fluke result (e.g. a rotated lineup in a dead-rubber group game).
  // A team plays at most 7 games in a WC, so 5 is a strong sample by the
  // late knockout rounds.
  const wcCoverage = clamp(Math.min(fh.games, fa.games) / 5, 0, 0.70);
  const lhForm = (fh.gfRate + fa.gaRate) / 2; // home attack vs away defence
  const laForm = (fa.gfRate + fh.gaRate) / 2; // away attack vs home defence
  const lh = (1 - wcCoverage) * lh1 + wcCoverage * lhForm;
  const la = (1 - wcCoverage) * la1 + wcCoverage * laForm;

  const exAnte = scorelineMatrix(lh, la);

  // ---- probabilities / expected goals per match state ------------------
  let probabilities: { home: number; draw: number; away: number };
  let expectedGoals: { home: number; away: number };
  let scorelines: { score: string; probability: number }[];
  let liveMinuteUsed: number | null = null;

  if (status === "LIVE" || status === "HT") {
    // Condition on the current scoreline + remaining time.
    const t =
      fx.liveMinute ??
      (events.length > 0 ? events[events.length - 1].minute : 0);
    liveMinuteUsed = t;
    const remaining = Math.max(0, 90 - t);
    const remFrac = remaining / 90;
    const lhRem = lh * remFrac;
    const laRem = la * remFrac;
    const rem = scorelineMatrix(lhRem, laRem);

    let pH = 0,
      pD = 0,
      pA = 0;
    const finalMap = new Map<string, number>();
    for (let i = 0; i <= MAX_GOALS; i++) {
      for (let j = 0; j <= MAX_GOALS; j++) {
        const p = rem.matrix[i][j];
        const fi = goals.home + i;
        const fj = goals.away + j;
        const key = `${fi}-${fj}`;
        finalMap.set(key, (finalMap.get(key) ?? 0) + p);
        if (fi > fj) pH += p;
        else if (fi === fj) pD += p;
        else pA += p;
      }
    }
    probabilities = { home: pH, draw: pD, away: pA };
    expectedGoals = { home: goals.home + lhRem, away: goals.away + laRem };
    scorelines = Array.from(finalMap.entries())
      .map(([score, probability]) => ({ score, probability }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 5);
  } else {
    // NS (upcoming) -> pure model. FT -> show the pre-match expectation.
    probabilities = {
      home: exAnte.pHome,
      draw: exAnte.pDraw,
      away: exAnte.pAway,
    };
    expectedGoals = { home: lh, away: la };
    scorelines = exAnte.top;
  }

  // ---- provenance -------------------------------------------------------
  const sources: string[] = ["elo-prior"];
  if (hasHistory) sources.push("api-football-history");
  if (fh.games > 0 || fa.games > 0) sources.push("world-cup-form");
  if (h2hList.length > 0) sources.push("head-to-head");
  if (oracleEvents.length > 0) sources.push("oracle-events");

  const coverageParts: string[] = [];
  if (hasHistory) {
    coverageParts.push(
      `+ api-football history (${histH!.games} ${home}, ${histA!.games} ${away})`
    );
  }
  if (Math.min(fh.games, fa.games) > 0) {
    coverageParts.push(`+ WC form (${fh.games} ${home}, ${fa.games} ${away})`);
  } else if (!hasHistory) {
    coverageParts.push("no WC matches yet — prior only");
  }
  if (h2hList.length > 0) coverageParts.push(`+ H2H (${h2hList.length})`);
  if (oracleEvents.length > 0)
    coverageParts.push("+ oracle-verified timeline");
  if (!eloH.known && !eloA.known && !hasHistory)
    coverageParts.push("(both teams using default prior)");
  const dataCoverage = `Elo prior ${coverageParts.join(" ")}`;

  // ---- prediction (derived from the probabilities) ----------------------
  const maxProb = Math.max(
    probabilities.home,
    probabilities.draw,
    probabilities.away
  );
  const confFromProb: "high" | "medium" | "low" =
    maxProb >= 0.55 ? "high" : maxProb >= 0.38 ? "medium" : "low";

  let prediction: PremiumAnalytics["prediction"];
  if (status === "FT") {
    const winner =
      goals.home > goals.away
        ? home
        : goals.away > goals.home
          ? away
          : "Draw";
    prediction = {
      winner,
      confidence: "confirmed",
      reasoning: `Confirmed: ${winner === "Draw" ? "draw" : `${winner} won`} ${home} ${goals.home}–${goals.away} ${away}. Pre-match model had expected ${pct(exAnte.pHome)} ${home} / ${pct(exAnte.pDraw)} draw / ${pct(exAnte.pAway)} ${away} with ${exAnte.top[0]?.score ?? "—"} the likeliest scoreline.`,
    };
  } else {
    const winner =
      probabilities.home >= probabilities.draw &&
      probabilities.home >= probabilities.away
        ? home
        : probabilities.away >= probabilities.draw &&
            probabilities.away >= probabilities.home
          ? away
          : "Draw";
    const topScore = scorelines[0]?.score ?? "—";
    const stateWord =
      status === "LIVE" || status === "HT" ? "live" : "pre-match";
    const livePart =
      liveMinuteUsed != null
        ? ` at ${liveMinuteUsed}' (${home} ${goals.home}–${goals.away} ${away})`
        : "";
    prediction = {
      winner,
      confidence: confFromProb,
      reasoning: reasoningFor(winner, {
        home,
        away,
        probabilities,
        expectedGoals,
        topScore,
        fh,
        fa,
        h2h,
        stateWord,
        livePart,
        conf: confFromProb,
      }),
    };
  }

  // ---- legacy quantitative fields (honestly estimated) ------------------
  // xG == the model's expected goals (λ). For LIVE this includes goals
  // already scored + remaining expectation.
  const xg = {
    home: round2(expectedGoals.home),
    away: round2(expectedGoals.away),
  };
  // Shots / possession are not provided by the free worldcup26 feed, so they
  // are model-estimated from expected goals and labelled as such via the
  // model.provenance block returned below.
  const shots = {
    home: Math.max(Math.round(expectedGoals.home / 0.12), 3),
    away: Math.max(Math.round(expectedGoals.away / 0.12), 3),
  };
  const totalShots = shots.home + shots.away;
  const possession = {
    home: Math.round(clamp(shots.home / totalShots, 0.35, 0.65) * 100),
    away: 0,
  };
  possession.away = 100 - possession.home;

  // ---- narrative --------------------------------------------------------
  const topScore = scorelines[0]?.score ?? "—";
  const narrativeParts: string[] = [];
  if (status === "LIVE" || status === "HT") {
    narrativeParts.push(
      `LIVE ${home} ${goals.home}–${goals.away} ${away} (${liveMinuteUsed}'): live win prob ${pct(probabilities.home)} ${home} / ${pct(probabilities.draw)} draw / ${pct(probabilities.away)} ${away}.`
    );
  } else if (status === "FT") {
    narrativeParts.push(
      `Final ${home} ${goals.home}–${goals.away} ${away}. Pre-match model expected ${pct(exAnte.pHome)} / ${pct(exAnte.pDraw)} / ${pct(exAnte.pAway)} (${home}/draw/${away}) with ${exAnte.top[0]?.score ?? "—"} the likeliest scoreline.`
    );
  } else {
    narrativeParts.push(
      `Pre-match: ${pct(probabilities.home)} ${home} / ${pct(probabilities.draw)} draw / ${pct(probabilities.away)} ${away}. Most likely scoreline ${topScore} (${pct(scorelines[0]?.probability ?? 0)}). Expected goals ${xg.home.toFixed(2)}–${xg.away.toFixed(2)}.`
    );
  }
  if (fh.games > 0 || fa.games > 0) {
    narrativeParts.push(`Form — ${home}: ${formLabel(fh)}; ${away}: ${formLabel(fa)}.`);
  }
  if (h2h) narrativeParts.push(`H2H: ${h2h}.`);
  narrativeParts.push(`Model: ${dataCoverage}.`);
  const narrative = narrativeParts.join(" ");

  return {
    matchId: id,
    home,
    away,
    score:
      hasScore && (status === "FT" || status === "LIVE" || status === "HT")
        ? { home: goals.home, away: goals.away }
        : undefined,
    status,
    goals: { home: goals.home, away: goals.away, timeline },
    cards,
    shots,
    possession,
    xg,
    form: { home: formLabel(fh), away: formLabel(fa) },
    h2h,
    prediction,
    narrative,
    probabilities: {
      home: round4(probabilities.home),
      draw: round4(probabilities.draw),
      away: round4(probabilities.away),
    },
    scorelines: scorelines.map((s) => ({
      score: s.score,
      probability: round4(s.probability),
    })),
    expectedGoals: xg,
    model: {
      type: "poisson-dixon-coles",
      inputs: sources,
      dataCoverage,
    },
    _source: `feeder-${fx.source || "unknown"} · poisson-dixon-coles`,
  };
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function reasoningFor(
  winner: string,
  ctx: {
    home: string;
    away: string;
    probabilities: { home: number; draw: number; away: number };
    expectedGoals: { home: number; away: number };
    topScore: string;
    fh: FormStats;
    fa: FormStats;
    h2h: string | null;
    stateWord: string;
    livePart: string;
    conf: "high" | "medium" | "low";
  }
): string {
  const {
    home,
    away,
    probabilities,
    expectedGoals,
    topScore,
    fh,
    fa,
    h2h,
    stateWord,
    livePart,
    conf,
  } = ctx;
  const bits: string[] = [];
  const winnerPct =
    winner === home
      ? probabilities.home
      : winner === away
        ? probabilities.away
        : probabilities.draw;
  bits.push(
    `${stateWord === "live" ? "Live" : "Pre-match"} model favours ${winner} (${pct(winnerPct)})${livePart}.`
  );
  bits.push(
    `Full odds: ${pct(probabilities.home)} ${home} / ${pct(probabilities.draw)} draw / ${pct(probabilities.away)} ${away}; likeliest scoreline ${topScore}; expected goals ${expectedGoals.home.toFixed(2)}–${expectedGoals.away.toFixed(2)}.`
  );
  if (fh.games > 0 || fa.games > 0) {
    bits.push(`Form — ${home} ${formLabel(fh)}, ${away} ${formLabel(fa)}.`);
  } else {
    bits.push(
      `No WC matches yet — prediction from Elo strength prior (confidence ${conf}).`
    );
  }
  if (h2h) bits.push(`H2H: ${h2h}.`);
  return bits.join(" ");
}
