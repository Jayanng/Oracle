/**
 * api-football historical team-strength enrichment.
 *
 * Goal: give the Poisson/Dixon-Coles prediction engine REAL attack/defence
 * rates for each team (across competitions — qualifiers, friendlies, prior
 * tournaments) so upcoming-match predictions are data-driven instead of
 * relying on the Elo prior alone. This is the layer that makes the "predict
 * the upcoming match" product genuinely strong even before WC games are played.
 *
 * Free-plan constraints handled carefully:
 *   - ~100 requests/day -> we cache aggressively and cap usage (default 60/day).
 *   - season 2026 is NOT available on the free plan, and the free plan does NOT
 *     support the `last` param either. We therefore query `fixtures?team={id}&season=Y`
 *     for a couple of recent allowed seasons (2022-2024) and combine them —
 *     exactly the historical sample we want, with time-decay handling recency.
 *   - Team-id resolution (name -> api-football id) is cached per process.
 *   - Strengths are cached per team for 24h (team strength barely moves in a day).
 *
 * The module NEVER throws to its caller: on any error, budget exhaustion, or
 * missing key it resolves null, and the analytics engine falls back to the
 * Elo prior + WC form. So this layer is purely additive and safe.
 */
import axios, { type AxiosInstance } from "axios";

export interface TeamStrength {
  games: number;
  /** Time-decayed goals scored per game. */
  gfRate: number;
  /** Time-decayed goals conceded per game. */
  gaRate: number;
  /** Human-readable provenance, surfaced to the UI/agent. */
  sample: string;
}

const BASE =
  process.env.SPORTS_API_BASE || "https://v3.football.api-sports.io";
const HISTORY_N = Math.max(
  5,
  Math.min(40, Number(process.env.API_FOOTBALL_HISTORY_N || "20"))
);
/**
 * Seasons to pull per team. The free plan does NOT support the `last` param,
 * but it DOES allow `season` queries for 2022–2024, so we query a couple of
 * recent allowed seasons and combine them (time-decay handles recency).
 */
const HISTORY_SEASONS: number[] = (() => {
  const parsed = (process.env.API_FOOTBALL_HISTORY_SEASONS || "2024,2023")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 2000 && n < 2100);
  return parsed.length ? parsed : [2024, 2023];
})();
const DAILY_BUDGET = Math.max(
  0,
  Number(process.env.API_FOOTBALL_DAILY_BUDGET || "60")
);
const STRENGTH_TTL_MS = 24 * 60 * 60 * 1000; // 24h
/** Time-decay half-life in days (~1.5 years). */
const HALF_LIFE_DAYS = 550;

function client(): AxiosInstance | null {
  const key = process.env.SPORTS_API_KEY;
  if (!key) return null;
  return axios.create({
    baseURL: BASE.replace(/\/$/, ""),
    headers: { "x-apisports-key": key, "x-rapidapi-key": key },
    timeout: 25_000,
  });
}

// ---- budget guard (in-memory, per process) -------------------------------

let budgetDate = "";
let budgetCount = 0;
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function budgetRemaining(): number {
  if (budgetDate !== todayStr()) {
    budgetDate = todayStr();
    budgetCount = 0;
  }
  return Math.max(0, DAILY_BUDGET - budgetCount);
}
function noteRequest(): boolean {
  if (budgetRemaining() <= 0) return false;
  budgetCount++;
  return true;
}

// ---- caches (in-memory) --------------------------------------------------

const teamIdCache = new Map<string, number>(); // canon name -> api-football id
const strengthCache = new Map<
  number,
  { strength: TeamStrength; fetchedAt: number }
>();

function canon(name: string): string {
  const n = (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // A few provider variants -> one form.
  const aliases: Record<string, string> = {
    "cote d'ivoire": "ivory coast",
    türkiye: "turkey",
    usa: "united states",
    "u.s.": "united states",
    "korea republic": "south korea",
    "ir iran": "iran",
  };
  return aliases[n] || n;
}

function assertNoPlanError(data: any, ctx: string): void {
  const err = data?.errors;
  if (!err) return;
  if (typeof err === "object" && Object.keys(err).length === 0) return;
  if (Array.isArray(err) && err.length === 0) return;
  const msg =
    typeof err === "string"
      ? err
      : err.plan || err.token || err.requests || JSON.stringify(err);
  throw new Error(`api-football ${ctx}: ${msg}`);
}

// ---- team-id resolution --------------------------------------------------

async function resolveTeamId(
  http: AxiosInstance,
  name: string
): Promise<number | null> {
  const key = canon(name);
  const cached = teamIdCache.get(key);
  if (cached != null) return cached;
  if (!noteRequest()) return null;
  const { data } = await http.get("/teams", { params: { search: key } });
  assertNoPlanError(data, "teams search");
  const rows: Array<{
    team: { id: number; name: string; code?: string };
  }> = data.response || [];
  if (rows.length === 0) return null;
  // Prefer an exact (canonical) name match, else the first result.
  const exact = rows.find((r) => canon(r.team.name) === key);
  const pick = exact || rows[0];
  teamIdCache.set(key, pick.team.id);
  return pick.team.id;
}

// ---- last-N fixtures -----------------------------------------------------

interface ApiFixture {
  fixture: { id: number; date: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
}

async function fetchSeasonFixtures(
  http: AxiosInstance,
  teamId: number,
  season: number
): Promise<ApiFixture[]> {
  if (!noteRequest()) return [];
  const { data } = await http.get("/fixtures", {
    params: { team: teamId, season },
  });
  assertNoPlanError(data, "fixtures season");
  return (data.response || []) as ApiFixture[];
}

// ---- strength computation (time-decayed) ---------------------------------

function computeStrength(
  fixtures: ApiFixture[],
  teamId: number,
  teamName: string
): TeamStrength {
  const now = Date.now();
  let totalW = 0;
  let wGf = 0;
  let wGa = 0;
  let used = 0;
  for (const f of fixtures) {
    if (f.goals.home == null || f.goals.away == null) continue; // not finished
    const isHome = f.teams.home.id === teamId;
    const isAway = f.teams.away.id === teamId;
    if (!isHome && !isAway) continue;
    const ms = isHome ? f.goals.home : f.goals.away; // our goals
    const os = isHome ? f.goals.away : f.goals.home; // opponent goals
    if (ms == null || os == null) continue;
    const ageDays = (now - Date.parse(f.fixture.date)) / 86_400_000;
    const weight = Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS);
    totalW += weight;
    wGf += weight * ms;
    wGa += weight * os;
    used++;
  }
  const denom = totalW > 0 ? totalW : 1;
  return {
    games: used,
    gfRate: wGf / denom,
    gaRate: wGa / denom,
    sample: `api-football ${used} historical games (${teamName})`,
  };
}

// ---- public entry point --------------------------------------------------

/**
 * Best-effort historical strength for a team. Resolves null (engine falls back
 * to Elo) when: no API key, daily budget exhausted, network/plan error, or the
 * team can't be found. Results are cached for 24h.
 */
export async function getTeamStrength(
  teamName: string
): Promise<TeamStrength | null> {
  const http = client();
  if (!http) return null;
  try {
    const id = await resolveTeamId(http, teamName);
    if (id == null) return null;
    const cached = strengthCache.get(id);
    if (cached && Date.now() - cached.fetchedAt < STRENGTH_TTL_MS) {
      return cached.strength;
    }
    // Free plan has no `last` param -> query by season (2022-2024 allowed).
    // Fetch the configured seasons in parallel, accumulate, dedupe, cap.
    const all: ApiFixture[] = [];
    const results = await Promise.all(
      HISTORY_SEASONS.map((season) =>
        fetchSeasonFixtures(http, id, season).catch((e) => {
          console.warn(
            `[apiFootballHistory] season ${season} skipped:`,
            e instanceof Error ? e.message : e
          );
          return [] as ApiFixture[];
        })
      )
    );
    for (const r of results) all.push(...r);
    const seen = new Set<number>();
    const unique = all
      .filter((f) => {
        if (seen.has(f.fixture.id)) return false;
        seen.add(f.fixture.id);
        return true;
      })
      .sort((a, b) => Date.parse(b.fixture.date) - Date.parse(a.fixture.date))
      .slice(0, HISTORY_N);
    if (unique.length === 0) return null;
    const strength = computeStrength(unique, id, teamName);
    if (strength.games === 0) return null;
    strengthCache.set(id, { strength, fetchedAt: Date.now() });
    return strength;
  } catch (e) {
    // Never propagate — this layer is purely additive.
    console.warn(
      "[apiFootballHistory] getTeamStrength failed:",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}
