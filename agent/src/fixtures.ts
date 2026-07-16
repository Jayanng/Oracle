import axios from "axios";

export type PublicFixture = {
  id: number;
  label: string;
  home: string;
  away: string;
  status: string;
  scoreHome?: number | null;
  scoreAway?: number | null;
  kickoffUtc?: string;
  group?: string;
  stage?: string;
  source?: string;
};

const FEEDER = process.env.NEXT_PUBLIC_FEEDER_URL || process.env.FEEDER_URL || "http://localhost:4030";

let cache: PublicFixture[] = [];
let cachedAt = 0;

export async function loadFixtures(force = false): Promise<PublicFixture[]> {
  if (!force && cache.length && Date.now() - cachedAt < 30_000) return cache;
  try {
    const { data } = await axios.get(`${FEEDER}/fixtures`, { timeout: 15_000 });
    cache = data.fixtures || [];
    cachedAt = Date.now();
  } catch {
    // keep stale cache
  }
  return cache;
}

/** Resolve user text → internal match id (never shown to users as "match id") */
export async function resolveMatchId(text: string, fallback?: number): Promise<number | null> {
  const fixtures = await loadFixtures();
  const lower = text.toLowerCase();

  // explicit number only if user pasted one (agent internal)
  const num = text.match(/\b(\d{1,6})\b/);
  if (num) {
    const id = Number(num[1]);
    if (fixtures.some((f) => f.id === id)) return id;
  }

  // "Mexico vs South Africa" / "Argentina against France" — extract team names near the keyword
  const vsMatch = extractVsTeams(text);
  if (vsMatch) {
    const [a, b] = vsMatch;
    const hit = fixtures.find(
      (f) =>
        (f.home.toLowerCase().includes(a) && f.away.toLowerCase().includes(b)) ||
        (f.home.toLowerCase().includes(b) && f.away.toLowerCase().includes(a))
    );
    if (hit) return hit.id;
    // Both team names given but no match found — don't silently fallback
    return null;
  }

  // both team names in same fixture
  for (const f of fixtures) {
    if (lower.includes(f.home.toLowerCase()) && lower.includes(f.away.toLowerCase())) {
      return f.id;
    }
  }
  // single team name — narrow to matches mentioning that team
  for (const f of fixtures) {
    if (lower.includes(f.home.toLowerCase()) || lower.includes(f.away.toLowerCase())) {
      return f.id;
    }
  }

  // No team names at all in query — generic request, use fallback
  const live = fixtures.find((f) => f.status === "LIVE" || f.status === "HT");
  if (live) return live.id;
  const ft = fixtures.find((f) => f.status === "FT");
  if (ft) return ft.id;
  if (fallback != null) return fallback;
  return fixtures[0]?.id ?? null;
}

export function labelFor(id: number): string {
  const f = cache.find((x) => x.id === id);
  return f ? f.label : `Fixture ${id}`;
}

/** Extract up to 3 words around "vs" / "v" / "against" — avoids gobbling the query sentence */
const STOP_WORDS = new Set([
  "what", "was", "the", "for", "latest", "event", "show", "me", "get",
  "all", "list", "fixtures", "match", "between", "and", "against", "in",
  "of", "is", "are", "did", "do", "does", "has", "have", "been", "were",
  "will", "would", "could", "can", "from", "with", "any",
  "give", "predictions", "predict", "premium", "stats", "analytics", "xg",
  "live", "finished", "final", "score", "scores", "today",
]);

function extractVsTeams(text: string): [string, string] | null {
  const m = text.match(
    /\b(vs\.?|v|against)\b/i
  );
  if (!m) return null;
  const idx = (m.index ?? 0) + m[0].length;

  const before = text.slice(0, m.index ?? 0).trim();
  const beforeWords = before.split(/\s+/).filter((w) => w.length >= 2);
  const teamA = beforeWords
    .filter((w) => !STOP_WORDS.has(w.toLowerCase()))
    .slice(-3)
    .join(" ");

  const after = text.slice(idx).trim();
  const afterWords = after.split(/\s+/).filter((w) => w.length >= 2);
  const teamB = afterWords
    .filter((w) => !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 3)
    .join(" ");

  if (!teamA || !teamB) return null;
  return [teamA.toLowerCase().replace(/[^a-z\s-]/g, "").trim(), teamB.toLowerCase().replace(/[^a-z\s-]/g, "").trim()];
}
