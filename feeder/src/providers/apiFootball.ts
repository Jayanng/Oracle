import axios from "axios";
import type { Fixture, MatchEvent, SportsProvider, FixtureStatus } from "./types.js";

const BASE = process.env.SPORTS_API_BASE || "https://v3.football.api-sports.io";
const LEAGUE = Number(process.env.SPORTS_LEAGUE_ID || "1"); // FIFA World Cup
const SEASON = Number(process.env.SPORTS_SEASON || "2026");

function client() {
  const key = process.env.SPORTS_API_KEY;
  if (!key) throw new Error("SPORTS_API_KEY required for api-football provider");
  return axios.create({
    baseURL: BASE,
    headers: { "x-apisports-key": key },
    timeout: 20_000,
  });
}

function mapStatus(short: string): FixtureStatus {
  if (["1H", "2H", "ET", "BT", "P", "LIVE"].includes(short)) return "LIVE";
  if (short === "HT") return "HT";
  if (["FT", "AET", "PEN"].includes(short)) return "FT";
  if (["PST", "CANC", "ABD"].includes(short)) return "POSTP";
  if (short === "NS" || short === "TBD") return short === "TBD" ? "TBD" : "NS";
  return "NS";
}

export function createApiFootballProvider(): SportsProvider {
  return {
    name: "api-football",
    async listFixtures() {
      const http = client();
      const { data } = await http.get("/fixtures", {
        params: { league: LEAGUE, season: SEASON },
      });
      const rows = data.response || [];
      return rows.map((r: any): Fixture => ({
        matchId: r.fixture.id,
        home: r.teams.home.name,
        away: r.teams.away.name,
        homeFlag: r.teams.home.logo,
        awayFlag: r.teams.away.logo,
        kickoffUtc: r.fixture.date,
        status: mapStatus(r.fixture.status.short),
        scoreHome: r.goals.home,
        scoreAway: r.goals.away,
        venue: r.fixture.venue?.name,
        source: "api-football",
      }));
    },
    async getFixture(matchId: number) {
      const http = client();
      const { data } = await http.get("/fixtures", { params: { id: matchId } });
      const r = data.response?.[0];
      if (!r) return null;
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
        venue: r.fixture.venue?.name,
        source: "api-football",
      };
    },
    async getEvents(matchId: number) {
      const http = client();
      const { data } = await http.get("/fixtures/events", {
        params: { fixture: matchId },
      });
      const rows = data.response || [];
      const events: MatchEvent[] = rows.map((e: any) => ({
        uid: `${matchId}:${e.time.elapsed}:${e.type}:${e.team?.name}:${e.player?.name || ""}`,
        minute: e.time.elapsed || 0,
        type: String(e.type || "event").toLowerCase(),
        details: {
          team: e.team?.name,
          player: e.player?.name,
          assist: e.assist?.name,
          detail: e.detail,
        },
      }));

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
