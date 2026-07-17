import axios from "axios";
import type { Fixture, MatchEvent, SportsProvider, FixtureStatus } from "./types.js";

const BASE = process.env.WORLDCUP26_API_BASE || "https://worldcup26.ir";

type WcGame = {
  id: string;
  home_team_id?: string;
  away_team_id?: string;
  home_team_name_en?: string | null;
  away_team_name_en?: string | null;
  home_team_label?: string | null;
  away_team_label?: string | null;
  home_score?: string;
  away_score?: string;
  home_scorers?: string;
  away_scorers?: string;
  group?: string;
  local_date?: string;
  finished?: string;
  time_elapsed?: string;
  type?: string;
  stadium_id?: string;
};

/**
 * worldcup26 `local_date` is venue-local wall clock (not UTC).
 * Tournament is Jun–Jul 2026 → use summer offsets.
 * Final MetLife 15:00 ET = 19:00 UTC (EDT = UTC−4).
 */
const STADIUM_UTC_OFFSET_HOURS: Record<string, number> = {
  // Mexico (no DST since 2022 → UTC−6)
  "1": -6, // Azteca / Mexico City
  "2": -6, // Akron / Guadalajara
  "3": -6, // BBVA / Monterrey
  // US Central (CDT UTC−5 in summer)
  "4": -5, // Dallas
  "5": -5, // Houston
  "6": -5, // Kansas City
  // US Eastern (EDT UTC−4 in summer)
  "7": -4, // Atlanta
  "8": -4, // Miami
  "9": -4, // Boston
  "10": -4, // Philadelphia
  "11": -4, // MetLife NY/NJ — Final
  // Canada
  "12": -4, // Toronto (EDT)
  "13": -7, // Vancouver (PDT)
  // US Pacific (PDT UTC−7)
  "14": -7, // Seattle
  "15": -7, // San Francisco / Santa Clara
  "16": -7, // Los Angeles / SoFi
};

function mapStatus(g: WcGame): FixtureStatus {
  const te = (g.time_elapsed || "").toLowerCase();
  const fin = (g.finished || "").toUpperCase() === "TRUE";
  if (fin || te === "finished" || te === "ft") return "FT";
  if (te.includes("live") || te.includes("half") || /^\d+$/.test(te)) return "LIVE";
  if (te === "notstarted" || te === "") return "NS";
  return "NS";
}

/**
 * Convert venue-local "MM/DD/YYYY HH:mm" → true UTC using stadium offset.
 * Example: Final 07/19/2026 15:00 at MetLife (UTC−4) → 19:00 UTC.
 */
export function parseKickoffToUtc(
  localDate?: string,
  stadiumId?: string
): {
  kickoffUtc: string | undefined;
  kickoffUtcLabel: string | undefined;
} {
  if (!localDate) return { kickoffUtc: undefined, kickoffUtcLabel: undefined };

  // Already absolute ISO with Z or offset
  if (/T.*([Zz]|[+-]\d{2}:?\d{2})$/.test(localDate) || localDate.endsWith("Z")) {
    const d = new Date(localDate);
    if (!Number.isNaN(d.getTime())) {
      return { kickoffUtc: d.toISOString(), kickoffUtcLabel: formatUtcLabel(d) };
    }
  }

  const m = localDate.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/
  );
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const offsetH: number =
      stadiumId != null && STADIUM_UTC_OFFSET_HOURS[String(stadiumId)] != null
        ? STADIUM_UTC_OFFSET_HOURS[String(stadiumId)]
        : -4; // default Eastern
    // local wall = UTC + offsetHours (offset is negative west of UTC)
    // => UTC ms = Date.UTC(local components) - offsetHours * 1h
    const utcMs =
      Date.UTC(year, month - 1, day, hour, minute, 0) - offsetH * 3_600_000;
    const d = new Date(utcMs);
    return { kickoffUtc: d.toISOString(), kickoffUtcLabel: formatUtcLabel(d) };
  }

  const d = new Date(localDate);
  if (!Number.isNaN(d.getTime())) {
    return { kickoffUtc: d.toISOString(), kickoffUtcLabel: formatUtcLabel(d) };
  }
  return { kickoffUtc: localDate, kickoffUtcLabel: String(localDate) };
}

function formatUtcLabel(d: Date): string {
  // e.g. 19 Jul 2026 · 15:00 UTC
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const dd = d.getUTCDate();
  const mon = months[d.getUTCMonth()];
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd} ${mon} ${yyyy} · ${hh}:${mm} UTC`;
}

function parseScorers(raw: string | undefined, team: string): MatchEvent[] {
  if (!raw || raw === "null") return [];
  const out: MatchEvent[] = [];
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

function teamFromGame(
  g: WcGame,
  side: "home" | "away",
  byId: Map<number, WcGame>
): string {
  const name =
    side === "home" ? g.home_team_name_en : g.away_team_name_en;
  if (name && String(name).trim() && name !== "null") return String(name).trim();

  const label =
    side === "home" ? g.home_team_label : g.away_team_label;
  if (label) {
    const resolved = resolveBracketLabel(String(label), byId);
    if (resolved) return resolved;
    // Humanize placeholder: "Winner Match 101" → "Winner SF1 (M101)"
    return humanizeLabel(String(label));
  }

  const tid = side === "home" ? g.home_team_id : g.away_team_id;
  if (tid && tid !== "0") return `Team #${tid}`;
  return "TBD";
}

function humanizeLabel(label: string): string {
  // Winner Match 101 → Winner of SF (Match 101)
  const m = label.match(/^(Winner|Loser)\s+Match\s+(\d+)$/i);
  if (m) {
    const role = m[1];
    const id = Number(m[2]);
    const stage = stageForMatchId(id);
    return `${role} of ${stage}`;
  }
  return label;
}

function stageForMatchId(id: number): string {
  if (id >= 101 && id <= 102) return `Semi-final ${id - 100}`;
  if (id >= 97 && id <= 100) return `Quarter-final ${id - 96}`;
  if (id >= 89 && id <= 96) return `R16 M${id}`;
  if (id >= 73 && id <= 88) return `R32 M${id}`;
  return `Match ${id}`;
}

/** Walk bracket placeholders using finished match scores */
function resolveBracketLabel(
  label: string,
  byId: Map<number, WcGame>
): string | null {
  const m = label.match(/^(Winner|Loser)\s+Match\s+(\d+)$/i);
  if (!m) return null;
  const wantWinner = m[1].toLowerCase() === "winner";
  const refId = Number(m[2]);
  const ref = byId.get(refId);
  if (!ref) return null;

  // Recurse if ref also only has labels
  const home = resolveSideName(ref, "home", byId, 0);
  const away = resolveSideName(ref, "away", byId, 0);
  const hs = Number(ref.home_score);
  const as = Number(ref.away_score);
  const finished =
    (ref.finished || "").toUpperCase() === "TRUE" ||
    (ref.time_elapsed || "").toLowerCase() === "finished";

  if (!finished || Number.isNaN(hs) || Number.isNaN(as)) {
    // Prefer concrete names if already filled
    if (home && home !== "TBD" && !home.startsWith("Winner") && !home.startsWith("Loser")) {
      if (away && away !== "TBD" && !away.startsWith("Winner") && !away.startsWith("Loser")) {
        // match not finished — can't pick winner
        return null;
      }
    }
    return null;
  }

  if (hs === as) {
    // penalties fields if present
    const hp = Number((ref as any).home_penalty_score);
    const ap = Number((ref as any).away_penalty_score);
    if (!Number.isNaN(hp) && !Number.isNaN(ap) && hp !== ap) {
      const win = hp > ap ? home : away;
      const lose = hp > ap ? away : home;
      return wantWinner ? win : lose;
    }
    return null;
  }
  const win = hs > as ? home : away;
  const lose = hs > as ? away : home;
  return wantWinner ? win : lose;
}

function resolveSideName(
  g: WcGame,
  side: "home" | "away",
  byId: Map<number, WcGame>,
  depth: number
): string {
  if (depth > 6) return "TBD";
  const name =
    side === "home" ? g.home_team_name_en : g.away_team_name_en;
  if (name && String(name).trim() && name !== "null") return String(name).trim();

  const label =
    side === "home" ? g.home_team_label : g.away_team_label;
  if (label) {
    const resolved = resolveBracketLabel(String(label), byId);
    if (resolved) return resolved;
    return humanizeLabel(String(label));
  }
  return "TBD";
}

function mapGames(games: WcGame[]): Fixture[] {
  const byId = new Map<number, WcGame>();
  for (const g of games) byId.set(Number(g.id), g);

  return games.map((g) => {
    const home = resolveSideName(g, "home", byId, 0);
    const away = resolveSideName(g, "away", byId, 0);
    const { kickoffUtc, kickoffUtcLabel } = parseKickoffToUtc(
      g.local_date,
      g.stadium_id
    );
    return {
      matchId: Number(g.id),
      home,
      away,
      kickoffUtc,
      kickoffUtcLabel,
      status: mapStatus(g),
      scoreHome: g.home_score != null ? Number(g.home_score) : null,
      scoreAway: g.away_score != null ? Number(g.away_score) : null,
      group: g.group,
      stage: g.type,
      source: "worldcup26",
    } as Fixture;
  });
}

export function createWorldCup26Provider(): SportsProvider {
  let cache: Fixture[] | null = null;
  let gamesRaw: WcGame[] = [];
  let cachedAt = 0;

  async function refresh() {
    if (cache && Date.now() - cachedAt < 60_000) return;
    try {
      const { data } = await axios.get(`${BASE}/get/games`, { timeout: 20_000 });
      gamesRaw = data.games || data || [];
      cache = mapGames(gamesRaw);
      cachedAt = Date.now();
    } catch (e) {
      // DNS / network blips are common — keep serving last good snapshot
      if (cache && cache.length) {
        console.warn(
          "[worldcup26] refresh failed, using stale cache:",
          e instanceof Error ? e.message : e
        );
        return;
      }
      throw e;
    }
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
      const fx = (cache || []).find((f) => f.matchId === matchId);
      const home = fx?.home || g.home_team_name_en || "Home";
      const away = fx?.away || g.away_team_name_en || "Away";
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
