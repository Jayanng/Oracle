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
    const e = await pub.readContract({
      address: oracleAddr(),
      abi: ORACLE_ABI,
      functionName: "getLatestEvent",
      args: [BigInt(matchId)],
    });
    return mapEvent(e);
  },

  async listEvents({ matchId }: { matchId: number }) {
    const pub = readClient();
    const arr = await pub.readContract({
      address: oracleAddr(),
      abi: ORACLE_ABI,
      functionName: "getEvents",
      args: [BigInt(matchId)],
    });
    return arr.map(mapEvent);
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
   * x402: fetch premium analytics from paywalled endpoint.
   * Server responds 402 with payment requirements; we sign EIP-712 & retry.
   */
  async getPremiumStats({ matchId }: { matchId: number }) {
    const url = `${process.env.X402_ENDPOINT_URL || "http://localhost:4021/premium-stats"}?matchId=${matchId}`;
    try {
      const r = await axios.get(url);
      return r.data;
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: Record<string, unknown> } };
      if (ax.response?.status !== 402) throw err;
      const req = ax.response.data!;
      const payment = await signX402Payment(req);
      const r = await axios.get(url, { headers: { "X-PAYMENT": payment } });
      return {
        ...r.data,
        _x402: {
          paid: true,
          amount: req.amount,
          receiver: req.receiver,
          chainId: req.chainId,
        },
      };
    }
  },
};

async function signX402Payment(req: Record<string, unknown>): Promise<string> {
  const { wallet, account } = clients();
  const domain = {
    name: "x402",
    version: "1",
    chainId: Number(req.chainId),
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
    receiver: req.receiver as `0x${string}`,
    token: req.token as `0x${string}`,
    amount: BigInt(String(req.amount)),
    nonce: req.nonce as `0x${string}`,
    expiry: BigInt(String(req.expiry)),
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

export type ToolName =
  | "getLatestEvent"
  | "listEvents"
  | "settleMatch"
  | "getPremiumStats";
