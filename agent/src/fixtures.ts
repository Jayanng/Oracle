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

  // "Mexico vs South Africa" / "Argentina against France"
  const vs = lower.match(/([a-z\s.]+?)\s+(?:vs\.?|v|against)\s+([a-z\s.]+)/i);
  if (vs) {
    const a = vs[1].trim();
    const b = vs[2].trim();
    const hit = fixtures.find(
      (f) =>
        (f.home.toLowerCase().includes(a) && f.away.toLowerCase().includes(b)) ||
        (f.home.toLowerCase().includes(b) && f.away.toLowerCase().includes(a))
    );
    if (hit) return hit.id;
  }

  // single team name
  for (const f of fixtures) {
    if (lower.includes(f.home.toLowerCase()) && lower.includes(f.away.toLowerCase())) {
      return f.id;
    }
  }
  for (const f of fixtures) {
    if (lower.includes(f.home.toLowerCase()) || lower.includes(f.away.toLowerCase())) {
      return f.id;
    }
  }

  // prefer LIVE then first FT then first NS
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
