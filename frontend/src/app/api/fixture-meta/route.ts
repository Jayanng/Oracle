import { NextResponse } from "next/server";
import { DEMO_MATCH_META } from "@/lib/contracts";

/** Returns fixture metadata; uses demo map, optional live API if key present. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id") || "0");

  if (id && DEMO_MATCH_META[id]) {
    return NextResponse.json({ id, ...DEMO_MATCH_META[id], source: "demo" });
  }

  const key = process.env.SPORTS_API_KEY;
  const base = process.env.SPORTS_API_BASE || "https://v3.football.api-sports.io";
  if (key && id) {
    try {
      const r = await fetch(`${base}/fixtures?id=${id}`, {
        headers: { "x-apisports-key": key },
        next: { revalidate: 60 },
      });
      const data = await r.json();
      const fx = data.response?.[0];
      if (fx) {
        return NextResponse.json({
          id,
          home: fx.teams.home.name,
          away: fx.teams.away.name,
          homeFlag: fx.teams.home.logo,
          awayFlag: fx.teams.away.logo,
          status: fx.fixture.status.short,
          score: fx.goals,
          source: "api-football",
        });
      }
    } catch {
      /* fall through */
    }
  }

  if (id) {
    return NextResponse.json({
      id,
      home: `Home #${id}`,
      away: `Away #${id}`,
      homeFlag: "⚽",
      awayFlag: "⚽",
      source: "fallback",
    });
  }

  return NextResponse.json({
    fixtures: Object.entries(DEMO_MATCH_META).map(([k, v]) => ({
      id: Number(k),
      ...v,
    })),
  });
}
