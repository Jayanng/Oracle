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

### The end-to-end fan flow (browser, no human-in-the-loop friction)

```
Fan connects wallet
   │
   ▼  buys premium analytics on /x402
Fan's OWN wallet pays 0.10 USDC via x402 (EIP-3009 signature, browser-signed)
   │  facilitator submits on-chain, settles into OracleTreasury
   ▼
Success modal: amount paid + settlement tx + "Whitelisted ✓"
   │  agent auto-resolves the match's drop (and auto-creates one if none exists)
   ▼  fan is whitelisted for that match's Fan Drop
Fan opens /drops → claims USDC
   ├── same-chain on Injective, or
   └── cross-chain via CCTP (Sepolia / Base / Arbitrum / Avalanche)
```

The **fan's wallet** pays x402 in the browser via a hand-rolled EIP-3009 payer
(`frontend/src/lib/x402.ts`) that mirrors `@injectivelabs/x402`'s `createPayment`
wire format exactly. The **agent** still self-pays for x402 in the chat flow.

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
     (6 pages)              (LLM + 9 tools)          ├── sponsor drops
          │                    │    │                ├── whitelist wallets
          │                    │    │                ├── claim (same-chain)
          │                    │    │                └── claimToChain (CCTP)
          │                    │    └── auto-create + auto-whitelist drop
          │                    ▼         (on x402 purchase)
          │             agent self-pays x402 (chat)
          ▼
   /x402 page: FAN's wallet pays x402 (EIP-3009, browser-signed)
          │
          ▼
   x402 endpoint :4021  (@injectivelabs/x402 middleware, settle → treasury)
   /premium-stats  /historical-events  /webhooks  /health
```

See [docs/architecture.md](./docs/architecture.md) and [docs/verification.md](./docs/verification.md).

## How required tech is used

| Tech | Where |
|------|-------|
| **MCP Server** | `agent/src/server.ts` — 9 tools: `get_latest_event`, `list_events`, `get_premium_stats`, `create_drop`, `whitelist_drop`, `check_drop_eligibility`, `pay_drop`, `feeder_earnings`, `withdraw_feeder_earnings` |
| **x402** | `x402-endpoint/` — 3 metered endpoints (`/premium-stats`, `/historical-events`, `/webhooks/subscribe`) via the official `@injectivelabs/x402` middleware (EIP-3009, `settlementPolicy: "before"`); on-chain settlement into `OracleTreasury`. **Two payers:** the agent self-pays in chat (`agent/src/tools.ts`), and the **fan's browser wallet** pays directly on `/x402` (`frontend/src/lib/x402.ts`). CORS exposes the `PAYMENT-REQUIRED` / `PAYMENT-RESPONSE` protocol headers so browser clients can read the challenge + settlement receipt. |
| **CCTP** | `FanDrops.claimToChain`, `OracleTreasury.withdrawToChain`, `frontend/src/app/drops/**` — cross-chain USDC burns routed through our contracts (never called directly from the frontend), attestation polled via Circle Iris, mint (`receiveMessage`) submitted on the destination chain. Supports Sepolia, Base Sepolia, Arbitrum Sepolia, Avalanche Fuji. |
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
5. **/drops** — Active drops (claim same-chain or cross-chain via CCTP), sponsor form, feeder earnings
6. **/x402** — Premium analytics store: the **fan's own wallet** pays 0.10 USDC via x402, gets a success modal (amount + settlement tx), and is auto-whitelisted for the match's Fan Drop

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
| `USDC_TESTNET_ADDRESS` | `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d` (Circle testnet USDC) |
| `X402_SETTLER_ADDRESS` | Address of the x402 endpoint's signer (granted X402_SETTLER_ROLE) |
| `CCTP_TOKEN_MESSENGER` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| `FEEDER_MODE` | `simulator` (default) or `live` |
| `GROQ_API_KEY` | LLM for agent chat (Groq preferred, OpenAI fallback) |
| `NEXT_PUBLIC_SEPOLIA_RPC` | Sepolia RPC for CCTP mint (default `ethereum-sepolia-rpc.publicnode.com`; old `rpc.sepolia.org` is dead) |
| `AUTO_DROP_AMOUNT_USDC` | Per-winner USDC for agent auto-created drops (default `0.10`) |
| `AUTO_DROP_MAX_WINNERS` | Max winners for agent auto-created drops (default `20`) |

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

## Cross-chain claims (CCTP) & gas requirements

Fans can claim drop rewards on Injective (same-chain) or bridge to another
testnet via **Circle CCTP v2**. The flow is: burn on Injective → poll Circle
Iris for the attestation → **mint (`receiveMessage`) on the destination chain**.

The **mint runs on the destination chain**, so you pay gas there in that chain's
**native token** — not INJ. `receiveMessage` costs ~120k–200k gas.

| Destination | Gas token | Est. mint cost | Suggested balance | RPC (default) |
|-------------|-----------|----------------|-------------------|---------------|
| Ethereum Sepolia | ETH | ~0.00015 ETH | **0.01 ETH** (spikes) | `ethereum-sepolia-rpc.publicnode.com` |
| Base Sepolia | ETH | ~0.000001 ETH | **0.001 ETH** | `base-sepolia-rpc.publicnode.com` |
| Arbitrum Sepolia | ETH | ~0.000003 ETH | **0.001 ETH** | `arbitrum-sepolia-rpc.publicnode.com` |
| Avalanche Fuji | AVAX | ~0 (near-zero) | **0.05 AVAX** | `avalanche-fuji-c-chain-rpc.publicnode.com` |

- The **burn** step is on Injective — keep a little **INJ** for that.
- For demos, **Base / Arbitrum Sepolia** are effectively free to mint on.
- RPCs are configurable: `NEXT_PUBLIC_SEPOLIA_RPC` (and per-destination `rpc` in
  `frontend/src/lib/contracts.ts` → `CHAIN_CONFIG`). The legacy
  `rpc.sepolia.org` was retired (now 404s) and has been replaced with reliable
  public nodes throughout.

## Deploy your own

1. Fund deployer / feeder / agent with testnet INJ.
2. `export USDC_TESTNET_ADDRESS=0x0C382e... && export USE_MOCK_USDC=false && forge script script/Deploy.s.sol --rpc-url $INJ_EVM_RPC --broadcast --slow`
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

### Multi-sport expansion

> **Hackathon scope:** this build ships **football / FIFA World Cup 2026** only. The feeder hardcodes `category = "football"` and the sports providers target WC fixtures. The on-chain contracts, however, are **category-agnostic** — `CupEventOracle.addEvent` takes an opaque `category` string and a JSON `details` blob, so the same primitive extends to any discrete real-world event with **no contract changes**. Multi-sport support is a post-hackathon roadmap item, not part of the current submission.

| Phase | Sport / domain | `category` | New `eventType`s | Work required |
|-------|----------------|-----------|------------------|---------------|
| 1 | Club football (EPL, UCL, La Liga) | `football` | goal, card, sub, var, final | New API-Football league IDs + season config in `feeder/providers` |
| 2 | Esports (CS2, Valorant, LoL) | `esports` | round_win, map_end, series_end, bomb_plant | New provider (e.g. PandaScore / Abios) + `category` param in feeder |
| 3 | Tennis (ATP/WTA) | `tennis` | set, break, match_end, ace | New provider + per-sport analytics shape |
| 4 | Elections / governance | `election` | precinct_call, result_called, certified | Off-chain verified feeds (AP/Edison) + multi-source attestation |
| 5 | Olympics | `olympics` | medal_awarded, heat_finish, record_set | Multi-discipline provider + medal-table analytics |

**Already multi-sport-ready (no changes needed):** `CupEventOracle`, `OracleTreasury` (pro-rata feeder payouts), `FanDrops` (event-triggered claims + CCTP), the MCP agent tools, and the x402 paywall.

**Needs per-sport work:** feeder providers, the `category` argument in `feeder/src/index.ts` & `simulator.ts`, the analytics shape in `x402-endpoint/src/analytics.ts`, and the frontend team/flag maps (`WorldCupBracket.tsx`, `x402/page.tsx`).

## Demo talking points

**Why not Pyth/Chainlink?** — They optimise for financial price data. Events are discrete/categorical from unstructured sources. This primitive is complementary, not competitive, and agents consume it via MCP.

**x402 in the demo** — Two payer paths, both real EIP-3009 on-chain settlement into the treasury:
- **Agent (chat):** hits the paywalled endpoint → HTTP 402 + requirements → signs → retries → premium stats returned. Zero human in the loop.
- **Fan (browser, `/x402`):** the fan's own wallet signs an EIP-3009 `TransferWithAuthorization` for 0.10 USDC → the facilitator submits it → success modal shows the settlement tx → the fan is auto-whitelisted for the match's drop.

**Fan drops** — Sponsors pre-fund USDC; oracle events trigger automated payouts. After paying for analytics, a fan is **auto-whitelisted** for that match's drop — and if no drop exists yet for the match, the agent **auto-creates a small sponsor-funded drop on the fly** (configurable via `AUTO_DROP_AMOUNT_USDC` / `AUTO_DROP_MAX_WINNERS`), then whitelists the fan. Fans claim free rewards same-chain or to any supported chain via CCTP. No staking, no risk.

**Feeder economy** — Anyone can run a feeder and earn pro-rata share of x402 revenue. Withdraw same-chain or cross-chain via CCTP.

## License

MIT
