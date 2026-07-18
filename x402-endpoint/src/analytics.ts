/**
 * Live match analytics engine.
 * Fetches computed analytics from the feeder's /premium-stats/:id endpoint.
 * The feeder has direct access to sports API data and on-chain events.
 */
import axios from "axios";

const FEEDER = process.env.FEEDER_URL || "http://127.0.0.1:4030";

export type PremiumStats = {
  matchId: number;
  home: string;
  away: string;
  score?: { home: number; away: number };
  status?: string;
  goals: { home: number; away: number; timeline: Array<{ minute: number; scorer: string }> };
  cards: { home: number; away: number };
  shots: { home: number; away: number };
  possession: { home: number; away: number };
  xg: { home: number; away: number };
  form: { home: string; away: string };
  h2h: string | null;
  prediction: { winner: string; confidence: string; reasoning: string };
  narrative: string;
  /** New probabilistic layer (Poisson/Dixon-Coles). */
  probabilities?: { home: number; draw: number; away: number };
  scorelines?: { score: string; probability: number }[];
  expectedGoals?: { home: number; away: number };
  model?: { type: string; inputs: string[]; dataCoverage: string };
  _source: string;
};

export async function computeAnalytics(matchId: number): Promise<PremiumStats> {
  const { data } = await axios.get(`${FEEDER}/premium-stats/${matchId}`, {
    timeout: 20_000,
  });
  return data as PremiumStats;
}