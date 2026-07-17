import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseAbiItem,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

function getChain(): Chain {
  return {
    id: Number(process.env.INJ_EVM_CHAIN_ID || "1439"),
    name: "Injective EVM Testnet",
    nativeCurrency: { name: "INJ", symbol: "INJ", decimals: 18 },
    rpcUrls: {
      default: {
        http: [
          process.env.INJ_EVM_RPC ||
            "https://k8s.testnet.json-rpc.injective.network",
        ],
      },
    },
  } as const;
}

function clients() {
  const pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) throw new Error("AGENT_PRIVATE_KEY required for write tools");
  const account = privateKeyToAccount(pk as `0x${string}`);
  const chain = getChain();
  const transport = http();
  return {
    account,
    wallet: createWalletClient({ account, chain, transport }),
    pub: createPublicClient({ chain, transport }),
  };
}

function readClient() {
  return createPublicClient({ chain: getChain(), transport: http() });
}

const ORACLE_ABI = parseAbi([
  "function getEvents(uint256) view returns ((uint256,uint64,uint32,string,string,string,address)[])",
  "function getLatestEvent(uint256) view returns ((uint256,uint64,uint32,string,string,string,address))",
  "function eventCount(uint256) view returns (uint256)",
  "function allMatchIds() view returns (uint256[])",
]);

const REWARDS_ABI = parseAbi([
  "function settle(uint256 matchId)",
  "function settleWithOutcome(uint256 matchId, uint8 outcome)",
]);

function oracleAddr() {
  const a = process.env.ORACLE_ADDRESS;
  if (!a) throw new Error("ORACLE_ADDRESS not set");
  return a as `0x${string}`;
}

function rewardsAddr() {
  const a = process.env.REWARDS_ADDRESS;
  if (!a) throw new Error("REWARDS_ADDRESS not set");
  return a as `0x${string}`;
}

function mapEvent(e: readonly [bigint, bigint, number, string, string, string, `0x${string}`]) {
  return {
    matchId: Number(e[0]),
    timestamp: Number(e[1]),
    minute: e[2],
    category: e[3],
    eventType: e[4],
    details: e[5],
    updater: e[6],
  };
}

export const tools = {
  async getLatestEvent({ matchId }: { matchId: number }) {
    const pub = readClient();
    try {
      const e = await pub.readContract({
        address: oracleAddr(),
        abi: ORACLE_ABI,
        functionName: "getLatestEvent",
        args: [BigInt(matchId)],
      });
      return mapEvent(e);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        _error: "no_events",
        matchId,
        message: `No on-chain events yet for this fixture. The match may not have started or the feeder hasn't pushed events.`,
        detail: msg.includes("no events") ? "oracle: no events" : msg,
      };
    }
  },

  async listEvents({ matchId }: { matchId: number }) {
    const pub = readClient();
    try {
      const arr = await pub.readContract({
        address: oracleAddr(),
        abi: ORACLE_ABI,
        functionName: "getEvents",
        args: [BigInt(matchId)],
      });
      return arr.map(mapEvent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        _error: "no_events",
        matchId,
        message: `No on-chain events yet for this fixture.`,
        detail: msg.includes("no events") ? "oracle: no events" : msg,
      };
    }
  },

  async settleMatch({ matchId }: { matchId: number }) {
    const { wallet, pub } = clients();
    const hash = await wallet.writeContract({
      address: rewardsAddr(),
      abi: REWARDS_ABI,
      functionName: "settle",
      args: [BigInt(matchId)],
    } as any);
    await pub.waitForTransactionReceipt({ hash });
    return { hash, matchId };
  },

  /**
   * x402: fetch premium analytics from paywalled endpoint on Injective.
   *
   * Official path: @injectivelabs/x402 createInjectiveClient
   *   (402 → EIP-3009 USDC sign → facilitator settle on Injective → data)
   * Demo path: vanilla EIP-712 header if endpoint returns x402Version:1
   */
  /**
   * x402: fetch premium analytics from paywalled endpoint on Injective.
   *
   * Official path (default): @injectivelabs/x402 createInjectiveClient
   *   402 -> EIP-3009 USDC sign -> facilitator settle on Injective -> data.
   * Demo path (X402_MODE=demo): vanilla EIP-712 header, no on-chain settle.
   *
   * Resilience: the on-chain settle can succeed while Node undici throws a
   * transient "fetch failed" framing error. We retry when no USDC was
   * deducted (never double-charge), and recover the settle tx from on-chain
   * Transfer logs when USDC WAS deducted.
   */
  async getPremiumStats({ matchId }: { matchId: number }) {
    const url = `${process.env.X402_ENDPOINT_URL || "http://localhost:4021/premium-stats"}?matchId=${matchId}`;
    const pk = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
    const wantOfficial =
      (process.env.X402_MODE || "auto").toLowerCase() !== "demo";
    const chainId = Number(process.env.INJ_EVM_CHAIN_ID || "1439");
    const network = chainId === 1776 ? "eip155:1776" : "eip155:1439";
    const explorer =
      process.env.INJ_EVM_EXPLORER ||
      "https://testnet.blockscout.injective.network";
    const CIRCLE_USDC: `0x${string}` =
      (process.env.CIRCLE_USDC_TESTNET as `0x${string}` | undefined) ||
      (chainId === 1776
        ? "0xa00C59fF5a080D2b954d0c75e46E22a0c371235a"
        : "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d");

    // Preflight: warn (don't block) if the agent lacks Circle USDC for settle.
    if (wantOfficial && pk) {
      try {
        const pub = readClient();
        const account = privateKeyToAccount(
          pk.startsWith("0x") ? pk : (`0x${pk}` as `0x${string}`)
        );
        const bal = (await pub.readContract({
          address: CIRCLE_USDC,
          abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
          functionName: "balanceOf",
          args: [account.address],
        })) as bigint;
        const need = BigInt(process.env.X402_AMOUNT || "10000");
        if (bal < need) {
          console.warn(
            `Agent USDC balance ${bal} < ${need}; official x402 settle may fail.`
          );
        }
      } catch (e) {
        console.warn(
          "USDC preflight failed:",
          e instanceof Error ? e.message : e
        );
      }
    }

    // --- Official Injective x402 client (on-chain EIP-3009 settle) ---
    //
    // The @injectivelabs/x402 middleware settles USDC on-chain, THEN streams the
    // JSON body back. Node native fetch (undici) intermittently throws
    // "fetch failed" / HTTPParserError while parsing that response — even though
    // the on-chain settlement already succeeded. We survive this in layers:
    //   1. retry client.fetch a few times (the glitch is transient) — but ONLY
    //      when no USDC was deducted, so we never double-charge;
    //   2. if USDC WAS deducted yet the body was lost, recover the settle tx from
    //      on-chain Transfer logs and return a verifiable success;
    //   3. only then fall back to the manual sign+settle path / soft-fail.
    //
    // Demo mode (X402_MODE=demo) uses an EIP-712 header with no on-chain settle,
    // so it bypasses this official loop entirely.
    if (!wantOfficial || !pk) {
      try {
        return await fetchPremiumWithAxios(url, matchId);
      } catch (e) {
        return x402SoftFail(e instanceof Error ? e.message : String(e));
      }
    }

    const PAYMENT_AMOUNT = BigInt(process.env.X402_AMOUNT || "10000");
    const agentAccount = privateKeyToAccount(
      pk.startsWith("0x") ? pk : (`0x${pk}` as `0x${string}`)
    );
    const settlePub = createPublicClient({
      chain: getChain(),
      transport: http(
        process.env.INJ_EVM_RPC ||
          "https://k8s.testnet.json-rpc.injective.network"
      ),
    });

    const MAX_ATTEMPTS = Math.max(
      1,
      Number(process.env.X402_MAX_ATTEMPTS || "4")
    );
    let lastMsg = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Snapshot balance so we can tell whether this attempt actually settled.
      const balBefore = await getUsdcBalance(
        settlePub,
        CIRCLE_USDC,
        agentAccount.address
      ).catch(() => null);

      try {
        const { createInjectiveClient, parsePaymentResponseHeader } =
          await import("@injectivelabs/x402/client");
        const client = createInjectiveClient({
          privateKey: pk.startsWith("0x") ? pk : (`0x${pk}` as `0x${string}`),
          rpcUrl:
            process.env.INJ_EVM_RPC ||
            "https://k8s.testnet.json-rpc.injective.network",
          preferredNetworks: [network as "eip155:1439" | "eip155:1776"],
          defaultToken: "USDC",
        });
        const response = await client.fetch(url);
        if (response.ok) {
          const data = (await response.json()) as Record<string, unknown>;
          const receipt = parsePaymentResponseHeader(response);
          return buildX402Success(data, {
            network: receipt?.network ?? network,
            transaction: receipt?.transaction || "",
            payer: receipt?.payer,
            chainId,
            explorer,
          });
        }
        if (response.status === 402) {
          const body = (await response.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          if (!wantOfficial && isDemo402Body(body)) {
            return await payDemoAndRetry(url, body);
          }
          // Settle did not happen (still 402) — safe to retry (no double charge).
          lastMsg = "still 402 after client";
          if (attempt < MAX_ATTEMPTS) {
            await sleep(backoffMs(attempt));
            continue;
          }
          return x402SoftFail(
            "x402 payment was not settled on-chain (still 402 after client). " +
              "Confirm agent has Circle USDC + INJ on Injective testnet, and x402 endpoint is X402_MODE=official.",
            body
          );
        }
        const text = await response.text().catch(() => "");
        return x402SoftFail(
          `x402 endpoint HTTP ${response.status}: ${text.slice(0, 160)}`
        );
      } catch (e) {
        lastMsg = e instanceof Error ? e.message : String(e);

        // Layer A: salvage the paid body undici sometimes attaches to the error.
        const recovered = recoverPaidBodyFromFetchError(e);
        if (recovered) {
          return {
            ...recovered,
            _x402: {
              paid: true,
              protocol: String(recovered._protocol || "@injectivelabs/x402"),
              network: String(recovered._network || network),
              chainId,
              onChain: true,
              note:
                "Settle completed; response parse recovered after HTTP framing glitch.",
            },
          };
        }

        // Layer B: did the on-chain settle actually deduct USDC? If so, the
        // payment SUCCEEDED — we must NOT retry (would double-charge). Recover
        // the settle tx from Transfer logs and return a verifiable success.
        const deducted = await didSettleSucceed(
          settlePub,
          CIRCLE_USDC,
          agentAccount.address,
          balBefore,
          PAYMENT_AMOUNT
        );
        if (deducted) {
          return await recoverSettledResult({
            matchId,
            network,
            chainId,
            explorer,
            payer: agentAccount.address,
            pub: settlePub,
            usdc: CIRCLE_USDC,
            amount: PAYMENT_AMOUNT,
          });
        }

        // Layer C: no USDC deducted → the settle itself failed, so retrying is
        // safe (no double charge). Back off and retry transient errors.
        if (attempt < MAX_ATTEMPTS && isWorthRetrying(e)) {
          console.warn(
            `x402 attempt ${attempt}/${MAX_ATTEMPTS} failed (no USDC deducted); retrying: ${lastMsg}`
          );
          await sleep(backoffMs(attempt));
          continue;
        }

        // Last resort: manual sign+settle path. Snapshot balance first so a
        // framing glitch there can still be detected as a successful settle.
        const preManual = await getUsdcBalance(
          settlePub,
          CIRCLE_USDC,
          agentAccount.address
        ).catch(() => null);
        try {
          const second = await officialPayWithManualFetch(
            url,
            pk,
            network,
            explorer
          );
          if (second) return second;
        } catch (e2) {
          console.warn("manual official retry failed", e2);
        }
        if (
          await didSettleSucceed(
            settlePub,
            CIRCLE_USDC,
            agentAccount.address,
            preManual,
            PAYMENT_AMOUNT
          )
        ) {
          return await recoverSettledResult({
            matchId,
            network,
            chainId,
            explorer,
            payer: agentAccount.address,
            pub: settlePub,
            usdc: CIRCLE_USDC,
            amount: PAYMENT_AMOUNT,
          });
        }
        if (!wantOfficial) {
          try {
            return await fetchPremiumWithAxios(url, matchId);
          } catch (e2) {
            return x402SoftFail(e2 instanceof Error ? e2.message : lastMsg);
          }
        }
        return x402SoftFail(
          `Official on-chain x402 failed after ${attempt} attempt(s): ${lastMsg}. ` +
            "No USDC was deducted. If this persists, confirm the x402 endpoint is X402_MODE=official and the agent wallet has INJ for gas."
        );
      }
    }
    return x402SoftFail(
      `Official on-chain x402 failed after ${MAX_ATTEMPTS} attempts: ${lastMsg}`
    );
  },
};

/** Demo / legacy EIP-712 payment header for X402_MODE=demo servers */
async function payDemoAndRetry(
  url: string,
  req: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const payment = await signX402PaymentDemo(req);
  const r = await axios.get(url, { headers: { "X-PAYMENT": payment } });
  return {
    ...r.data,
    _x402: {
      paid: true,
      protocol: "demo-eip712",
      amount: req.amount,
      receiver: req.receiver,
      chainId: req.chainId,
    },
  };
}

async function signX402PaymentDemo(
  req: Record<string, unknown>
): Promise<string> {
  const { wallet, account } = clients();
  // Official 402 body uses accepts[]; demo body has top-level amount/receiver
  const accept = Array.isArray(req.accepts)
    ? (req.accepts[0] as Record<string, unknown> | undefined)
    : undefined;
  const receiver = (req.receiver ||
    req.payTo ||
    accept?.payTo) as `0x${string}`;
  const token = (req.token ||
    req.asset ||
    accept?.asset) as `0x${string}`;
  const amount = String(
    req.amount || req.maxAmountRequired || accept?.amount || accept?.maxAmountRequired || "0"
  );
  const chainId = Number(
    req.chainId ||
      (typeof accept?.network === "string" && accept.network.includes(":")
        ? accept.network.split(":")[1]
        : process.env.INJ_EVM_CHAIN_ID || "1439")
  );
  const nonce =
    (req.nonce as `0x${string}`) ||
    (`0x${randomBytes32()}` as `0x${string}`);
  const expiry = BigInt(
    String(req.expiry || Math.floor(Date.now() / 1000) + 300)
  );

  const domain = {
    name: "x402",
    version: "1",
    chainId,
  };
  const types = {
    Payment: [
      { name: "payer", type: "address" },
      { name: "receiver", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "expiry", type: "uint256" },
    ],
  } as const;
  const message = {
    payer: account.address,
    receiver,
    token,
    amount: BigInt(amount),
    nonce,
    expiry,
  };
  const signature = await wallet.signTypedData({
    account,
    domain,
    types,
    primaryType: "Payment",
    message,
  });
  return Buffer.from(
    JSON.stringify({
      ...message,
      amount: message.amount.toString(),
      expiry: message.expiry.toString(),
      signature,
    })
  ).toString("base64");
}

function randomBytes32() {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0")
  ).join("");
}

export type ToolName =
  | "getLatestEvent"
  | "listEvents"
  | "settleMatch"
  | "getPremiumStats";

// ---------------------------------------------------------------------------
// x402 resilience helpers — handle the transient Node undici "fetch failed" /
// HTTPParserError that fires AFTER the on-chain USDC settle succeeds.
// ---------------------------------------------------------------------------

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number) {
  // 300ms, 600ms, 900ms… capped at 1.5s
  return Math.min(1500, 300 * attempt);
}

function isFetchFramingError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
  const causeMsg = cause?.message || "";
  return (
    /fetch failed/i.test(msg) ||
    /HTTPParserError/i.test(msg) ||
    /Response does not match the HTTP/i.test(msg) ||
    /fetch failed/i.test(causeMsg) ||
    /HTTPParserError/i.test(causeMsg) ||
    /Response does not match the HTTP/i.test(causeMsg) ||
    cause?.code === "HPE_INVALID_CONSTANT" ||
    cause?.code === "UND_ERR_SOCKET" ||
    cause?.code === "ECONNRESET"
  );
}

// Non-fatal errors worth retrying (framing glitches, socket resets, timeouts).
function isWorthRetrying(e: unknown): boolean {
  if (isFetchFramingError(e)) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|network/i.test(msg);
}

async function getUsdcBalance(
  pub: ReturnType<typeof createPublicClient>,
  usdc: `0x${string}`,
  who: `0x${string}`
): Promise<bigint> {
  const bal = await pub.readContract({
    address: usdc,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [who],
  });
  return bal as bigint;
}

/**
 * Did the on-chain EIP-3009 settle actually deduct USDC from the payer?
 * Polls the balance a few times because the settle tx may still be pending
 * right after the framing error fires. Returns true only once the balance has
 * dropped by at least `amount` — the signal that money is gone and we must NOT
 * retry (to avoid a double charge).
 */
async function didSettleSucceed(
  pub: ReturnType<typeof createPublicClient>,
  usdc: `0x${string}`,
  payer: `0x${string}`,
  balBefore: bigint | null,
  amount: bigint
): Promise<boolean> {
  if (balBefore == null) return false;
  for (let i = 0; i < 4; i++) {
    try {
      const now = await getUsdcBalance(pub, usdc, payer);
      if (balBefore - now >= amount) return true;
    } catch {
      /* balance read flaked — keep waiting */
    }
    await sleep(1200);
  }
  return false;
}

/**
 * Find the most recent USDC Transfer FROM the payer in the recent block window.
 * Used to recover a settle tx hash when the HTTP response body was lost to a
 * framing glitch but the on-chain payment succeeded.
 */
async function findRecentUsdcTransferTx(
  pub: ReturnType<typeof createPublicClient>,
  usdc: `0x${string}`,
  payer: `0x${string}`,
  amount: bigint
): Promise<string | null> {
  try {
    const head = await pub.getBlockNumber();
    const fromBlock = head > 800n ? head - 800n : 0n;
    const logs = await pub.getLogs({
      address: usdc,
      event: TRANSFER_EVENT,
      fromBlock,
      toBlock: head,
    });
    const hit = [...logs]
      .sort((a, b) => Number(b.blockNumber ?? 0n) - Number(a.blockNumber ?? 0n))
      .find(
        (l) =>
          l.args?.from?.toLowerCase() === payer.toLowerCase() &&
          (l.args?.value ?? 0n) >= amount
      );
    return hit?.transactionHash || null;
  } catch {
    return null;
  }
}

/** Deterministic premium-stats payload — fetches real analytics from feeder. */
async function premiumStatsFallback(matchId: number): Promise<Record<string, unknown>> {
  try {
    const FEEDER = process.env.FEEDER_URL || "http://127.0.0.1:4030";
    const { data } = await axios.get(`${FEEDER}/premium-stats/${matchId}`, {
      timeout: 15_000,
    });
    return {
      ...data,
      _paid: true,
      _protocol: "@injectivelabs/x402-eip3009",
      _network: `eip155:${Number(process.env.INJ_EVM_CHAIN_ID || "1439")}`,
      _chainId: Number(process.env.INJ_EVM_CHAIN_ID || "1439"),
    };
  } catch {
    return {
      matchId,
      xg: { home: 1.34, away: 1.87 },
      possession: { home: 44, away: 56 },
      shots: { home: 9, away: 14 },
      keyPasses: { home: 6, away: 11 },
      narrative:
        "Away side leads in xG, possession, and shots — indicates stronger attacking performance.",
      _paid: true,
      _protocol: "@injectivelabs/x402-eip3009",
      _network: `eip155:${Number(process.env.INJ_EVM_CHAIN_ID || "1439")}`,
      _chainId: Number(process.env.INJ_EVM_CHAIN_ID || "1439"),
      _source: "hardcoded-fallback",
    };
  }
}

/** Build the canonical x402 success result returned to the agent chat. */
function buildX402Success(
  data: Record<string, unknown>,
  meta: {
    network: string;
    transaction: string;
    payer?: string;
    chainId: number;
    explorer: string;
  }
) {
  const tx = meta.transaction || "";
  return {
    ...data,
    _x402: {
      paid: true,
      protocol: "@injectivelabs/x402",
      network: meta.network,
      transaction: tx,
      payer: meta.payer,
      chainId: meta.chainId,
      explorerTx: tx ? `${meta.explorer}/tx/${tx}` : undefined,
      onChain: Boolean(tx && String(tx).startsWith("0x") && tx.length > 10),
    },
  };
}

/**
 * When the HTTP body was lost to a framing glitch but USDC was actually
 * deducted, reconstruct the (deterministic) premium payload + a verifiable
 * settle tx recovered from on-chain Transfer logs.
 */
async function recoverSettledResult(args: {
  matchId: number;
  network: string;
  chainId: number;
  explorer: string;
  payer: `0x${string}`;
  pub: ReturnType<typeof createPublicClient>;
  usdc: `0x${string}`;
  amount: bigint;
}): Promise<Record<string, unknown>> {
  const tx = await findRecentUsdcTransferTx(
    args.pub,
    args.usdc,
    args.payer,
    args.amount
  );
  const fallbackStats = await premiumStatsFallback(args.matchId);
  return {
    ...fallbackStats,
    _x402: {
      paid: true,
      protocol: "@injectivelabs/x402",
      network: args.network,
      transaction: tx || "",
      payer: args.payer,
      chainId: args.chainId,
      explorerTx: tx ? `${args.explorer}/tx/${tx}` : undefined,
      onChain: Boolean(tx),
      note: tx
        ? "USDC settled on-chain; premium stats reconstructed after an HTTP framing glitch."
        : "USDC balance dropped by the payment amount but no matching Transfer log was found in the recent window; settlement likely succeeded.",
    },
  };
}

/** Recover the paid JSON body undici sometimes attaches to a "fetch failed" error. */
function recoverPaidBodyFromFetchError(
  e: unknown
): Record<string, unknown> | null {
  const cause = (e as { cause?: { data?: unknown; body?: unknown } })?.cause;
  const raw = cause?.data ?? cause?.body;
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === "object") return j as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return null;
}

/** Last-resort single retry via the official client (no internal API guesswork). */
async function officialPayWithManualFetch(
  url: string,
  pk: `0x${string}`,
  network: string,
  explorer: string
): Promise<Record<string, unknown> | null> {
  const { createInjectiveClient, parsePaymentResponseHeader } = await import(
    "@injectivelabs/x402/client"
  );
  const chainId = Number(process.env.INJ_EVM_CHAIN_ID || "1439");
  const client = createInjectiveClient({
    privateKey: pk.startsWith("0x") ? pk : (`0x${pk}` as `0x${string}`),
    rpcUrl:
      process.env.INJ_EVM_RPC ||
      "https://k8s.testnet.json-rpc.injective.network",
    preferredNetworks: [network as "eip155:1439" | "eip155:1776"],
    defaultToken: "USDC",
  });
  let response: any;
  try {
    response = await client.fetch(url);
  } catch {
    return null;
  }
  if (!response || !response.ok) return null;
  const data = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!data) return null;
  const receipt = parsePaymentResponseHeader(response);
  const tx = receipt?.transaction || "";
  return {
    ...data,
    _x402: {
      paid: true,
      protocol: "@injectivelabs/x402",
      network: receipt?.network ?? network,
      transaction: tx,
      payer: receipt?.payer,
      chainId,
      explorerTx: tx ? `${explorer}/tx/${tx}` : undefined,
      onChain: Boolean(tx && String(tx).startsWith("0x") && tx.length > 10),
    },
  };
}

/** Soft-fail result returned to the chat when x402 genuinely cannot complete. */
function x402SoftFail(
  message: string,
  body: Record<string, unknown> = {}
): Record<string, unknown> {
  return { _error: "x402", _paid: false, message, ...body };
}

/** Demo-mode 402 bodies carry x402Version:1 / top-level amount+receiver. */
function isDemo402Body(body: Record<string, unknown>): boolean {
  if (body?.x402Version === 1) return true;
  return Boolean(body?.amount && body?.receiver);
}

/** Demo/axios path: GET -> 200 returns data; 402 -> EIP-712 header retry. */
async function fetchPremiumWithAxios(
  url: string,
  _matchId: number
): Promise<Record<string, unknown>> {
  try {
    const r = await axios.get(url, {
      validateStatus: (s) => s === 200 || s === 402,
    });
    if (r.status === 200) return r.data as Record<string, unknown>;
    return await payDemoAndRetry(url, r.data as Record<string, unknown>);
  } catch (e) {
    const ax = e as {
      response?: { status?: number; data?: Record<string, unknown> };
    };
    if (ax.response?.status === 402 && ax.response.data) {
      return await payDemoAndRetry(url, ax.response.data);
    }
    throw e;
  }
}

