import { createApiFootballProvider } from "./apiFootball.js";
import { createWorldCup26Provider } from "./worldcup26.js";
import type { Fixture, MatchEvent, SportsProvider } from "./types.js";

export type { Fixture, MatchEvent, SportsProvider } from "./types.js";

/**
 * hybrid:
 *  - Prefer API-Football when SPORTS_API_KEY is set
 *  - Free plan cannot use season=2026 → fall back to worldcup26 for schedule
 *  - Or set SPORTS_SEASON=2022 for real API-Football WC 2022 events
 */
export function getSportsProvider(): SportsProvider {
  const mode = (process.env.SPORTS_PROVIDER || "hybrid").toLowerCase();
  if (mode === "worldcup26") return createWorldCup26Provider();
  if (mode === "api-football") {
    if (!process.env.SPORTS_API_KEY) {
      throw new Error("SPORTS_API_KEY required when SPORTS_PROVIDER=api-football");
    }
    return createApiFootballProvider();
  }
  // hybrid
  if (process.env.SPORTS_API_KEY) {
    const primary = createApiFootballProvider();
    const fallback = createWorldCup26Provider();
    return {
      name: `hybrid(${primary.name}|worldcup26)`,
      async listFixtures() {
        try {
          return await primary.listFixtures();
        } catch (e) {
          console.warn(
            "[sports] api-football listFixtures failed, using worldcup26:",
            e instanceof Error ? e.message : e
          );
          return fallback.listFixtures();
        }
      },
      async getFixture(id) {
        try {
          const f = await primary.getFixture(id);
          if (f) return f;
        } catch {
          /* fall through */
        }
        return fallback.getFixture(id);
      },
      async getEvents(id) {
        try {
          return await primary.getEvents(id);
        } catch {
          return fallback.getEvents(id);
        }
      },
    };
  }
  return createWorldCup26Provider();
}
