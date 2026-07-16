import axios, { type AxiosInstance } from "axios";
import type { Fixture, MatchEvent, SportsProvider, FixtureStatus } from "./types.js";

/**
 * Official API-Football base URL (NOT RapidAPI unless you use RapidAPI headers):
 *   https://v3.football.api-sports.io
 * Auth header:
 *   x-apisports-key: YOUR_KEY
 * WC: league=1, season=2026 (paid) or season=2022 (free plan)
 * Docs: https://www.api-football.com/news/post/fifa-world-cup-2026-guide-to-using-data-with-api-sports
 */
const BASE =
  process.env.SPORTS_API_BASE || "https://v3.football.api-sports.io";
const LEAGUE = Number(process.env.SPORTS_LEAGUE_ID || "1"); // FIFA World Cup
// Free plan: 2022–2024 only. Paid: 2026.
const SEASON = Number(process.env.SPORTS_SEASON || "2022");

function client(): AxiosInstance {
  const key = process.env.SPORTS_API_KEY;
  if (!key) throw new Error("SPORTS_API_KEY required for api-football provider");
  return axios.create({
    baseURL: BASE.replace(/\/$/, ""),
    headers: {
      "x-apisports-key": key,
      // Also accepted by some gateways:
      "x-rapidapi-key": key,
    },
    timeout: 25_000,
  });
}

function assertNoPlanError(data: any, ctx: string) {
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

function mapStatus(short: string): FixtureStatus {
  if (["1H", "2H", "ET", "BT", "P", "LIVE"].includes(short)) return "LIVE";
  if (short === "HT") return "HT";
  if (["FT", "AET", "PEN"].includes(short)) return "FT";
  if (["PST", "CANC", "ABD"].includes(short)) return "POSTP";
  if (short === "NS" || short === "TBD") return short === "TBD" ? "TBD" : "NS";
  return "NS";
}

function mapRow(r: any): Fixture {
  return {
    matchId: r.fixture.id,
    home: r.teams.home.name,
    away: r.teams.away.name,
    homeFlag: r.teams.home.logo,
    awayFlag: r.teams.away.logo,
    kickoffUtc: r.fixture.date,
    status: mapStatus(r.fixture.status.short),
    scoreHome: r.goals.home,
    scoreAway: r.goals.away,
    group: r.league?.round,
    stage: r.league?.round,
    venue: r.fixture.venue?.name,
    source: "api-football",
  };
}

export function createApiFootballProvider(): SportsProvider {
  return {
    name: `api-football(league=${LEAGUE},season=${SEASON})`,
    async listFixtures() {
      const http = client();
      const { data } = await http.get("/fixtures", {
        params: { league: LEAGUE, season: SEASON },
      });
      assertNoPlanError(data, "fixtures");
      return (data.response || []).map(mapRow);
    },
    async getFixture(matchId: number) {
      const http = client();
      // Prefer batch-style single id (docs also support ids=ID1-ID2)
      const { data } = await http.get("/fixtures", { params: { id: matchId } });
      assertNoPlanError(data, "fixture");
      const r = data.response?.[0];
      return r ? mapRow(r) : null;
    },
    async getEvents(matchId: number) {
      const http = client();
      // Docs: fixtures/events?fixture=ID — or fixtures?id=ID embeds events
      const { data } = await http.get("/fixtures/events", {
        params: { fixture: matchId },
      });
      assertNoPlanError(data, "events");
      const rows = data.response || [];
      const events: MatchEvent[] = rows.map((e: any) => {
        const typeRaw = String(e.type || "event").toLowerCase();
        // Normalize Goal → goal for oracle
        const type =
          typeRaw === "goal"
            ? "goal"
            : typeRaw === "card"
              ? "card"
              : typeRaw === "subst"
                ? "sub"
                : typeRaw;
        return {
          uid: `${matchId}:${e.time?.elapsed}:${e.type}:${e.detail}:${e.team?.name}:${e.player?.name || ""}`,
          minute: e.time?.elapsed ?? 0,
          type,
          details: {
            team: e.team?.name,
            player: e.player?.name,
            assist: e.assist?.name,
            detail: e.detail,
          },
        };
      });

      const fx = await this.getFixture(matchId);
      if (fx?.status === "FT") {
        events.push({
          uid: `${matchId}:FT`,
          minute: 90,
          type: "final",
          details: {
            home: fx.scoreHome ?? 0,
            away: fx.scoreAway ?? 0,
            homeTeam: fx.home,
            awayTeam: fx.away,
          },
        });
      }
      return events;
    },
  };
}

/** Live WC matches only (status filter from API-Football guide) */
export async function fetchLiveWorldCupFixtures(): Promise<Fixture[]> {
  const http = client();
  const season = Number(process.env.SPORTS_SEASON || "2026");
  const { data } = await http.get("/fixtures", {
    params: {
      league: LEAGUE,
      season,
      status: "1H-HT-2H-ET-P-BT-LIVE",
    },
  });
  assertNoPlanError(data, "live");
  return (data.response || []).map(mapRow);
}
