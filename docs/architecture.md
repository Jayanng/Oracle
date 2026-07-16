# CupEvent Oracle — Architecture

```
                       ┌───────────────────────────────┐
                       │       Live Sports API         │
                       │  (api-football / simulator)   │
                       └───────────────┬───────────────┘
                                       │ pull every 30–60s
                                       ▼
                       ┌───────────────────────────────┐
                       │        Data Feeder            │
                       │  (Node/TS, FEEDER_ROLE)       │
                       └───────────────┬───────────────┘
                                       │ addEvent()
                                       ▼
┌────────────────┐          ┌───────────────────────────────┐
│  Other dApps   │◄────────►│  CupEventOracle.sol (Injective│
│  / builders    │  read    │  EVM testnet 1439)            │
└────────────────┘          └───────────────┬───────────────┘
                                            │
                          ┌─────────────────┼─────────────────┐
                          ▼                 ▼                 ▼
                 ┌────────────────┐  ┌──────────────┐  ┌──────────────┐
                 │  Next.js UI    │  │  MCP Agent   │  │ CupRewards   │
                 │  (5 pages)     │◄─┤ (LLM+tools)  ├─►│ + CCTP send  │
                 └────────────────┘  └──────┬───────┘  └──────────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │  x402 paywalled  │
                                   │  premium-stats   │
                                   └──────────────────┘
```

## Required tech mapping

| Tech | Where |
|------|-------|
| MCP Server | `agent/src/server.ts` — tools: get_latest_event, list_events, settle_match, get_premium_stats |
| x402 | `x402-endpoint/` + `agent/src/tools.ts#getPremiumStats` |
| CCTP | `frontend` Rewards page — TokenMessengerV2 depositForBurn |
| Agent Skills | Tool schemas + system prompt in `agent/src/chat.ts` |

## Contracts

- **CupEventOracle** — append-only event log per matchId; FEEDER_ROLE gated.
- **CupRewards** — stake HOME/DRAW/AWAY in USDC; settle from oracle `final` or admin `settleWithOutcome`; claim proportional payout.
