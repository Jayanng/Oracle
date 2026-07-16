import { NextResponse } from "next/server";

const FEEDER = process.env.NEXT_PUBLIC_FEEDER_URL || "http://localhost:4030";
const AGENT = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:4020";
const X402 = process.env.NEXT_PUBLIC_X402_URL || "http://localhost:4021";

async function ping(url: string) {
  try {
    const r = await fetch(`${url}/health`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
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
  return NextResponse.json({
    ok: true,
    feeder,
    agent,
    x402,
    oracle: process.env.NEXT_PUBLIC_ORACLE_ADDRESS || null,
    rewards: process.env.NEXT_PUBLIC_REWARDS_ADDRESS || null,
    chainId: process.env.NEXT_PUBLIC_INJ_EVM_CHAIN_ID || "1439",
  });
}
