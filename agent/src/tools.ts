import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
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
  async getPremiumStats({ matchId }: { matchId: number }) {
    const url = `${process.env.X402_ENDPOINT_URL || "http://localhost:4021/premium-stats"}?matchId=${matchId}`;

    // Prefer official Injective x402 client (handles 402 dance end-to-end)
    const pk = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
    if (pk) {
      try {
        const { createInjectiveClient, parsePaymentResponseHeader } =
          await import("@injectivelabs/x402/client");
        const chainId = Number(process.env.INJ_EVM_CHAIN_ID || "1439");
        const client = createInjectiveClient({
          privateKey: pk.startsWith("0x") ? pk : (`0x${pk}` as `0x${string}`),
          rpcUrl:
            process.env.INJ_EVM_RPC ||
            "https://k8s.testnet.json-rpc.injective.network",
          preferredNetworks: [
            chainId === 1776 ? "eip155:1776" : "eip155:1439",
          ],
          defaultToken: "USDC",
        });
        // Official client handles: GET → 402 → sign EIP-3009 → settle → retry
        const response = await client.fetch(url);
        if (response.status === 402) {
          // Server may be in demo mode with a different 402 shape
          const body = (await response.json()) as Record<string, unknown>;
          return await payDemoAndRetry(url, body);
        }
        if (!response.ok) {
          const text = await response.text();
          throw new Error(
            `x402 fetch failed ${response.status}: ${text.slice(0, 200)}`
          );
        }
        const data = await response.json();
        const receipt = parsePaymentResponseHeader(response);
        return {
          ...data,
          _x402: {
            paid: true,
            protocol: "@injectivelabs/x402",
            network: receipt?.network ?? (chainId === 1776 ? "eip155:1776" : "eip155:1439"),
            transaction: receipt?.transaction,
            payer: receipt?.payer,
            chainId,
          },
        };
      } catch (e) {
        // If official path fails (e.g. no USDC for EIP-3009), try demo header path
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("402") && !msg.toLowerCase().includes("payment")) {
          // still try demo path for mixed servers
        }
        try {
          const r = await axios.get(url);
          return r.data;
        } catch (err: unknown) {
          const ax = err as {
            response?: { status?: number; data?: Record<string, unknown> };
          };
          if (ax.response?.status === 402 && ax.response.data) {
            return await payDemoAndRetry(url, ax.response.data);
          }
          throw new Error(
            `x402 premium stats failed: ${msg}. ` +
              `Need AGENT_PRIVATE_KEY + Circle USDC on Injective for official settle, ` +
              `or X402_MODE=demo on the endpoint.`
          );
        }
      }
    }

    // No agent key — try plain GET (will 402)
    try {
      const r = await axios.get(url);
      return r.data;
    } catch (err: unknown) {
      const ax = err as {
        response?: { status?: number; data?: Record<string, unknown> };
      };
      if (ax.response?.status !== 402 || !ax.response.data) throw err;
      return await payDemoAndRetry(url, ax.response.data);
    }
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
