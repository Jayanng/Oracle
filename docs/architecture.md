# CupEvent Oracle - Architecture

```
                      Live Sports API (worldcup26 / api-football)
                              |   pull every 30-60s
                              v
                      Data Feeder  (Node/TS, FEEDER_ROLE)  :4030
                              |   addEvent()
                              v
  Other dApps / builders <-----> CupEventOracle.sol (Injective EVM 1439)
                              |   treasury.recordEvent(msg.sender)
                              v
                     OracleTreasury.sol
                     |- tracks feeder event counts
                     |- accumulates x402 revenue (pullPayment)
                     |- pro-rata payouts to feeders (CCTP cross-chain)
                              |
            +-----------------+-----------------+
            v                 v                 v
      Next.js UI         MCP Agent         FanDrops.sol
      (5 pages)        (LLM + 9 tools)    |- sponsor drops (escrow)
            |                 |            |- whitelist wallets
            |                 |            |- claim (same-chain)
            |                 |            |- claimToChain (CCTP)
            |                 v
            |          x402 paywalled endpoints  :4021
            |          /premium-stats  /historical-events  /webhooks
            |                 |
            |                 v   (after x402 settlement)
            +-----> feeder /premium-stats/:id  (analytics engine)
                              |
                              v
                  Poisson/Dixon-Coles prediction model
                  Elo prior + api-football history + WC form + H2H
                  -> P(home/draw/away) + scorelines + expected goals
```

## Required tech mapping

| Tech | Where |
|------|-------|
| **MCP Server** | `agent/src/server.ts` — 9 tools: get_latest_event, list_events, get_premium_stats, create_drop, whitelist_drop, check_drop_eligibility, pay_drop, feeder_earnings, withdraw_feeder_earnings |
| **x402** | `x402-endpoint/` — 3 metered endpoints (`/premium-stats` 0.10 USDC, `/historical-events` 0.25 USDC, `/webhooks/subscribe` 1.00 USDC); on-chain settlement via `OracleTreasury.pullPayment`; agent retry loop in `agent/src/tools.ts` |
| **CCTP** | `FanDrops.claimToChain`, `OracleTreasury.withdrawToChain`, `frontend/src/app/drops` — cross-chain USDC burns via `TokenMessengerV2.depositForBurn` (domain 29 = Injective) |
| **Agent Skills** | Tool schemas + system prompt in `agent/src/chat.ts`; LLM = Groq (preferred) or OpenAI, with deterministic regex router fallback |

## Contracts (Solidity 0.8.24, OpenZeppelin AccessControl)

- **CupEventOracle** — append-only event log per matchId; `FEEDER_ROLE`-gated `addEvent()`; opaque `category`/`eventType`/`details`(JSON) strings (category-agnostic). Notifies `OracleTreasury` for feeder attribution.
- **OracleTreasury** — x402 revenue accumulation (`pullPayment`/`recordRevenue`, `X402_SETTLER_ROLE`); per-feeder event counts → pro-rata `earnedBy()`; `withdraw()` same-chain + `withdrawToChain()` via CCTP.
- **FanDrops** — sponsor-funded fan drops. `createDrop()` escrows `perWinnerAmount * maxWinners` USDC (`SPONSOR_ROLE`). Agent whitelists wallets (`AGENT_ROLE`). Fans claim when oracle events match (`eventType` + minute range): `claim()`, `claimToChain()` (CCTP), `claimForToChain()` (agent-pushed). `cancelDrop()` refunds unspent.
- **MockUSDC** — 6-decimal mintable USDC for local/testnet dev.

## Premium analytics pipeline

The premium product is a **probabilistic match-preview engine** that lets the AI
agent analyze possible outcomes of upcoming (and live) matches. All computation
lives in `feeder/src/analytics.ts`; the x402 endpoint is a paywall + on-chain
settlement wrapper that proxies to the feeder's `/premium-stats/:id` route.

### Data inputs (layered, with provenance)

1. **Elo prior** (`analytics.ts`) — an Elo-style team-strength prior (~50 national
   teams rated). Always available, no API key. This is what makes upcoming-match
   prediction work *before any World Cup games are played*.
2. **api-football history** (`feeder/src/providers/apiFootballHistory.ts`) — real
   time-decayed attack/defence rates per team, pulled from each team's historical
   matches (qualifiers, friendlies, prior tournaments) across allowed seasons
   (2023–2024 on the free plan). Free-plan-safe: cached 24h, daily budget cap
   (default 60 req/day), never throws (falls back to Elo). Dominates the blend as
   the sample grows.
3. **World-Cup form** — last-5 intra-tournament results per team; scales from a
   light fine-tune early in the tournament up to 85% weight    once both sides have >=5 finished WC games, so current-tournament performance dominates the
    prediction in the knockout rounds (it's the most relevant signal: recency +
    same competition + same roster), but the ~30% long-term anchor provides a
    safety net against a single fluke result (e.g. a rotated lineup in a dead-rubber game).
4. **Head-to-head** — finished fixtures between the two teams; folded into the
   rating balance as a nudge and surfaced in the narrative.
5. **Oracle events** — the goal timeline is taken from on-chain
   `CupEventOracle.getEvents()` when configured (oracle-verified provenance),
   falling back to provider events.

### Model

A **Poisson / Dixon-Coles** model converts the blended goal rates (λ_home,
λ_away) into a full 9×9 scoreline distribution, with the Dixon-Coles
low-score dependency correction. From that:

- `probabilities`: calibrated P(home win) / P(draw) / P(away win).
- `scorelines`: top 5 most-likely scorelines with probabilities.
- `expectedGoals`: the model's λ for each side (= xG).
- `prediction`: winner + confidence, **derived from** the probabilities (not a
  separate ruleset).

For **LIVE** matches, the same model is applied to *remaining time*, conditioned
on the current scoreline, using the real match minute (`Fixture.liveMinute`,
populated from the provider's `time_elapsed`). This yields live win
probabilities that update as the match progresses.

### Agent interpretation

The model does inference; the LLM does interpretation. The agent system prompt
instructs the LLM to lead with the three-way odds, the likeliest scoreline(s),
expected goals, and to cite `model.dataCoverage` so the user knows the basis.
If the only input is the Elo prior (no history, no WC form), the agent says
confidence is lower and the prediction is prior-based.

### Provenance

Every payload includes a `model` block: `type`, `inputs[]`, `dataCoverage`
listing what drove the prediction (e.g. "elo-prior + api-football-history (14
Argentina, 20 France)"). Shots/possession are model-estimated (the free provider
does not supply them) and labelled as such rather than presented as measured.
