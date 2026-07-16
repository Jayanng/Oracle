import { NextResponse } from "next/server";

const FEEDER = process.env.FEEDER_URL || process.env.NEXT_PUBLIC_FEEDER_URL || "http://127.0.0.1:4030";

export async function GET() {
  try {
    const r = await fetch(`${FEEDER}/fixtures`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const data = await r.json();
    return NextResponse.json(data, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      {
        fixtures: [],
        error: e instanceof Error ? e.message : String(e),
        hint: "Start feeder: npm run dev:feeder",
      },
      { status: 502 }
    );
  }
}
