export type FixtureStatus = "NS" | "LIVE" | "HT" | "FT" | "POSTP" | "TBD";

export type Fixture = {
  /** Internal numeric id used on-chain — never expose in UI */
  matchId: number;
  home: string;
  away: string;
  homeFlag?: string;
  awayFlag?: string;
  /** ISO-8601 UTC instant */
  kickoffUtc?: string;
  /** Human label e.g. "19 Jul 2026 · 15:00 UTC" */
  kickoffUtcLabel?: string;
  status: FixtureStatus;
  scoreHome?: number | null;
  scoreAway?: number | null;
  group?: string;
  stage?: string;
  venue?: string;
  source: string;
};

export type MatchEvent = {
  uid: string;
  minute: number;
  type: string;
  details: Record<string, unknown>;
};

export interface SportsProvider {
  name: string;
  listFixtures(): Promise<Fixture[]>;
  getEvents(matchId: number): Promise<MatchEvent[]>;
  getFixture(matchId: number): Promise<Fixture | null>;
}
