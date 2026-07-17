import type { Address } from "viem";

function addr(env: string | undefined, fallback = ""): Address {
  const v = (env || fallback).trim();
  if (v && v.startsWith("0x") && v.length === 42) return v as Address;
  // Empty so pages' `length === 42` checks treat missing contracts as unset
  return "" as Address;
}

export const ORACLE_ADDRESS = addr(
  process.env.NEXT_PUBLIC_ORACLE_ADDRESS,
  "0xb7f6a30cc6a27c4c36000383651454453955e9f2"
);
export const REWARDS_ADDRESS = addr(
  process.env.NEXT_PUBLIC_REWARDS_ADDRESS,
  "0xa046a8f9a88292204b361666beea70d4419472fe"
);
export const USDC_ADDRESS = addr(
  process.env.NEXT_PUBLIC_USDC_ADDRESS,
  "0x670A694747c84f3B5EA1F7979eF10427fe5b1194"
);
export const CCTP_TOKEN_MESSENGER = addr(
  process.env.NEXT_PUBLIC_CCTP_TOKEN_MESSENGER,
  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA"
);

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

export const REWARDS_ABI = [
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "pick", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settleWithOutcome",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "outcome", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "uint256" }],
    outputs: [
      { name: "matchId", type: "uint256" },
      { name: "closesAt", type: "uint64" },
      { name: "resolved", type: "uint8" },
      { name: "totalHome", type: "uint256" },
      { name: "totalDraw", type: "uint256" },
      { name: "totalAway", type: "uint256" },
      { name: "settled", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "stakes",
    stateMutability: "view",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256[3]" }],
  },
  {
    type: "function",
    name: "logCrossChainWithdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "dstDomain", type: "uint32" },
      { name: "amount", type: "uint256" },
      { name: "recipient", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "openMarket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "uint256" },
      { name: "closesAt", type: "uint64" },
    ],
    outputs: [],
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

/** Circle TokenMessengerV2 depositForBurn (common 4-arg form). */
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
  6: {
    home: "Match #6",
    away: "—",
    homeFlag: "⚽",
    awayFlag: "⚽",
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
