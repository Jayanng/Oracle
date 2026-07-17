import { NextResponse } from "next/server";

const AGENT =
  process.env.AGENT_URL ||
  process.env.NEXT_PUBLIC_AGENT_URL ||
  "http://127.0.0.1:4020";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const r = await fetch(`${AGENT}/x402-demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await r.json();
    return NextResponse.json(data, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
        hint: "Start agent: npm run dev:agent",
      },
      { status: 502 }
    );
  }
}
