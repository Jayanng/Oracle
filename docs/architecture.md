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
      (6 pages)        (LLM + 9 tools)    |- sponsor drops (escrow)
            |                 |            |- whitelist wallets
            |                 |            |- claim (same-chain)
            |                 |            |- claimToChain (CCTP)
            |                 |
            |  /x402: FAN wallet pays x402 (EIP-3009, browser)
            |  -> success modal (tx + whitelist) -> auto-whitelist
            |     (agent auto-CREATES a drop if none exists for the match)
            |                 v
            |          x402 paywalled endpoints  :4021
            |          (@injectivelabs/x402 middleware, settlementPolicy: before)
            |          /premium-stats  /historical-events  /webhooks
            |                 |
            |                 v   (after x402 settlement into OracleTreasury)
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
| **x402** | `x402-endpoint/` — 3 metered endpoints (`/premium-stats` 0.10 USDC, `/historical-events` 0.25 USDC, `/webhooks/subscribe` 1.00 USDC) via the official `@injectivelabs/x402` middleware (EIP-3009, `settlementPolicy: "before"`); settles into `OracleTreasury`. Two payers: **agent** self-pays (`agent/src/tools.ts` retry loop) and **fan browser wallet** pays (`frontend/src/lib/x402.ts`). CORS exposes `PAYMENT-REQUIRED`/`PAYMENT-RESPONSE` so browsers can read the challenge + receipt. |
| **CCTP** | `FanDrops.claimToChain`, `OracleTreasury.withdrawToChain`, `frontend/src/app/drops` — cross-chain USDC burns via `TokenMessengerV2.depositForBurn` (domain 29 = Injective); attestation polled via Circle Iris; mint (`receiveMessage`) on the destination chain (Sepolia / Base / Arbitrum / Avalanche). |
| **Agent Skills** | Tool schemas + system prompt in `agent/src/chat.ts`; LLM = Groq (preferred) or OpenAI, with deterministic regex router fallback |

## Contracts (Solidity 0.8.24, OpenZeppelin AccessControl)

- **CupEventOracle** — append-only event log per matchId; `FEEDER_ROLE`-gated `addEvent()`; opaque `category`/`eventType`/`details`(JSON) strings (category-agnostic). Notifies `OracleTreasury` for feeder attribution.
- **OracleTreasury** — x402 revenue accumulation (`pullPayment`/`recordRevenue`, `X402_SETTLER_ROLE`); per-feeder event counts → pro-rata `earnedBy()`; `withdraw()` same-chain + `withdrawToChain()` via CCTP.
- **FanDrops** — sponsor-funded fan drops. `createDrop()` escrows `perWinnerAmount * maxWinners` USDC (`SPONSOR_ROLE`). Agent whitelists wallets (`AGENT_ROLE`). Fans claim when oracle events match (`eventType` + minute range): `claim()`, `claimToChain()` (CCTP), `claimForToChain()` (agent-pushed). `cancelDrop()` refunds unspent.
- **MockUSDC** — 6-decimal mintable USDC for local/testnet dev.

## Browser x402 payment (fan pays) & auto-whitelist

The `/x402` page lets the **fan's own wallet** pay the paywall directly, matching
the "no human-in-the-loop friction" pitch.

- **Browser EIP-3009 payer** — `frontend/src/lib/x402.ts` (`payPremiumStats`).
  It receives the 402 challenge, signs a `TransferWithAuthorization` (EIP-712)
  with the connected wagmi wallet, and retries with the `PAYMENT-SIGNATURE`
  header. The payload shape, domain (`name: "USDC"`, `version: "2"` for Circle
  FiatTokenV2_2), and header names mirror `@injectivelabs/x402`'s `createPayment`
  exactly (verified against the installed middleware + zod schemas). The
  facilitator submits the transfer on-chain (facilitator pays gas, **fan pays
  USDC**) and returns a settlement receipt in `PAYMENT-RESPONSE`.
- **CORS** — the x402 endpoint (`x402-endpoint/src/index.ts`) exposes
  `PAYMENT-REQUIRED` / `PAYMENT-RESPONSE` / `X-PAYMENT-RESPONSE` and allows
  `PAYMENT-SIGNATURE` / `X-PAYMENT`, so browser `fetch` can read the challenge
  and the settlement tx (otherwise custom headers are hidden cross-origin).
- **Success modal + toasts** — on success the page shows a modal with the amount
  paid, a settlement-tx explorer link, and the whitelist status, plus sonner
  toasts. Errors surface the real reason.
- **Auto-whitelist / auto-create** — after payment the page calls
  `POST /api/whitelist` with `{ matchId, address }`. The agent
  (`agent/src/chat.ts`) resolves `matchId → dropId`; **if no drop exists for the
  match it auto-creates a small sponsor-funded drop** (agent wallet, `goal`
  trigger, `AUTO_DROP_AMOUNT_USDC` × `AUTO_DROP_MAX_WINNERS`), then whitelists
  the payer. This makes the pay → whitelist → claim flow work for **any** match.

## Drops page robustness

- **Dedicated Injective read client** — `frontend/src/app/drops/page.tsx` reads
  drops/eligibility via a fixed Injective RPC client (`injPub`), independent of
  the chain the wallet is currently on. Without this, if MetaMask sat on
  Ethereum/Sepolia (common after a CCTP claim) the reads silently returned
  nothing and no drops showed. Tx receipts still use the wallet client.
- **Always show eligible drops** — the visible-drops filter keeps NS/LIVE
  matches for discovery **plus** any drop the connected wallet is eligible for or
  has already claimed, even if the match is finished (FT). So a drop you just got
  whitelisted for always appears.
- **Reliable RPCs** — the retired `rpc.sepolia.org` (now 404) was replaced with
  public nodes for every CCTP destination; see `CHAIN_CONFIG` in
  `frontend/src/lib/contracts.ts` and `sepoliaRpc` in `frontend/src/lib/wagmi.ts`.

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
