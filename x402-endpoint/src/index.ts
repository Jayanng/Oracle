/**
 * x402 paywalled premium stats — Injective EVM.
 *
 * Official path: @injectivelabs/x402 injectivePaymentMiddleware
 *   → HTTP 402 → EIP-3009 USDC auth → on-chain settlement via OracleTreasury
 *
 * Demo path (X402_MODE=demo): Vanilla EIP-712 signature only.
 *
 * Metered endpoints:
 *   GET /premium-stats?matchId=…  — 0.10 USDC
 *   GET /historical-events?matchId=…&from=…&to=… — 0.25 USDC
 *   GET /webhooks/subscribe?matchId=…&url=… — 1.00 USDC
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { verifyTypedData } from "viem";
import { randomUUID } from "crypto";
import { injectivePaymentMiddleware } from "@injectivelabs/x402/middleware";
import {
  INJECTIVE_TESTNET_CAIP2,
  INJECTIVE_MAINNET_CAIP2,
  TOKENS,
} from "@injectivelabs/x402/networks";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex, Address } from "viem";
import { computeAnalytics } from "./analytics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const app = express();
// Expose x402 protocol headers so browser clients (fetch) can read the
// payment challenge and settlement receipt across origins.
app.use(
  cors({
    exposedHeaders: [
      "PAYMENT-REQUIRED",
      "PAYMENT-RESPONSE",
      "X-PAYMENT-RESPONSE",
    ],
    allowedHeaders: [
      "Content-Type",
      "PAYMENT-SIGNATURE",
      "X-PAYMENT",
    ],
  })
);

const CHAIN_ID = Number(process.env.INJ_EVM_CHAIN_ID || "1439");
const NETWORK =
  CHAIN_ID === 1776 ? INJECTIVE_MAINNET_CAIP2 : INJECTIVE_TESTNET_CAIP2;

const CIRCLE_USDC =
  (TOKENS[NETWORK]?.USDC?.address as Address | undefined) ||
  (CHAIN_ID === 1776
    ? "0xa00C59fF5a080D2b954d0c75e46E22a0c371235a"
    : "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d") as Address;

const RECEIVER = (process.env.X402_RECEIVER_ADDRESS ||
  process.env.AGENT_ADDRESS ||
  "") as Address;
if (!RECEIVER) {
  console.warn(
    "[x402] X402_RECEIVER_ADDRESS (or AGENT_ADDRESS) is not set — payments cannot be routed. Set X402_RECEIVER_ADDRESS in .env."
  );
}

// Treasury contract for on-chain settlement
const TREASURY = process.env.TREASURY_ADDRESS as Address | undefined;

// Amounts per endpoint (in USDC 6dp)
const PRICE_STATS = process.env.X402_STATS_PRICE || "100000";    // 0.10 USDC
const PRICE_HISTORICAL = process.env.X402_HISTORICAL_PRICE || "250000";  // 0.25 USDC
const PRICE_WEBHOOK = process.env.X402_WEBHOOK_PRICE || "1000000";  // 1.00 USDC

const FACILITATOR_PK = (process.env.X402_FACILITATOR_PRIVATE_KEY ||
  process.env.AGENT_PRIVATE_KEY ||
  "") as Hex | "";

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "";

const modeEnv = (process.env.X402_MODE || "auto").toLowerCase();
const canOfficial = Boolean(FACILITATOR_PK || FACILITATOR_URL);
const MODE =
  modeEnv === "demo" ? "demo"
  : modeEnv === "official" ? "official"
  : canOfficial ? "official"
  : "demo";

const paymentLog: Array<Record<string, unknown>> = [];
let totalRevenueUsdc: number = 0;

// ---- Chain clients for on-chain settlement ----
function getChain() {
  return {
    id: CHAIN_ID,
    name: "Injective EVM Testnet",
    nativeCurrency: { name: "INJ", symbol: "INJ", decimals: 18 },
    rpcUrls: {
      default: {
        http: [
          process.env.INJ_EVM_RPC || "https://k8s.testnet.json-rpc.injective.network",
        ],
      },
    },
  } as const;
}

const TREASURY_ABI = parseAbi([
  "function pullPayment(address payer, uint256 amount)",
  "function recordRevenue(uint256 amount)",
  "function totalRevenue() view returns (uint256)",
]);

const USDC_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

/** Attempt to settle payment on-chain via OracleTreasury.pullPayment */
async function settleOnChain(payer: Address, amount: string): Promise<boolean> {
  if (!TREASURY || MODE === "demo") return false;
  const pk = FACILITATOR_PK;
  if (!pk) return false;

  try {
    const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}` as Hex);
    const chain = getChain();
    const transport = http();
    const wallet = createWalletClient({ account, chain, transport });
    const pub = createPublicClient({ chain, transport });

    // The agent must have pre-approved USDC to the treasury.
    // The endpoint (settler) calls treasury.pullPayment(payer, amount)
    // which does USDC.transferFrom(payer, treasury, amount) internally.
    const hash = await wallet.writeContract({
      address: TREASURY,
      abi: TREASURY_ABI,
      functionName: "pullPayment",
      args: [payer, BigInt(amount)],
    } as any);
    await pub.waitForTransactionReceipt({ hash });
    totalRevenueUsdc += Number(amount) / 1e6;
    return true;
  } catch (e) {
    console.warn("[x402] on-chain settlement failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

// ---- Health ----
app.get("/health", async (_req, res) => {
  let chainRevenue = totalRevenueUsdc;
  if (TREASURY) {
    try {
      const pub = createPublicClient({ chain: getChain(), transport: http() });
      const rev = await pub.readContract({
        address: TREASURY,
        abi: TREASURY_ABI,
        functionName: "totalRevenue",
      });
      chainRevenue = Number(rev) / 1e6;
    } catch { /* use in-memory fallback */ }
  }
  res.json({
    ok: true,
    service: "x402-endpoint",
    mode: MODE,
    network: NETWORK,
    chainId: CHAIN_ID,
    revenueUsdc: chainRevenue,
    payments: paymentLog.length,
  });
});

// ---- Premium analytics payload ----
async function premiumPayload(matchId: number, protocol: string) {
  try {
    const stats = await computeAnalytics(matchId);
    return { ...stats, _paid: true, _protocol: protocol, _network: NETWORK, _chainId: CHAIN_ID };
  } catch (e) {
    console.warn("[x402] analytics fetch failed:", e instanceof Error ? e.message : e);
    // Do NOT fabricate stats after a payment has been taken. Return an honest
    // error so the UI/agent can surface "analytics temporarily unavailable"
    // without presenting invented numbers as real data.
    return {
      matchId,
      _paid: true,
      _protocol: protocol,
      _network: NETWORK,
      _chainId: CHAIN_ID,
      _error: "analytics_unavailable",
      _source: "unavailable",
      message:
        "Payment was processed, but live analytics are temporarily unavailable (feeder unreachable). Please try again shortly.",
    };
  }
}

// ---- Official x402 middleware ----
if (MODE === "official") {
  const middlewareOpts: Parameters<typeof injectivePaymentMiddleware>[1] = {
    settlementPolicy: "before",
    baseUrl: process.env.X402_BASE_URL || `http://127.0.0.1:${process.env.X402_PORT || "4021"}`,
  };

  if (FACILITATOR_URL) {
    middlewareOpts.facilitatorUrl = FACILITATOR_URL;
  } else if (FACILITATOR_PK) {
    middlewareOpts.facilitator = {
      privateKey: FACILITATOR_PK.startsWith("0x") ? FACILITATOR_PK : (`0x${FACILITATOR_PK}` as Hex),
      rpcUrl: process.env.INJ_EVM_RPC || "https://k8s.testnet.json-rpc.injective.network",
      allowedAssets: [CIRCLE_USDC.toLowerCase()],
      minPaymentPerAsset: { [CIRCLE_USDC.toLowerCase()]: "1000" },
    };
  }

  app.use(
    injectivePaymentMiddleware(
      {
        "GET /premium-stats": {
          description: "Premium World Cup match analytics — pay-per-request on Injective",
          mimeType: "application/json",
          accepts: [{ network: NETWORK, asset: CIRCLE_USDC, amount: PRICE_STATS, payTo: RECEIVER, maxTimeoutSeconds: 900 }],
        },
        "GET /historical-events": {
          description: "Historical match events filtered by time range",
          mimeType: "application/json",
          accepts: [{ network: NETWORK, asset: CIRCLE_USDC, amount: PRICE_HISTORICAL, payTo: RECEIVER, maxTimeoutSeconds: 900 }],
        },
        "GET /webhooks/subscribe": {
          description: "Subscribe to real-time webhook notifications for a match",
          mimeType: "application/json",
          accepts: [{ network: NETWORK, asset: CIRCLE_USDC, amount: PRICE_WEBHOOK, payTo: RECEIVER, maxTimeoutSeconds: 900 }],
        },
      },
      middlewareOpts
    )
  );

  app.get("/premium-stats", async (req, res) => {
    const matchId = Number(req.query.matchId || 0);
    // On-chain settlement is handled by the middleware automatically
    res.json(await premiumPayload(matchId, "@injectivelabs/x402-eip3009"));
  });

  app.get("/historical-events", async (req, res) => {
    const matchId = Number(req.query.matchId || 0);
    const from = Number(req.query.from || 0);
    const to = Number(req.query.to || 90);
    res.json({
      matchId,
      from,
      to,
      events: [], // stubbed for demo
      _paid: true,
      _protocol: "@injectivelabs/x402-eip3009",
    });
  });

  app.get("/webhooks/subscribe", async (req, res) => {
    const matchId = Number(req.query.matchId || 0);
    const url = String(req.query.url || "");
    const subscriptionId = `sub_${randomUUID().slice(0, 8)}`;
    res.json({
      subscriptionId,
      matchId,
      webhookUrl: url,
      status: "active",
      _paid: true,
      _protocol: "@injectivelabs/x402-eip3009",
    });
  });

  console.log(`[x402] OFFICIAL mode · network=${NETWORK} · asset=${CIRCLE_USDC}`);
} else {
  // ---- Demo mode: EIP-712 auth only ----
  const TOKEN = (process.env.USDC_TESTNET_ADDRESS || CIRCLE_USDC) as Address;
  const seen = new Set<string>();

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

  async function handlePayment(req: express.Request): Promise<{ payer: Address; amount: string } | null> {
    const header = req.header("X-PAYMENT") || req.header("PAYMENT-SIGNATURE");
    if (!header) return null;
    const payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    if (seen.has(payload.nonce)) throw new Error("nonce reused");
    if (Number(payload.expiry) < Math.floor(Date.now() / 1000)) throw new Error("payment expired");

    const ok = await verifyTypedData({
      address: payload.payer as Address,
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
      signature: payload.signature as Hex,
    });
    if (!ok) throw new Error("bad sig");
    if (payload.receiver?.toLowerCase() !== RECEIVER.toLowerCase()) throw new Error("wrong receiver");

    seen.add(payload.nonce);

    // Attempt on-chain settlement (non-blocking for demo mode)
    if (TREASURY) {
      settleOnChain(payload.payer as Address, payload.amount).catch(() => {});
    }

    return { payer: payload.payer as Address, amount: payload.amount };
  }

  function paymentRequired(res: express.Response, price: string, endpoint: string) {
    const nonce = ("0x" + randomUUID().replace(/-/g, "").padEnd(64, "0")) as `0x${string}`;
    return res.status(402).json({
      x402Version: 1,
      error: "Payment required",
      endpoint,
      chainId: CHAIN_ID,
      receiver: RECEIVER,
      token: TOKEN,
      amount: price,
      nonce,
      expiry: Math.floor(Date.now() / 1000) + 300,
      accepts: [{ scheme: "exact", network: `eip155:${CHAIN_ID}`, maxAmountRequired: price, asset: TOKEN, payTo: RECEIVER }],
    });
  }

  app.get("/premium-stats", async (req, res) => {
    try {
      const payment = await handlePayment(req);
      if (!payment) return paymentRequired(res, PRICE_STATS, "premium-stats");

      paymentLog.unshift({
        at: new Date().toISOString(),
        payer: payment.payer,
        amount: payment.amount,
        matchId: Number(req.query.matchId),
        endpoint: "premium-stats",
      });

      // On-chain settlement
      if (TREASURY) {
        const settled = await settleOnChain(payment.payer, payment.amount);
        if (!settled) return res.status(402).json({ error: "on-chain settlement failed" });
      }

      res.json(await premiumPayload(Number(req.query.matchId || 0), "x402-demo-eip712-v1"));
    } catch (e) {
      res.status(402).json({ error: "invalid payment", detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/historical-events", async (req, res) => {
    try {
      const payment = await handlePayment(req);
      if (!payment) return paymentRequired(res, PRICE_HISTORICAL, "historical-events");
      if (TREASURY) {
        const settled = await settleOnChain(payment.payer, payment.amount);
        if (!settled) return res.status(402).json({ error: "on-chain settlement failed" });
      }
      res.json({
        matchId: Number(req.query.matchId || 0),
        from: Number(req.query.from || 0),
        to: Number(req.query.to || 90),
        events: [],
        _paid: true,
      });
    } catch (e) {
      res.status(402).json({ error: "invalid payment", detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/webhooks/subscribe", async (req, res) => {
    try {
      const payment = await handlePayment(req);
      if (!payment) return paymentRequired(res, PRICE_WEBHOOK, "webhooks");
      if (TREASURY) {
        const settled = await settleOnChain(payment.payer, payment.amount);
        if (!settled) return res.status(402).json({ error: "on-chain settlement failed" });
      }
      const subscriptionId = `sub_${randomUUID().slice(0, 8)}`;
      res.json({
        subscriptionId,
        matchId: Number(req.query.matchId || 0),
        webhookUrl: String(req.query.url || ""),
        status: "active",
        _paid: true,
      });
    } catch (e) {
      res.status(402).json({ error: "invalid payment", detail: e instanceof Error ? e.message : String(e) });
    }
  });

  console.log(`[x402] DEMO mode · set X402_MODE=official for live @injectivelabs/x402`);
}

app.get("/payments", (_req, res) => {
  res.json({ payments: paymentLog.slice(0, 50), mode: MODE, revenueUsdc: totalRevenueUsdc });
});

const port = Number(process.env.X402_PORT || "4021");
app.listen(port, () => {
  console.log(`x402 endpoint on :${port} (mode=${MODE}, network=${NETWORK}, receiver ${RECEIVER})`);
});
