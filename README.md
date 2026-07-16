# CupEvent Oracle

[![Injective EVM](https://img.shields.io/badge/Injective-EVM%20testnet%201439-cyan)](https://docs.injective.network/developers-evm/)
[![Foundry](https://img.shields.io/badge/Foundry-tests%20green-green)](./contracts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> **The missing real-world event oracle for Injective** — live World Cup match events on-chain, exposed through an MCP-powered natural-language AI agent that autonomously pays for data via **x402** and distributes cross-chain rewards via **CCTP**.

Hackathon: **Injective Global Cup (HackQuest)** · Deadline 2026-07-19

## Why this exists

Injective has world-class **price** oracles (Pyth, Chainlink Data Streams). It has **zero** general-purpose **event** oracles. Real-world event data is discrete, categorical, and sourced from unstructured APIs — a different shape from low-latency numeric feeds.

CupEvent Oracle is a lightweight, reusable primitive for that shape of data, with an MCP interface so **AI agents** (not just contracts) can consume it. After the World Cup it works for EPL, NFL, Olympics, esports, elections — same contract, different `category` string.

## Architecture

```
  Sports API / Simulator
           │ pull 30–60s
           ▼
       Data Feeder ──addEvent()──► CupEventOracle.sol (Injective EVM 1439)
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
         Next.js UI                 MCP Agent                 CupRewards
         (5 pages)              (LLM + tools)               + CCTP burn
                                        │
                                        ▼
                               x402 /premium-stats
```

See [docs/architecture.md](./docs/architecture.md) and [docs/verification.md](./docs/verification.md) (package + endpoint verification).

## How required tech is used

| Tech | Where |
|------|-------|
| **MCP Server** | `agent/src/server.ts` — tools: `get_latest_event`, `list_events`, `settle_match`, `get_premium_stats` |
| **x402** | `x402-endpoint/` + `agent/src/tools.ts` `getPremiumStats` (HTTP 402 → EIP-712 → retry) |
| **CCTP** | `frontend/src/app/rewards/page.tsx` — TokenMessengerV2 `depositForBurn` + simulator toggle |
| **Agent Skills** | Tool schemas + system prompt in `agent/src/chat.ts` (OpenAI tools + deterministic fallback) |

### Package verification (Step 0)

| Package | Status | Version |
|---------|--------|---------|
| `@injectivelabs/sdk-ts` | ✅ | 1.20.24 |
| `@injectivelabs/x402` | ✅ | 0.0.1 (also 0.1.0-rc.1) |
| `x402` | ✅ | 1.2.0 |
| `@modelcontextprotocol/sdk` | ✅ | 1.29.0 |
| Injective MCP repo | `InjectiveLabs/mcp-server` (trading) — we ship oracle-specific MCP | |

Demo path uses **vanilla x402** (no facilitator gas) so demos never block on USDC EIP-3009 settlement. Official `@injectivelabs/x402` is confirmed real for production upgrades.

## Repo layout

```
cup-event-oracle/
├── contracts/          # Foundry — CupEventOracle, CupRewards, MockUSDC
├── feeder/             # Poll sports API or run simulator → addEvent()
├── agent/              # MCP stdio server + HTTP chat (:4020)
├── frontend/           # Next.js 14 — 5 pages
├── x402-endpoint/      # Paywalled premium stats (:4021)
├── docs/               # verification.md, architecture.md
└── README.md
```

## Frontend pages

1. **/** — Landing (pitch, architecture, beyond WC)
2. **/dashboard** — Live match feed + stake modal
3. **/agent** — CupAgent chat + tool/x402 action log
4. **/explorer** — Event table + “use this oracle” snippets
5. **/rewards** — Claim, CCTP withdraw, x402 demo

## Quickstart (~5 min)

### Prerequisites

- Node 20+
- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Testnet keys + INJ from [faucet](https://testnet.faucet.injective.network/) (optional for local Anvil)

```bash
git clone <repo> && cd cup-event-oracle   # or this workspace
cp .env.example .env                     # fill keys after deploy
npm install

# Contracts
cd contracts && forge test -vv
# Optional deploy to Injective EVM testnet:
# USE_MOCK_USDC=true forge script script/Deploy.s.sol \
#   --rpc-url $INJ_EVM_RPC --broadcast --private-key $DEPLOYER_PRIVATE_KEY
cd ..

# Four terminals (or background processes)
npm run dev:x402     # :4021
npm run dev:agent    # :4020
npm run dev:feeder   # :4030  (simulator by default)
npm run dev:web      # :3000
```

Open http://localhost:3000 → **Agent** → chip *“latest event in match 2026001”* (needs oracle address + funded feeder for on-chain path; x402 demo works with only agent + x402-endpoint).

### Env highlights

| Var | Purpose |
|-----|---------|
| `INJ_EVM_RPC` / `CHAIN_ID` | `https://k8s.testnet.json-rpc.injective.network` / `1439` |
| `USDC_TESTNET_ADDRESS` | `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d` |
| `CCTP_TOKEN_MESSENGER` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| `FEEDER_MODE` | `simulator` (default) or `live` |
| `OPENAI_API_KEY` | Optional — deterministic tool routing works without it |

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
2. `forge script script/Deploy.s.sol --rpc-url $INJ_EVM_RPC --broadcast`
3. Copy printed `Oracle` / `Rewards` / `USDC` into `.env` and `NEXT_PUBLIC_*`.
4. Grant `FEEDER_ROLE` to feeder address if not set via `FEEDER_ADDRESS` at deploy.
5. Deploy frontend (Vercel) + long-running feeder/agent/x402 (Railway/Fly).

## Beyond the World Cup

| Category | eventType examples | Use case |
|----------|--------------------|----------|
| football | goal, card, final | WC, EPL, UCL |
| esports | round_win, map_end | prediction markets |
| election | precinct_call | media / governance |
| tennis | set, match_end | live odds |

## Roadmap

- Multi-source feeder + reporter reputation
- Push updates via websockets
- Slashing for bad reporters
- Mainnet + prediction-market integrations

## Demo talking points

**Why not Pyth/Chainlink?** — They optimize for financial price data. Events are discrete/categorical from unstructured sources. This primitive is complementary, not competitive, and agents consume it via MCP.

**x402 in the demo** — Agent hits paywalled endpoint → HTTP 402 + requirements → signs EIP-712 Payment → retries with `X-PAYMENT` → server verifies sig → premium stats returned. Zero human in the loop.

## License

MIT
