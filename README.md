# CupEvent Oracle

[![Injective EVM](https://img.shields.io/badge/Injective-EVM%20testnet%201439-cyan)](https://docs.injective.network/developers-evm/)
[![Foundry](https://img.shields.io/badge/Foundry-tests%2029%2F29-green)](./contracts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> **The missing real-world event oracle for Injective** — live World Cup match events on-chain, exposed through an MCP-powered AI agent that autonomously pays for data via **x402**, sponsors fund fan drops, and feeders earn treasury revenue they can withdraw cross-chain via **CCTP**.

Hackathon: **Injective Global Cup (HackQuest)** · Deadline 2026-07-19

## Why this exists

Injective has world-class **price** oracles (Pyth, Chainlink Data Streams). It has **zero** general-purpose **event** oracles. Real-world event data is discrete, categorical, and sourced from unstructured APIs — a different shape from low-latency numeric feeds.

CupEvent Oracle is a lightweight, reusable primitive for that shape of data, with an MCP interface so **AI agents** (not just contracts) can consume it. After the World Cup it works for EPL, NFL, Olympics, esports, elections — same contract, different `category` string.

**Three new primitives replace the old staking model:**

1. **Sponsor-funded Fan Drops** — brands pre-fund USDC drops triggered by oracle events. Fans claim free rewards. Zero user risk.
2. **Oracle Data Marketplace** — every premium query is metered via x402. Fees accumulate in an on-chain treasury.
3. **Feeder Economy** — data feeders earn pro-rata share of treasury revenue, withdrawable same-chain or cross-chain via CCTP.

## Architecture

```
  Sports API / Simulator
           │ pull 30–60s
           ▼
  Data Feeder ──addEvent()──► CupEventOracle.sol (Injective EVM 1439)
                                    │
                     treasury.recordEvent(msg.sender)
                                    │
                                    ▼
                          OracleTreasury.sol
                          ├── tracks feeder event counts
                          ├── accumulates x402 revenue
                          └── pro-rata payouts to feeders
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
     Next.js UI                 MCP Agent              FanDrops.sol
     (5 pages)              (LLM + 8 tools)          ├── sponsor drops
                                                     ├── whitelist wallets
                                                     ├── claim (same-chain)
                                                     └── claimToChain (CCTP)
          │                         │
          ▼                         ▼
   x402 /premium-stats        x402 /historical-events
   x402 /health               x402 /webhooks
```

See [docs/architecture.md](./docs/architecture.md) and [docs/verification.md](./docs/verification.md).

## How required tech is used

| Tech | Where |
|------|-------|
| **MCP Server** | `agent/src/server.ts` — 9 tools: `get_latest_event`, `list_events`, `get_premium_stats`, `create_drop`, `whitelist_drop`, `check_drop_eligibility`, `pay_drop`, `feeder_earnings`, `withdraw_feeder_earnings` |
| **x402** | `x402-endpoint/` — 3 metered endpoints (`/premium-stats`, `/historical-events`, `/webhooks/subscribe`); on-chain settlement via `OracleTreasury.pullPayment`; agent retry loop in `agent/src/tools.ts` |
| **CCTP** | `FanDrops.claimToChain`, `OracleTreasury.withdrawToChain`, `frontend/src/app/drops/**` — cross-chain USDC burns routed through our contracts, never called directly from the frontend |
| **Agent Skills** | Tool schemas + system prompt in `agent/src/chat.ts` (OpenAI tools + deterministic regex fallback + 4 capability categories) |

### Package verification

| Package | Status | Version |
|---------|--------|---------|
| `@injectivelabs/sdk-ts` | ✅ | 1.20.24 |
| `@injectivelabs/x402` | ✅ | 0.0.1 (also 0.1.0-rc.1) |
| `x402` | ✅ | 1.2.0 |
| `@modelcontextprotocol/sdk` | ✅ | 1.29.0 |
| Injective MCP repo | `InjectiveLabs/mcp-server` (trading) — we ship oracle-specific MCP | |

## Repo layout

```
cup-event-oracle/
├── contracts/          # Foundry — CupEventOracle, FanDrops, OracleTreasury, MockUSDC
├── feeder/             # Poll sports API or run simulator → addEvent()
├── agent/              # MCP stdio server + HTTP chat (:4020)
├── frontend/           # Next.js 14 — 5 pages
├── x402-endpoint/      # Paywalled premium stats + treasury settlement (:4021)
├── docs/               # verification.md, architecture.md
└── README.md
```

## Frontend pages

1. **/** — Landing (pitch, drops + marketplace, beyond WC)
2. **/dashboard** — Live match feed + on-chain event log
3. **/agent** — CupAgent chat + tool/x402 action log
4. **/explorer** — Event table + "use this oracle" snippets
5. **/drops** — Active drops (claim), sponsor form, feeder earnings

## Quickstart (~5 min)

### Prerequisites

- Node 20+
- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Testnet keys + INJ from [faucet](https://testnet.faucet.injective.network/)

```bash
git clone <repo> && cd cup-event-oracle
cp .env.example .env                     # fill keys after deploy
npm install

# Contracts
cd contracts && forge test -vv           # 29 tests, all pass
# Deploy to Injective EVM testnet:
# export USDC_TESTNET_ADDRESS=0x670A...
# export USE_MOCK_USDC=false
# forge script script/Deploy.s.sol --rpc-url $INJ_EVM_RPC --broadcast --slow
cd ..

# Four terminals
npm run dev:x402     # :4021 — x402 paywalled analytics
npm run dev:agent    # :4020 — MCP agent chat
npm run dev:feeder   # :4030 — data feeder (simulator by default)
npm run dev:web      # :3000 — Next.js UI
```

Open http://localhost:3000 → connect wallet → **Dashboard** for live match feed, or **Agent** to chat with CupAgent.

### Env highlights

| Var | Purpose |
|-----|---------|
| `INJ_EVM_RPC` / `CHAIN_ID` | `https://k8s.testnet.json-rpc.injective.network` / `1439` |
| `ORACLE_ADDRESS` | Deployed oracle address (filled after deploy) |
| `TREASURY_ADDRESS` | Deployed OracleTreasury address (filled after deploy) |
| `DROPS_ADDRESS` | Deployed FanDrops address (filled after deploy) |
| `USDC_TESTNET_ADDRESS` | `0x670A694747c84f3B5EA1F7979eF10427fe5b1194` (Circle testnet USDC) |
| `X402_SETTLER_ADDRESS` | Address of the x402 endpoint's signer (granted X402_SETTLER_ROLE) |
| `CCTP_TOKEN_MESSENGER` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| `FEEDER_MODE` | `simulator` (default) or `live` |
| `GROQ_API_KEY` | LLM for agent chat (Groq preferred, OpenAI fallback) |

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

## Deploy your own

1. Fund deployer / feeder / agent with testnet INJ.
2. `export USDC_TESTNET_ADDRESS=0x670A... && export USE_MOCK_USDC=false && forge script script/Deploy.s.sol --rpc-url $INJ_EVM_RPC --broadcast --slow`
3. Copy printed `Oracle` / `Treasury` / `Drops` / `USDC` into `.env` and `frontend/.env.local`.
4. Restart all 4 services to pick up the new addresses.
5. Get testnet USDC from [Circle's faucet](https://faucet.circle.com/) for the deployer/feeder/agent wallets.

## Beyond the World Cup

| Category | eventType examples | Use case |
|----------|--------------------|----------|
| football | goal, card, final | WC, EPL, UCL |
| esports | round_win, map_end | fan drops, data marketplaces |
| election | precinct_call | media / governance |
| tennis | set, match_end | live odds |

## Roadmap

- Decentralised feeder network with reputation slashing
- Push updates via websockets
- Multi-source event verification
- Mainnet deployment
- Fan drop templates (time-based, score-based, combo triggers)

## Demo talking points

**Why not Pyth/Chainlink?** — They optimise for financial price data. Events are discrete/categorical from unstructured sources. This primitive is complementary, not competitive, and agents consume it via MCP.

**x402 in the demo** — Agent hits paywalled endpoint → HTTP 402 + requirements → signs EIP-712 Payment → retries → server verifies → premium stats returned. Zero human in the loop. Payments settle on-chain into the treasury.

**Fan drops** — Sponsors pre-fund USDC. Agent whitelists wallets. Oracle events trigger automated payouts. Fans claim free rewards to any supported chain via CCTP. No staking, no risk.

**Feeder economy** — Anyone can run a feeder and earn pro-rata share of x402 revenue. Withdraw same-chain or cross-chain via CCTP.

## License

MIT
