export type PublicFixture = {
  id: number;
  label: string;
  home: string;
  away: string;
  homeFlag?: string;
  awayFlag?: string;
  kickoffUtc?: string;
  kickoffUtcLabel?: string;
  status: string;
  scoreHome?: number | null;
  scoreAway?: number | null;
  group?: string;
  stage?: string;
  stageLabel?: string;
  source?: string;
};

export async function fetchFixtures(): Promise<PublicFixture[]> {
  try {
    const r = await fetch("/api/fixtures", { cache: "no-store" });
    const data = await r.json();
    return (data.fixtures as PublicFixture[]) || [];
  } catch {
    return [];
  }
}

export function statusLabel(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "NS" || s === "TBD" || s === "SCHEDULED") return "UPCOMING";
  if (s === "LIVE" || s === "1H" || s === "2H") return "LIVE";
  if (s === "HT") return "HT";
  if (s === "FT" || s === "AET" || s === "PEN") return "FT";
  return status || "—";
}
