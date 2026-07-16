/**
 * x402 paywalled premium stats endpoint.
 *
 * Uses vanilla HTTP 402 + EIP-712 Payment authorization (guide pattern).
 * @injectivelabs/x402 is verified available (0.0.1) for production EIP-3009
 * settlement — see docs/verification.md. This endpoint is demo-reliable
 * without a facilitator or USDC balance.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { verifyTypedData } from "viem";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const RECEIVER = (process.env.X402_RECEIVER_ADDRESS ||
  "0x0000000000000000000000000000000000000001") as `0x${string}`;
const CHAIN_ID = Number(process.env.INJ_EVM_CHAIN_ID || "1439");
const TOKEN = (process.env.USDC_TESTNET_ADDRESS ||
  "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d") as `0x${string}`;
const AMOUNT = process.env.X402_AMOUNT || "100000"; // 0.10 USDC (6dp)

const seen = new Set<string>();
const paymentLog: Array<Record<string, unknown>> = [];

const PAYMENT_TYPES = {
  Payment: [
    { name: "payer", type: "address" },
    { name: "receiver", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "x402-endpoint", payments: paymentLog.length });
});

app.get("/premium-stats", async (req, res) => {
  const header = req.header("X-PAYMENT") || req.header("PAYMENT-SIGNATURE");
  if (!header) {
    const nonce =
      ("0x" + randomUUID().replace(/-/g, "").padEnd(64, "0")) as `0x${string}`;
    return res.status(402).json({
      x402Version: 1,
      error: "Payment required",
      chainId: CHAIN_ID,
      receiver: RECEIVER,
      token: TOKEN,
      amount: AMOUNT,
      nonce,
      expiry: Math.floor(Date.now() / 1000) + 300,
      accepts: [
        {
          scheme: "exact",
          network: `eip155:${CHAIN_ID}`,
          maxAmountRequired: AMOUNT,
          asset: TOKEN,
          payTo: RECEIVER,
        },
      ],
    });
  }

  try {
    const payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    if (seen.has(payload.nonce)) {
      return res.status(402).json({ error: "nonce reused" });
    }
    if (Number(payload.expiry) < Math.floor(Date.now() / 1000)) {
      return res.status(402).json({ error: "payment expired" });
    }

    const ok = await verifyTypedData({
      address: payload.payer as `0x${string}`,
      domain: { name: "x402", version: "1", chainId: CHAIN_ID },
      types: PAYMENT_TYPES,
      primaryType: "Payment",
      message: {
        payer: payload.payer,
        receiver: payload.receiver,
        token: payload.token,
        amount: BigInt(payload.amount),
        nonce: payload.nonce,
        expiry: BigInt(payload.expiry),
      },
      signature: payload.signature as `0x${string}`,
    });

    if (!ok) return res.status(402).json({ error: "bad sig" });
    if (payload.receiver?.toLowerCase() !== RECEIVER.toLowerCase()) {
      return res.status(402).json({ error: "wrong receiver" });
    }

    seen.add(payload.nonce);
    const entry = {
      at: new Date().toISOString(),
      payer: payload.payer,
      amount: payload.amount,
      nonce: payload.nonce,
      matchId: Number(req.query.matchId || 0),
    };
    paymentLog.unshift(entry);

    res.json({
      matchId: Number(req.query.matchId || 0),
      xg: { home: 1.34, away: 1.87 },
      possession: { home: 44, away: 56 },
      shots: { home: 9, away: 14 },
      keyPasses: { home: 6, away: 11 },
      narrative:
        "France slightly favored on xG; Argentina more efficient finishing.",
      _paid: entry,
      _protocol: "x402-eip712-v1",
    });
  } catch (e) {
    res.status(402).json({
      error: "invalid payment header",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/payments", (_req, res) => {
  res.json({ payments: paymentLog.slice(0, 50) });
});

const port = Number(process.env.X402_PORT || "4021");
app.listen(port, () => {
  console.log(`x402 endpoint on :${port} (receiver ${RECEIVER})`);
});
