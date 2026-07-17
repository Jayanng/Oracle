import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const ORACLE_ABI = parseAbi([
  "function addEvent(uint256 matchId, uint32 minute, string category, string eventType, string details) returns (uint256)",
  "function eventCount(uint256 matchId) view returns (uint256)",
  "function grantRole(bytes32 role, address account)",
  "function FEEDER_ROLE() view returns (bytes32)",
  "event EventAdded(uint256 indexed matchId, uint256 indexed index, string category, string eventType, uint64 timestamp)",
]);

export const REWARDS_ABI = parseAbi([
  "function openMarket(uint256 matchId, uint64 closesAt)",
  "function markets(uint256 matchId) view returns (uint256 matchId_, uint64 closesAt, uint8 resolved, uint256 totalHome, uint256 totalDraw, uint256 totalAway, bool settled)",
  "function SETTLER_ROLE() view returns (bytes32)",
  "function grantRole(bytes32 role, address account)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "event MarketOpened(uint256 indexed matchId, uint64 closesAt)",
]);

export function getChain(): Chain {
  const id = Number(process.env.INJ_EVM_CHAIN_ID || "1439");
  const rpc = process.env.INJ_EVM_RPC || "https://k8s.testnet.json-rpc.injective.network";
  return {
    id,
    name: "Injective EVM Testnet",
    nativeCurrency: { name: "INJ", symbol: "INJ", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  } as const;
}

export function getClients() {
  const pk = process.env.FEEDER_PRIVATE_KEY;
  if (!pk) throw new Error("FEEDER_PRIVATE_KEY required");
  const account = privateKeyToAccount(pk as `0x${string}`);
  const chain = getChain();
  const transport = http();
  return {
    account,
    wallet: createWalletClient({ account, chain, transport }),
    pub: createPublicClient({ chain, transport }),
    oracle: process.env.ORACLE_ADDRESS as `0x${string}` | undefined,
    rewards: process.env.REWARDS_ADDRESS as `0x${string}` | undefined,
  };
}
