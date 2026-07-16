/**
 * x402 paywalled premium stats — Injective EVM.
 *
 * Official path (default when a facilitator key is set):
 *   @injectivelabs/x402 injectivePaymentMiddleware
 *   → HTTP 402 → EIP-3009 USDC auth → facilitator settles on Injective → data
 *
 * Demo path (X402_MODE=demo or no facilitator key):
 *   Vanilla EIP-712 signature only (no on-chain USDC transfer). Useful when
 *   the agent has no Circle USDC for EIP-3009 settle.
 *
 * Docs: https://docs.injective.network (x402 on Injective)
 * Package: @injectivelabs/x402
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
import type { Hex, Address } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const app = express();
app.use(cors());
// JSON body parser after x402 middleware would break some streams; health needs it.
// Official middleware does not require body parsing for GET.

const CHAIN_ID = Number(process.env.INJ_EVM_CHAIN_ID || "1439");
const NETWORK =
  CHAIN_ID === 1776 ? INJECTIVE_MAINNET_CAIP2 : INJECTIVE_TESTNET_CAIP2;

/** Circle native USDC (EIP-3009) — required for official x402. Not MockUSDC. */
const CIRCLE_USDC =
  (TOKENS[NETWORK]?.USDC?.address as Address | undefined) ||
  (CHAIN_ID === 1776
    ? ("0xa00C59fF5a080D2b954d0c75e46E22a0c371235a" as Address)
    : ("0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d" as Address));

const RECEIVER = (process.env.X402_RECEIVER_ADDRESS ||
  process.env.AGENT_ADDRESS ||
  "0x3Ff34877B1CB3eBf91Ff46C6EFbD11565D466004") as Address;

/** 0.01 USDC (6 decimals) — matches Injective docs demo ("1 cent") */
const AMOUNT = process.env.X402_AMOUNT || "10000";

const FACILITATOR_PK = (process.env.X402_FACILITATOR_PRIVATE_KEY ||
  process.env.AGENT_PRIVATE_KEY ||
  "") as Hex | "";

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "";

const modeEnv = (process.env.X402_MODE || "auto").toLowerCase();
const canOfficial = Boolean(FACILITATOR_PK || FACILITATOR_URL);
const MODE =
  modeEnv === "demo"
    ? "demo"
    : modeEnv === "official"
      ? "official"
      : canOfficial
        ? "official"
        : "demo";

const paymentLog: Array<Record<string, unknown>> = [];

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "x402-endpoint",
    mode: MODE,
    protocol: MODE === "official" ? "@injectivelabs/x402" : "demo-eip712",
    network: NETWORK,
    chainId: CHAIN_ID,
    asset: MODE === "official" ? CIRCLE_USDC : process.env.USDC_TESTNET_ADDRESS,
    amount: AMOUNT,
    amountLabel: `${Number(AMOUNT) / 1e6} USDC`,
    receiver: RECEIVER,
    facilitator: FACILITATOR_URL
      ? "remote"
      : FACILITATOR_PK
        ? "local"
        : "none",
    payments: paymentLog.length,
  });
});

function premiumPayload(matchId: number, protocol: string) {
  return {
    matchId,
    xg: { home: 1.34, away: 1.87 },
    possession: { home: 44, away: 56 },
    shots: { home: 9, away: 14 },
    keyPasses: { home: 6, away: 11 },
    narrative:
      "Away side leads in xG, possession, and shots — indicates stronger attacking performance.",
    _paid: true,
    _protocol: protocol,
    _network: NETWORK,
    _chainId: CHAIN_ID,
  };
}

// ---------------------------------------------------------------------------
// Official Injective x402 middleware (EIP-3009 USDC + facilitator)
// ---------------------------------------------------------------------------
if (MODE === "official") {
  const middlewareOpts: Parameters<typeof injectivePaymentMiddleware>[1] = {
    settlementPolicy: "after-success",
    baseUrl: process.env.X402_BASE_URL || `http://localhost:${process.env.X402_PORT || "4021"}`,
  };

  if (FACILITATOR_URL) {
    middlewareOpts.facilitatorUrl = FACILITATOR_URL;
  } else if (FACILITATOR_PK) {
    middlewareOpts.facilitator = {
      privateKey: FACILITATOR_PK.startsWith("0x")
        ? FACILITATOR_PK
        : (`0x${FACILITATOR_PK}` as Hex),
      rpcUrl:
        process.env.INJ_EVM_RPC ||
        "https://k8s.testnet.json-rpc.injective.network",
      allowedAssets: [CIRCLE_USDC.toLowerCase()],
      minPaymentPerAsset: { [CIRCLE_USDC.toLowerCase()]: "1000" },
    };
  }

  app.use(
    injectivePaymentMiddleware(
      {
        "GET /premium-stats": {
          description:
            "Premium World Cup match analytics (xG, possession, shots) — pay-per-request on Injective",
          mimeType: "application/json",
          accepts: [
            {
              network: NETWORK,
              asset: CIRCLE_USDC,
              amount: AMOUNT,
              payTo: RECEIVER,
              maxTimeoutSeconds: 120,
            },
          ],
        },
      },
      middlewareOpts
    )
  );

  app.get("/premium-stats", (req, res) => {
    const matchId = Number(req.query.matchId || 0);
    paymentLog.unshift({
      at: new Date().toISOString(),
      matchId,
      mode: "official",
      network: NETWORK,
      amount: AMOUNT,
      asset: CIRCLE_USDC,
    });
    res.json(
      premiumPayload(matchId, "@injectivelabs/x402-eip3009")
    );
  });

  console.log(
    `[x402] OFFICIAL mode · network=${NETWORK} · asset=${CIRCLE_USDC} · amount=${AMOUNT} (${Number(AMOUNT) / 1e6} USDC)`
  );
} else {
  // ---------------------------------------------------------------------------
  // Demo fallback — EIP-712 auth only (no facilitator / no USDC transfer)
  // ---------------------------------------------------------------------------
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

  app.get("/premium-stats", async (req, res) => {
    const header = req.header("X-PAYMENT") || req.header("PAYMENT-SIGNATURE");
    if (!header) {
      const nonce = ("0x" +
        randomUUID().replace(/-/g, "").padEnd(64, "0")) as `0x${string}`;
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
        _hint:
          "Demo mode (no facilitator). Set AGENT_PRIVATE_KEY + X402_MODE=official for live Injective USDC x402.",
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
      const matchId = Number(req.query.matchId || 0);
      paymentLog.unshift({
        at: new Date().toISOString(),
        payer: payload.payer,
        amount: payload.amount,
        nonce: payload.nonce,
        matchId,
        mode: "demo",
      });

      res.json(premiumPayload(matchId, "x402-demo-eip712-v1"));
    } catch (e) {
      res.status(402).json({
        error: "invalid payment header",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });

  console.log(
    `[x402] DEMO mode · set X402_MODE=official + AGENT_PRIVATE_KEY for @injectivelabs/x402`
  );
}

app.get("/payments", (_req, res) => {
  res.json({ payments: paymentLog.slice(0, 50), mode: MODE });
});

const port = Number(process.env.X402_PORT || "4021");
app.listen(port, () => {
  console.log(
    `x402 endpoint on :${port} (mode=${MODE}, network=${NETWORK}, receiver ${RECEIVER})`
  );
});
