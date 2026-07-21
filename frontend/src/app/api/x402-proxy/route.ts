import { NextRequest, NextResponse } from "next/server";

const X402_ENDPOINT =
  process.env.X402_ENDPOINT_URL ||
  process.env.NEXT_PUBLIC_X402_URL_OVERRIDE ||
  process.env.FEEDER_URL?.replace(":4030", ":4021") ||
  "http://127.0.0.1:4021";

// Headers the x402 protocol reads/writes across the fetch boundary.
const PROXY_HEADERS = [
  "PAYMENT-REQUIRED",
  "PAYMENT-RESPONSE",
  "X-PAYMENT-RESPONSE",
  "PAYMENT-SIGNATURE",
  "X-PAYMENT",
  "CONTENT-TYPE",
];

export async function GET(req: NextRequest) {
  try {
    const upstream = new URL(X402_ENDPOINT);
    upstream.pathname = "/premium-stats";
    upstream.search = req.nextUrl.search;

    const init: RequestInit = {
      method: "GET",
      headers: {},
      signal: AbortSignal.timeout(180_000), // 3 min — x402 on-chain settlement on Injective testnet can be slow
    };
    for (const h of ["PAYMENT-SIGNATURE", "X-PAYMENT"]) {
      const v = req.headers.get(h);
      if (v) (init.headers as Record<string, string>)[h] = v;
    }

    const r = await fetch(upstream.toString(), init);
    const body = await r.text();

    const res = new NextResponse(body, {
      status: r.status,
      headers: { "Content-Type": r.headers.get("Content-Type") || "application/json" },
    });
    for (const h of PROXY_HEADERS) {
      const v = r.headers.get(h);
      if (v) res.headers.set(h, v);
    }
    // Expose the x402 protocol headers so the browser fetch can read them.
    res.headers.set(
      "Access-Control-Expose-Headers",
      "PAYMENT-REQUIRED,PAYMENT-RESPONSE,X-PAYMENT-RESPONSE"
    );
    return res;
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
        hint: "Ensure the x402-endpoint is running (npm run dev:x402).",
      },
      { status: 502 }
    );
  }
}
