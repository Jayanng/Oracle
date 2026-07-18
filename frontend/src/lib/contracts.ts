import type { Address } from "viem";

function addr(env: string | undefined, fallback = ""): Address {
  const v = (env || fallback).trim();
  if (v && v.startsWith("0x") && v.length === 42) return v as Address;
  return "" as Address;
}

export const ORACLE_ADDRESS = addr(
  process.env.NEXT_PUBLIC_ORACLE_ADDRESS,
  ""
);
export const DROPS_ADDRESS = addr(
  process.env.NEXT_PUBLIC_DROPS_ADDRESS,
  ""
);
export const TREASURY_ADDRESS = addr(
  process.env.NEXT_PUBLIC_TREASURY_ADDRESS,
  ""
);
export const USDC_ADDRESS = addr(
  process.env.NEXT_PUBLIC_USDC_ADDRESS,
  "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d"
);
export const CCTP_TOKEN_MESSENGER = addr(
  process.env.NEXT_PUBLIC_CCTP_TOKEN_MESSENGER,
  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA"
);

/**
 * Circle CCTP destination domains (testnet).
 * Source: Circle CCTP docs + Injective USDC/CCTP docs.
 * Injective testnet & mainnet both use domain 29.
 * NB: Arbitrum Sepolia = 2 (NOT 1); Avalanche Fuji = 1.
 */
export const CCTP_DOMAINS: { domain: number; label: string }[] = [
  { domain: 29, label: "Injective (same-chain)" },
  { domain: 0, label: "Ethereum Sepolia" },
  { domain: 6, label: "Base Sepolia" },
  { domain: 2, label: "Arbitrum Sepolia" },
  { domain: 1, label: "Avalanche Fuji" },
];

export type OracleEvent = {
  matchId: bigint | number;
  timestamp: bigint | number;
  minute: number;
  category: string;
  eventType: string;
  details: string;
  updater: Address | string;
};

/** Named component ABI so viem returns objects, not index tuples. */
export const ORACLE_ABI = [
  {
    type: "function",
    name: "getEvents",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "matchId", type: "uint256" },
          { name: "timestamp", type: "uint64" },
          { name: "minute", type: "uint32" },
          { name: "category", type: "string" },
          { name: "eventType", type: "string" },
          { name: "details", type: "string" },
          { name: "updater", type: "address" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getLatestEvent",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "matchId", type: "uint256" },
          { name: "timestamp", type: "uint64" },
          { name: "minute", type: "uint32" },
          { name: "category", type: "string" },
          { name: "eventType", type: "string" },
          { name: "details", type: "string" },
          { name: "updater", type: "address" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "eventCount",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allMatchIds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "event",
    name: "EventAdded",
    inputs: [
      { name: "matchId", type: "uint256", indexed: true },
      { name: "index", type: "uint256", indexed: true },
      { name: "category", type: "string", indexed: false },
      { name: "eventType", type: "string", indexed: false },
      { name: "timestamp", type: "uint64", indexed: false },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** FanDrops ABI for frontend interactions */
export const FAN_DROPS_ABI = [
  {
    type: "function",
    name: "drops",
    stateMutability: "view",
    inputs: [{ name: "dropId", type: "uint256" }],
    outputs: [
      { name: "matchId", type: "uint256" },
      { name: "eventType", type: "string" },
      { name: "minuteFrom", type: "uint32" },
      { name: "minuteTo", type: "uint32" },
      { name: "perWinnerAmount", type: "uint256" },
      { name: "maxWinners", type: "uint32" },
      { name: "claimedCount", type: "uint32" },
      { name: "funded", type: "uint256" },
      { name: "sponsor", type: "address" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "createDrop",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "eventType", type: "string" },
      { name: "minuteFrom", type: "uint32" },
      { name: "minuteTo", type: "uint32" },
      { name: "perWinnerAmount", type: "uint256" },
      { name: "maxWinners", type: "uint32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "whitelist",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dropId", type: "uint256" },
      { name: "wallets", type: "address[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "eligible",
    stateMutability: "view",
    inputs: [
      { name: "dropId", type: "uint256" },
      { name: "wallet", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [
      { name: "dropId", type: "uint256" },
      { name: "wallet", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "dropId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimToChain",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dropId", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "nextDropId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "DropCreated",
    inputs: [
      { name: "dropId", type: "uint256", indexed: true },
      { name: "matchId", type: "uint256", indexed: true },
      { name: "eventType", type: "string", indexed: false },
      { name: "perWinnerAmount", type: "uint256", indexed: false },
      { name: "maxWinners", type: "uint32", indexed: false },
      { name: "sponsor", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "dropId", type: "uint256", indexed: true },
      { name: "winner", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

/** OracleTreasury ABI for feeder earnings */
export const TREASURY_ABI = [
  {
    type: "function",
    name: "earnedBy",
    stateMutability: "view",
    inputs: [{ name: "feeder", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "feederEventCount",
    stateMutability: "view",
    inputs: [{ name: "feeder", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "feederPaidOut",
    stateMutability: "view",
    inputs: [{ name: "feeder", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalRevenue",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalEventCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawToChain",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
] as const;

/** Circle TokenMessengerV2 depositForBurn */
export const TOKEN_MESSENGER_ABI = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
] as const;

export type MatchMeta = {
  home: string;
  away: string;
  homeFlag: string;
  awayFlag: string;
};

/** Demo / fallback labels for known fixture ids. */
export const DEMO_MATCH_META: Record<number, MatchMeta> = {
  2026001: {
    home: "Argentina",
    away: "France",
    homeFlag: "🇦🇷",
    awayFlag: "🇫🇷",
  },
  855736: {
    home: "Qatar",
    away: "Ecuador",
    homeFlag: "🇶🇦",
    awayFlag: "🇪🇨",
  },
};

export function metaFor(id: number): MatchMeta {
  return (
    DEMO_MATCH_META[id] || {
      home: `Home #${id}`,
      away: `Away #${id}`,
      homeFlag: "⚽",
      awayFlag: "⚽",
    }
  );
}
