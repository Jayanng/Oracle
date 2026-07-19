/**
 * Browser-side x402 payer.
 *
 * The connected user's wallet pays the paywall directly by signing an
 * EIP-3009 `TransferWithAuthorization` for USDC. The x402 endpoint's
 * facilitator submits it on-chain (facilitator pays gas, USER pays USDC),
 * then returns the premium data plus a settlement receipt.
 *
 * Protocol (x402 v2, @injectivelabs/x402 middleware):
 *   1. GET endpoint -> 402 with `PAYMENT-REQUIRED` header (base64 PaymentRequired)
 *   2. Sign EIP-3009 auth for accepts[0]
 *   3. Retry with `PAYMENT-SIGNATURE` header (base64 PaymentPayload)
 *   4. 200 + `PAYMENT-RESPONSE` header (base64 SettleResponse)
 */
import type { WalletClient, Address, Hex } from "viem";
import { INJECTIVE_EVM_CHAIN_ID } from "./wagmi";

/**
 * The browser pays the x402 paywall through the Next.js server proxy
 * (`/api/x402-proxy`) instead of calling :4021 directly, so that `localhost`
 * resolves on the server that actually runs the x402-endpoint — otherwise a
 * teammate opening the UI from another machine would have their browser hit
 * their own machine (which isn't running the endpoint) and fail with
 * "failed to fetch". The proxy is always same-origin, so no env override.
 */
const X402_URL = "/api/x402-proxy";

type PaymentRequirements = {
  scheme: "exact";
  network: string;
  amount: string;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};

type PaymentRequired = {
  x402Version: 2;
  error?: string;
  resource?: { url: string; description?: string; mimeType?: string };
  accepts: PaymentRequirements[];
};

export type X402Receipt = {
  success: boolean;
  transaction: string;
  network: string;
  payer: string;
};

export type X402PayResult = {
  data: Record<string, unknown>;
  receipt?: X402Receipt;
};

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as Hex;
}

function b64encode(obj: unknown): string {
  const json = JSON.stringify(obj);
  if (typeof window !== "undefined" && window.btoa) {
    return window.btoa(unescape(encodeURIComponent(json)));
  }
  return Buffer.from(json, "utf8").toString("base64");
}

function b64decode<T>(s: string): T {
  const json =
    typeof window !== "undefined" && window.atob
      ? decodeURIComponent(escape(window.atob(s)))
      : Buffer.from(s, "base64").toString("utf8");
  return JSON.parse(json) as T;
}

/**
 * Pay the x402 premium-stats endpoint for `matchId` using the connected wallet.
 * Returns the premium data and the on-chain settlement receipt.
 */
export type X402Stage = "challenge" | "sign" | "settle" | "done";

export async function payPremiumStats(
  walletClient: WalletClient,
  account: Address,
  matchId: number,
  usdcAddress: Address,
  usdcName = "USDC",
  usdcVersion = "2",
  onStage?: (stage: X402Stage) => void
): Promise<X402PayResult> {
  const url = `${X402_URL}?matchId=${matchId}`;

  // Step 1: hit the endpoint, expect 402
  onStage?.("challenge");
  const challenge = await fetch(url, { method: "GET" });
  if (challenge.ok) {
    // Endpoint not paywalled (demo/open) — just return the data
    return { data: (await challenge.json()) as Record<string, unknown> };
  }
  if (challenge.status !== 402) {
    throw new Error(`x402 endpoint returned HTTP ${challenge.status}`);
  }

  const requiredHeader = challenge.headers.get("PAYMENT-REQUIRED");
  const required: PaymentRequired = requiredHeader
    ? b64decode<PaymentRequired>(requiredHeader)
    : ((await challenge.json()) as PaymentRequired);

  const accepted = required.accepts?.[0];
  if (!accepted) throw new Error("x402: no payment options offered");

  // Step 2: build + sign the EIP-3009 authorization with the USER's wallet
  const now = Math.floor(Date.now() / 1000);
  const validAfter = BigInt(now - 10);
  const validBefore = BigInt(now + (accepted.maxTimeoutSeconds || 300));
  const nonce = randomNonce();
  const value = BigInt(accepted.amount);

  // The facilitator verifies against the token registry name/version ("USDC"/"2"
  // for Circle FiatTokenV2_2). Prefer the server-declared extra values, which
  // mirror the registry, and fall back to the safe defaults.
  const extra = accepted.extra as { name?: string; version?: string } | undefined;
  const domainName = typeof extra?.name === "string" ? extra.name : usdcName;
  const domainVersion =
    typeof extra?.version === "string" ? extra.version : usdcVersion;

  onStage?.("sign");
  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: domainName,
      version: domainVersion,
      chainId: INJECTIVE_EVM_CHAIN_ID,
      verifyingContract: usdcAddress,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: account,
      to: accepted.payTo,
      value,
      validAfter,
      validBefore,
      nonce,
    },
  });

  // Step 3: assemble the x402 v2 PaymentPayload (matches @injectivelabs/x402
  // createPayment output exactly) and retry. `accepted` MUST be the full
  // requirements object echoed back so the facilitator's extra-field check passes.
  const paymentPayload = {
    x402Version: 2 as const,
    accepted: { ...accepted, extra: accepted.extra ?? {} },
    payload: {
      signature,
      authorization: {
        from: account,
        to: accepted.payTo,
        value: value.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };

  const header = b64encode(paymentPayload);
  onStage?.("settle");
  const paid = await fetch(url, {
    method: "GET",
    headers: { "PAYMENT-SIGNATURE": header, "X-PAYMENT": header },
  });

  if (!paid.ok) {
    let detail = `HTTP ${paid.status}`;
    try {
      const body = await paid.json();
      detail = body.detail || body.error || detail;
    } catch { /* ignore */ }
    throw new Error(`x402 payment rejected: ${detail}`);
  }

  const data = (await paid.json()) as Record<string, unknown>;
  const respHeader =
    paid.headers.get("PAYMENT-RESPONSE") ||
    paid.headers.get("X-PAYMENT-RESPONSE");
  const receipt = respHeader
    ? b64decode<X402Receipt>(respHeader)
    : undefined;

  onStage?.("done");
  return { data, receipt };
}
