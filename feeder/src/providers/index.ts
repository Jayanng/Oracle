import { createApiFootballProvider } from "./apiFootball.js";
import { createWorldCup26Provider } from "./worldcup26.js";
import type { SportsProvider } from "./types.js";

export type { Fixture, MatchEvent, SportsProvider } from "./types.js";

export function getSportsProvider(): SportsProvider {
  const mode = (process.env.SPORTS_PROVIDER || "hybrid").toLowerCase();
  if (mode === "api-football") return createApiFootballProvider();
  if (mode === "worldcup26") return createWorldCup26Provider();
  // hybrid: real key → api-football, else free WC 2026 API
  if (process.env.SPORTS_API_KEY) return createApiFootballProvider();
  return createWorldCup26Provider();
}
