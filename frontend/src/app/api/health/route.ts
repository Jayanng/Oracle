import { NextResponse } from "next/server";

// Server-side only — 127.0.0.1 works inside the container/Codespace
const FEEDER = process.env.FEEDER_URL || "http://127.0.0.1:4030";
const AGENT = process.env.AGENT_URL || "http://127.0.0.1:4020";
const X402 = process.env.X402_URL || "http://127.0.0.1:4021";

async function ping(url: string) {
  try {
    const r = await fetch(`${url}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return "down";
    return "up";
  } catch {
    return "down";
  }
}

export async function GET() {
  const [feeder, agent, x402] = await Promise.all([
    ping(FEEDER),
    ping(AGENT),
    ping(X402),
  ]);
  let fixtureCount = 0;
  try {
    const r = await fetch(`${FEEDER}/fixtures`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const d = await r.json();
      fixtureCount = (d.fixtures || []).length;
    }
  } catch {
    /* ignore */
  }
  return NextResponse.json({
    ok: true,
    feeder,
    agent,
    x402,
    fixtureCount,
    oracle: process.env.NEXT_PUBLIC_ORACLE_ADDRESS || null,
    drops: process.env.NEXT_PUBLIC_DROPS_ADDRESS || null,
    treasury: process.env.NEXT_PUBLIC_TREASURY_ADDRESS || null,
    chainId: process.env.NEXT_PUBLIC_INJ_EVM_CHAIN_ID || "1439",
  });
}
