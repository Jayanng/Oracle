<div align="center">

# CupEvent Oracle · <sub>KICKOFF</sub>

**A real-world *event* oracle for Injective EVM — live World Cup match events on-chain, consumable by AI agents over MCP, monetized with x402, and paid out cross-chain via CCTP.**

[![Injective EVM](https://img.shields.io/badge/Injective-EVM%20testnet%201439-4E46FF)](https://docs.injective.network/developers-evm/)
[![Foundry](https://img.shields.io/badge/Foundry-29%2F29%20passing-3fb950)](./contracts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Built for the **Injective Global Cup (HackQuest)** · Chain ID `1439`

</div>

---

## Overview

Injective has world-class **price** oracles (Pyth, Chainlink Data Streams) but **no general-purpose *event* oracle**. Real-world event data is discrete, categorical, and sourced from unstructured APIs — a fundamentally different shape from low-latency numeric feeds.

**CupEvent Oracle** is a lightweight, reusable primitive for that data shape, exposed through an **MCP interface** so AI agents — not just smart contracts — can consume it. The contracts are category-agnostic: after the World Cup, the same primitive serves EPL, NFL, esports, elections, and more with only a different `category` string.

### Three primitives, one loop

| # | Primitive | What it does |
|---|-----------|--------------|
| 1 | **Sponsor-funded Fan Drops** | Brands pre-fund USDC drops triggered by oracle events. Fans claim free rewards — zero user risk, no staking. |
| 2 | **Oracle Data Marketplace** | Every premium query is metered via **x402**. Fees accumulate in an on-chain treasury. |
| 3 | **Feeder Economy** | Data feeders earn a pro-rata share of treasury revenue, withdrawable same-chain or cross-chain via **CCTP**. |

---

## The end-to-end fan flow

No human-in-the-loop friction — everything happens in the browser.

```
Fan connects wallet
   │
   ▼  buys premium analytics on /x402
Fan's OWN wallet pays 0.10 USDC via x402  (EIP-3009 signature, browser-signed)
   │  facilitator submits on-chain → settles into OracleTreasury
   ▼
Success modal: amount paid · settlement tx · "Whitelisted"
   │  agent auto-resolves the match's drop (auto-creates one if none exists)
   ▼  fan is whitelisted for that match's Fan Drop
Fan opens /drops → claims USDC
   ├── same-chain on Injective, or
   └── cross-chain via CCTP  (Sepolia · Base · Arbitrum · Avalanche)
```

The fan's wallet pays x402 directly in the browser via a hand-rolled EIP-3009 payer (`frontend/src/lib/x402.ts`) that mirrors `@injectivelabs/x402`'s `createPayment` wire format exactly. The agent additionally self-pays for x402 in the chat flow.

---

## Architecture

```
  Sports API / Simulator
           │ poll 30–60s
           ▼
  Data Feeder ──addEvent()──►  CupEventOracle.sol   (Injective EVM 1439)
                                     │
                     treasury.recordEvent(msg.sender)
                                     ▼
                            OracleTreasury.sol
                            ├── tracks feeder event counts
                            ├── accumulates x402 revenue
                            └── pro-rata payouts to feeders
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
   Next.js UI                   MCP Agent                   FanDrops.sol
   (5 pages)                (LLM + 9 tools)             ├── sponsor drops
        │                        │   │                  ├── whitelist wallets
        │                        │   │                  ├── claim (same-chain)
        │                        │   └── auto-create +   └── claimToChain (CCTP)
        │                        │       auto-whitelist
        │                        ▼        (on x402 purchase)
        │                 agent self-pays x402 (chat)
        ▼
   /x402 page: FAN's wallet pays x402  (EIP-3009, browser-signed)
        │
        ▼
   x402 endpoint :4021  (@injectivelabs/x402 middleware → settle → treasury)
   /premium-stats   /historical-events   /webhooks   /health
```

See [`docs/architecture.md`](./docs/architecture.md) and [`docs/verification.md`](./docs/verification.md) for detail.

---

## Repository layout

```
cup-event-oracle/
├── contracts/        # Foundry — CupEventOracle · FanDrops · OracleTreasury · MockUSDC
├── feeder/           # Polls sports API or runs a simulator → addEvent()   (:4030)
├── agent/            # MCP stdio server + HTTP chat                         (:4020)
├── x402-endpoint/    # Paywalled premium analytics + treasury settlement    (:4021)
├── frontend/         # Next.js 14 UI — 5 pages                              (:3000)
├── scripts/          # Ops / deploy helpers
├── docs/             # architecture · verification · env-checklist · sports-data
└── README.md
```

### Smart contracts

| Contract | Responsibility |
|----------|----------------|
| `CupEventOracle.sol` | Append-only event log keyed by `matchId`; category-agnostic (`category`, `eventType`, JSON `details`). |
| `OracleTreasury.sol` | Records feeder event counts, accumulates x402 revenue, pays feeders pro-rata; `withdrawToChain` for CCTP. |
| `FanDrops.sol` | Sponsor-funded drops, whitelist, oracle-gated `claim`, and `claimToChain` for cross-chain rewards. |
| `MockUSDC.sol` | Local/test USDC (production uses Circle testnet USDC). |

### Frontend pages

| Route | Page |
|-------|------|
| `/` | Landing — pitch, drops + marketplace, "beyond the World Cup" |
| `/dashboard` | Live match feed + on-chain event log |
| `/agent` | CupAgent chat + tool/x402 action log |
| `/drops` | Active drops (claim same-chain or cross-chain via CCTP), sponsor form, feeder earnings |
| `/x402` | Premium analytics store — the fan's own wallet pays 0.10 USDC via x402 and is auto-whitelisted for the match's drop |

---

## How the required tech is used

| Tech | Where & how |
|------|-------------|
| **MCP Server** | `agent/src/server.ts` — 9 tools: `get_latest_event`, `list_events`, `get_premium_stats`, `create_drop`, `whitelist_drop`, `check_drop_eligibility`, `pay_drop`, `feeder_earnings`, `withdraw_feeder_earnings`. |
| **x402** | `x402-endpoint/` — 3 metered endpoints via the official `@injectivelabs/x402` middleware (EIP-3009, `settlementPolicy: "before"`) settling into `OracleTreasury`. **Two payers:** the agent self-pays in chat (`agent/src/tools.ts`), and the fan's browser wallet pays directly on `/x402` (`frontend/src/lib/x402.ts`). CORS exposes the `PAYMENT-REQUIRED` / `PAYMENT-RESPONSE` protocol headers so browsers can read the challenge + settlement receipt. |
| **CCTP** | `FanDrops.claimToChain` and `OracleTreasury.withdrawToChain` — cross-chain USDC burns routed *through* our contracts (never called directly from the frontend), attestation polled via Circle Iris, mint (`receiveMessage`) submitted on the destination chain. Supports Sepolia, Base Sepolia, Arbitrum Sepolia, Avalanche Fuji. |
| **Agent Skills** | Tool schemas + system prompt in `agent/src/chat.ts` — OpenAI/Groq tool-calling with a deterministic regex fallback across 4 capability categories. |

---

## Quickstart

### Prerequisites

- Node **20+**
- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Testnet keys + INJ from the [Injective faucet](https://testnet.faucet.injective.network/)

### Run it

```bash
git clone <repo> && cd cup-event-oracle
cp .env.example .env          # fill in keys / addresses after deploy
npm install

# Contracts
cd contracts && forge test -vv   # 29 tests, all passing
cd ..

# Start the 4 services (separate terminals)
npm run dev:x402     # :4021 — x402 paywalled analytics
npm run dev:agent    # :4020 — MCP agent chat
npm run dev:feeder   # :4030 — data feeder (simulator by default)
npm run dev:web      # :3000 — Next.js UI
```

Open **http://localhost:3000** → connect wallet → **Dashboard** for the live match feed, or **Agent** to chat with CupAgent.

### Key environment variables

| Variable | Purpose |
|----------|---------|
| `INJ_EVM_RPC` / `INJ_EVM_CHAIN_ID` | Injective EVM testnet RPC / `1439` |
| `ORACLE_ADDRESS` · `TREASURY_ADDRESS` · `DROPS_ADDRESS` | Deployed contract addresses (filled after deploy) |
| `USDC_TESTNET_ADDRESS` | `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d` (Circle testnet USDC) |
| `X402_MODE` | `official` (uses `@injectivelabs/x402`) or `demo` |
| `X402_FACILITATOR_PRIVATE_KEY` | Wallet that submits the EIP-3009 settlement tx — **must differ from the payer** |
| `X402_SETTLER_ADDRESS` | x402 signer address (granted `X402_SETTLER_ROLE`) |
| `CCTP_TOKEN_MESSENGER` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| `FEEDER_MODE` | `simulator` (default) or `live` |
| `GROQ_API_KEY` | LLM for agent chat (Groq preferred, OpenAI fallback) |
| `AUTO_DROP_AMOUNT_USDC` / `AUTO_DROP_MAX_WINNERS` | Config for agent auto-created drops (default `0.10` / `20`) |

> The full list lives in [`.env.example`](./.env.example) and [`docs/env-checklist.md`](./docs/env-checklist.md).

---

## Deploy your own

```bash
export USDC_TESTNET_ADDRESS=0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d
export USE_MOCK_USDC=false
forge script script/Deploy.s.sol --rpc-url $INJ_EVM_RPC --broadcast --slow
```

1. Fund the deployer / feeder / agent wallets with testnet INJ.
2. Run the deploy script above.
3. Copy the printed `Oracle` / `Treasury` / `Drops` / `USDC` addresses into `.env` **and** `frontend/.env.local`.
4. Restart all 4 services to pick up the new addresses.
5. Get testnet USDC from [Circle's faucet](https://faucet.circle.com/) for the deployer / feeder / agent wallets.

---

## Query the oracle from your dApp

```solidity
interface ICupEventOracle {
    function getLatestEvent(uint256 matchId) external view returns (
        uint256 matchId_, uint64 timestamp, uint32 minute,
        string memory category, string memory eventType,
        string memory details, address updater
    );
}
```

```ts
const latest = await publicClient.readContract({
  address: oracle,
  abi: oracleAbi,
  functionName: "getLatestEvent",
  args: [2026001n],
});
```

---

## Cross-chain claims (CCTP)

Fans can claim drop rewards on Injective (same-chain) or bridge them to another testnet via **Circle CCTP v2**:
**burn on Injective → poll Circle Iris for the attestation → mint (`receiveMessage`) on the destination chain.**

Because the mint runs on the destination chain, gas is paid there in that chain's **native token** (not INJ). `receiveMessage` costs ~120k–200k gas.

| Destination | Gas token | Est. mint cost | Suggested balance | RPC (default) |
|-------------|-----------|----------------|-------------------|---------------|
| Ethereum Sepolia | ETH | ~0.00015 ETH | **0.01 ETH** (spikes) | `ethereum-sepolia-rpc.publicnode.com` |
| Base Sepolia | ETH | ~0.000001 ETH | **0.001 ETH** | `base-sepolia-rpc.publicnode.com` |
| Arbitrum Sepolia | ETH | ~0.000003 ETH | **0.001 ETH** | `arbitrum-sepolia-rpc.publicnode.com` |
| Avalanche Fuji | AVAX | ~near-zero | **0.05 AVAX** | `avalanche-fuji-c-chain-rpc.publicnode.com` |

- Keep a little **INJ** for the burn step on Injective.
- For demos, **Base / Arbitrum Sepolia** are effectively free to mint on.
- RPCs are configurable via `NEXT_PUBLIC_SEPOLIA_RPC` and per-destination `rpc` in `frontend/src/lib/contracts.ts` (`CHAIN_CONFIG`).

---

## Beyond the World Cup

> **Hackathon scope:** this build ships **football / FIFA World Cup 2026** only. The feeder hardcodes `category = "football"` and the providers target WC fixtures. The on-chain contracts, however, are **category-agnostic** — `CupEventOracle.addEvent` takes an opaque `category` string and a JSON `details` blob, so the same primitive extends to any discrete real-world event with **no contract changes**. Multi-sport support is a post-hackathon roadmap item.

| Phase | Domain | `category` | New `eventType`s | Work required |
|-------|--------|-----------|------------------|---------------|
| 1 | Club football (EPL, UCL, La Liga) | `football` | goal, card, sub, var, final | New API-Football league IDs / season config |
| 2 | Esports (CS2, Valorant, LoL) | `esports` | round_win, map_end, series_end | New provider (PandaScore / Abios) |
| 3 | Tennis (ATP/WTA) | `tennis` | set, break, match_end, ace | New provider + per-sport analytics |
| 4 | Elections / governance | `election` | precinct_call, result_called | Verified feeds + multi-source attestation |
| 5 | Olympics | `olympics` | medal_awarded, record_set | Multi-discipline provider |

**Already multi-sport-ready (no changes):** `CupEventOracle`, `OracleTreasury`, `FanDrops`, the MCP agent tools, the x402 paywall.
**Needs per-sport work:** feeder providers, the `category` argument in the feeder, the analytics shape in `x402-endpoint/src/analytics.ts`, and the frontend team/flag maps.

---

## Roadmap

- Decentralised feeder network with reputation slashing
- Push updates over websockets
- Multi-source event verification
- Mainnet deployment
- Fan-drop templates (time-based, score-based, combo triggers)

---

## Package verification

| Package | Version |
|---------|---------|
| `@injectivelabs/sdk-ts` | 1.20.24 |
| `@injectivelabs/x402` | 0.0.1 (also 0.1.0-rc.1) |
| `x402` | 1.2.0 |
| `@modelcontextprotocol/sdk` | 1.29.0 |

---

## License

[MIT](./LICENSE)
