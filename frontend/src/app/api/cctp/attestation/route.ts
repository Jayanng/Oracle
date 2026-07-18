import { NextResponse } from "next/server";

const IRIS_API = process.env.CCTP_ATTESTATION_API || "https://iris-api-sandbox.circle.com";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const txHash = searchParams.get("txHash");
    const sourceDomain = searchParams.get("sourceDomain") || "29";

    if (!txHash) {
      return NextResponse.json({ error: "txHash required" }, { status: 400 });
    }

    const url = `${IRIS_API}/v2/messages/${sourceDomain}?transactionHash=${txHash}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Iris API ${res.status}: ${text}` }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
