import axios from "axios";
import type { Fixture, MatchEvent, SportsProvider, FixtureStatus } from "./types.js";

const BASE = process.env.WORLDCUP26_API_BASE || "https://worldcup26.ir";

type WcGame = {
  id: string;
  home_team_name_en?: string;
  away_team_name_en?: string;
  home_score?: string;
  away_score?: string;
  home_scorers?: string;
  away_scorers?: string;
  group?: string;
  local_date?: string;
  finished?: string;
  time_elapsed?: string;
  type?: string;
};

function mapStatus(g: WcGame): FixtureStatus {
  const te = (g.time_elapsed || "").toLowerCase();
  const fin = (g.finished || "").toUpperCase() === "TRUE";
  if (fin || te === "finished" || te === "ft") return "FT";
  if (te.includes("live") || te.includes("half") || /^\d+$/.test(te)) return "LIVE";
  if (te === "notstarted" || te === "") return "NS";
  return "NS";
}

function parseScorers(raw: string | undefined, team: string): MatchEvent[] {
  if (!raw || raw === "null") return [];
  const out: MatchEvent[] = [];
  // formats: {"Player 27'","Other 75'"} or {"Name 90'+5'"}
  const re = /"?([^"{]+?)\s+(\d+)(?:'\+?\d*)?'?"?/g;
  let m: RegExpExecArray | null;
  const s = raw.replace(/[{}]/g, "");
  while ((m = re.exec(s)) !== null) {
    const player = m[1].replace(/^"|"$/g, "").trim();
    const minute = Number(m[2]);
    if (!player || Number.isNaN(minute)) continue;
    out.push({
      uid: `goal:${team}:${minute}:${player}`,
      minute,
      type: "goal",
      details: { team, player, source: "worldcup26" },
    });
  }
  return out;
}

function mapGame(g: WcGame): Fixture {
  const matchId = Number(g.id);
  return {
    matchId,
    home: g.home_team_name_en || "TBD",
    away: g.away_team_name_en || "TBD",
    kickoffUtc: g.local_date,
    status: mapStatus(g),
    scoreHome: g.home_score != null ? Number(g.home_score) : null,
    scoreAway: g.away_score != null ? Number(g.away_score) : null,
    group: g.group,
    stage: g.type,
    source: "worldcup26",
  };
}

export function createWorldCup26Provider(): SportsProvider {
  let cache: Fixture[] | null = null;
  let gamesRaw: WcGame[] = [];
  let cachedAt = 0;

  async function refresh() {
    if (cache && Date.now() - cachedAt < 60_000) return;
    const { data } = await axios.get(`${BASE}/get/games`, { timeout: 20_000 });
    gamesRaw = data.games || data || [];
    cache = gamesRaw.map(mapGame);
    cachedAt = Date.now();
  }

  return {
    name: "worldcup26",
    async listFixtures() {
      await refresh();
      return cache || [];
    },
    async getFixture(matchId: number) {
      await refresh();
      return (cache || []).find((f) => f.matchId === matchId) || null;
    },
    async getEvents(matchId: number) {
      await refresh();
      const g = gamesRaw.find((x) => Number(x.id) === matchId);
      if (!g) return [];
      const home = g.home_team_name_en || "Home";
      const away = g.away_team_name_en || "Away";
      const events: MatchEvent[] = [
        ...parseScorers(g.home_scorers, home),
        ...parseScorers(g.away_scorers, away),
      ].sort((a, b) => a.minute - b.minute);

      if (mapStatus(g) === "FT") {
        events.push({
          uid: `final:${matchId}`,
          minute: 90,
          type: "final",
          details: {
            home: Number(g.home_score || 0),
            away: Number(g.away_score || 0),
            homeTeam: home,
            awayTeam: away,
          },
        });
      }
      return events;
    },
  };
}
