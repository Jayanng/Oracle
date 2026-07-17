# Coding Agent Prompt — Migrate CupEvent Oracle from Staking to Drops + Marketplace

You are updating an in-progress hackathon project called **CupEvent Oracle** (Injective Global Cup, HackQuest, deadline 2026-07-19). The base architecture is documented in `BUILD_GUIDE.md`. This prompt supersedes the parts of that guide dealing with prediction-market staking. Do **not** touch anything else unless this document says to.

## Context you must load first

Before editing anything, read these files if they exist:

- `BUILD_GUIDE.md` — full-project reference
- `contracts/src/CupEventOracle.sol` — keep as-is
- `contracts/src/CupRewards.sol` — you will **delete** this
- `agent/src/tools.ts` — you will edit
- `agent/src/chat.ts` — you will edit
- `agent/src/server.ts` — you will edit
- `frontend/src/app/rewards/page.tsx` — you will rename and rewrite
- `x402-endpoint/src/index.ts` — you will edit (metering + treasury settlement)
- `.env.example` — you will add new keys

If any of those files don't exist yet, create them per `BUILD_GUIDE.md` and then apply the changes below.

---

## What is changing and why

The old design had users **staking USDC** on match outcomes and claiming winnings after settlement. We are removing all user staking. Replacing it with two flows:

1. **Sponsor-funded fan drops** — a funder pre-loads USDC into a pool; the agent pays out to eligible fans when oracle events fire. Users risk nothing. Payouts can go cross-chain via CCTP.
2. **Oracle data marketplace** — every premium query into the oracle is metered via x402. Fees accumulate in a treasury. Whoever runs feeders earns a pro-rata share and withdraws cross-chain via CCTP.

This is a stronger fit for the hackathon because:
- Zero user risk / no regulatory grey zone.
- x402 has real recurring usage (every query), not a one-off.
- CCTP is native to both flows, not bolted on.
- Creates a self-sustaining oracle economy — reusable infrastructure post-World-Cup.

---

## Task list (do in this order)

### Task 1 — Delete the old rewards contract

- Delete `contracts/src/CupRewards.sol`.
- Delete `contracts/test/Rewards.t.sol` if it exists.
- Remove any reference to `CupRewards` from `contracts/script/Deploy.s.sol`.

Do **not** delete `CupEventOracle.sol`. It stays exactly as-is.

### Task 2 — Create `FanDrops.sol`

Create `contracts/src/FanDrops.sol` with the following behaviour:

- Uses OpenZeppelin `AccessControl` and `SafeERC20`.
- Roles: `DEFAULT_ADMIN_ROLE`, `SPONSOR_ROLE` (can create drops), `AGENT_ROLE` (can whitelist winners and trigger payouts).
- References the oracle at a constructor-supplied address.
- Holds USDC (constructor-supplied address).

**Data model:**

```solidity
struct Drop {
    uint256 matchId;
    string  eventType;      // e.g. "goal", "final", "halftime"
    uint32  minuteFrom;     // inclusive
    uint32  minuteTo;       // inclusive; 0xFFFFFFFF for open-ended
    uint256 perWinnerAmount;  // in USDC 6dp
    uint32  maxWinners;
    uint32  claimedCount;
    uint256 funded;         // total USDC deposited for this drop
    address sponsor;
    bool    active;
}

mapping(uint256 => Drop) public drops;
mapping(uint256 => mapping(address => bool)) public eligible;   // dropId => wallet => eligible
mapping(uint256 => mapping(address => bool)) public claimed;    // dropId => wallet => claimed
uint256 public nextDropId;
```

**Functions:**

- `createDrop(matchId, eventType, minuteFrom, minuteTo, perWinnerAmount, maxWinners) returns (uint256 dropId)` — SPONSOR_ROLE only. Pulls `perWinnerAmount * maxWinners` USDC from sponsor via `safeTransferFrom`. Emits `DropCreated`.
- `whitelist(dropId, wallets[])` — AGENT_ROLE only. Marks wallets eligible. Reverts if `claimedCount + len(wallets) > maxWinners`.
- `claim(dropId)` — anyone. Checks: drop.active, eligible[msg.sender], !claimed[msg.sender], oracle has at least one event matching (matchId, eventType, minute in [minuteFrom, minuteTo]). Marks claimed, transfers `perWinnerAmount` USDC to caller, increments `claimedCount`. If `claimedCount == maxWinners` sets `active = false`. Emits `Claimed`.
- `claimToChain(dropId, destinationDomain, mintRecipient) returns (uint64 nonce)` — same eligibility checks as `claim`, but instead of transferring locally, approves Circle's `TokenMessenger` and calls `depositForBurn(perWinnerAmount, destinationDomain, mintRecipient, usdc)`. Return the CCTP nonce. Emits `ClaimedCrossChain`.
- `cancelDrop(dropId)` — SPONSOR_ROLE or admin. Refunds `(maxWinners - claimedCount) * perWinnerAmount` unspent USDC back to the sponsor. Sets `active = false`.

**Oracle eligibility check helper** (internal view):

```solidity
function _oracleMatches(Drop memory d) internal view returns (bool) {
    ICupEventOracle.Event[] memory arr = oracle.getEvents(d.matchId);
    for (uint256 i = 0; i < arr.length; i++) {
        if (keccak256(bytes(arr[i].eventType)) == keccak256(bytes(d.eventType))
            && arr[i].minute >= d.minuteFrom && arr[i].minute <= d.minuteTo) {
            return true;
        }
    }
    return false;
}
```

You will need to add `getEvents(uint256)` to the interface at the top of the file — it's already on `CupEventOracle`.

**Constructor:** `(address admin, address _usdc, address _oracle, address _tokenMessenger)`.

Write `contracts/test/FanDrops.t.sol` covering:

- Only SPONSOR_ROLE can create a drop.
- Sponsor USDC is escrowed on creation.
- Non-whitelisted wallet cannot claim.
- Whitelisted wallet cannot claim before the matching event exists on the oracle.
- After a matching event is added to the oracle by the FEEDER, whitelisted wallets can claim.
- Wallet cannot claim twice.
- `claimedCount` cannot exceed `maxWinners`.
- `cancelDrop` refunds correctly.
- `claimToChain` performs the USDC approval + `depositForBurn` call (mock the `TokenMessenger` interface).

### Task 3 — Create `OracleTreasury.sol`

Create `contracts/src/OracleTreasury.sol`:

- Uses OpenZeppelin `AccessControl` + `SafeERC20`.
- Roles: `DEFAULT_ADMIN_ROLE`, `X402_SETTLER_ROLE` (address of the x402 endpoint's signer that credits payments), `FEEDER_TRACKER_ROLE` (granted to `CupEventOracle` contract).
- Holds USDC.

**Data model:**

```solidity
uint256 public totalRevenue;           // lifetime USDC ever settled in
uint256 public totalPaidOut;           // lifetime USDC withdrawn by feeders
uint256 public totalEventCount;        // sum of events attributed across all feeders
mapping(address => uint256) public feederEventCount;   // events attributed to feeder
mapping(address => uint256) public feederPaidOut;      // USDC already withdrawn by feeder
```

**Functions:**

- `recordEvent(address feeder)` — FEEDER_TRACKER_ROLE only. `feederEventCount[feeder]++; totalEventCount++;`. Emits `FeederEventRecorded`.
- `recordRevenue(uint256 amount)` — X402_SETTLER_ROLE only. Assumes USDC was already `transferFrom`-ed in by the settler. `totalRevenue += amount`. Emits `RevenueRecorded`.
- `earnedBy(address feeder) view returns (uint256)` — pro-rata claim: `(totalRevenue * feederEventCount[feeder]) / totalEventCount - feederPaidOut[feeder]`. Guard against `totalEventCount == 0`.
- `withdraw(uint256 amount, address to)` — anyone (msg.sender = feeder). Checks `amount <= earnedBy(msg.sender)`. Increments `feederPaidOut[msg.sender]` and `totalPaidOut`. Transfers USDC. Emits `FeederWithdrew`.
- `withdrawToChain(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient) returns (uint64 nonce)` — same checks as `withdraw`, but approves `TokenMessenger` and calls `depositForBurn`. Emits `FeederWithdrewCrossChain`.

**Update `CupEventOracle.sol`** to call `treasury.recordEvent(msg.sender)` at the end of `addEvent(...)`. Give it a settable treasury address (`setTreasury(address)` admin-only) so we can wire it after deploy. If treasury is zero-address, skip the call.

Write `contracts/test/OracleTreasury.t.sol` covering:

- Only oracle can record events.
- Only settler can record revenue.
- Pro-rata math: 2 feeders (60 events / 40 events), 100 USDC revenue → earned(60/40) = 60/40 USDC.
- Withdraw increments paid-out and decrements available.
- Cannot withdraw more than earned.
- `withdrawToChain` approves and burns.

### Task 4 — Update the deployment script

Rewrite `contracts/script/Deploy.s.sol`:

1. Deploy `CupEventOracle(admin)`.
2. Deploy `OracleTreasury(admin, usdc, tokenMessenger)`.
3. Deploy `FanDrops(admin, usdc, address(oracle), tokenMessenger)`.
4. Grant `FEEDER_TRACKER_ROLE` on `OracleTreasury` to `address(oracle)`.
5. Grant `X402_SETTLER_ROLE` on `OracleTreasury` to `X402_SETTLER_ADDRESS` (from env).
6. Call `oracle.setTreasury(address(treasury))`.
7. Print all three addresses.

Update `.env.example`:

```
# add these
TOKEN_MESSENGER_ADDRESS=
X402_SETTLER_ADDRESS=
TREASURY_ADDRESS=
DROPS_ADDRESS=

# remove
# REWARDS_ADDRESS=      <-- delete this line
```

### Task 5 — Rewrite the agent tools

Replace the entire contents of `agent/src/tools.ts` such that the exported `tools` object has these methods (keep the existing `getLatestEvent`, `listEvents`, `getPremiumStats`):

- `getLatestEvent({ matchId })` — unchanged.
- `listEvents({ matchId })` — unchanged.
- `getPremiumStats({ matchId })` — unchanged (x402 flow).
- `createDrop({ matchId, eventType, minuteFrom, minuteTo, perWinnerAmountUsdc, maxWinners })` — writes to `FanDrops.createDrop`. Handles USDC approval to `FanDrops` first if allowance is insufficient. Returns `{ dropId, txHash }`.
- `whitelistDrop({ dropId, wallets })` — writes to `FanDrops.whitelist(dropId, wallets)`. Returns `{ txHash }`.
- `checkDropEligibility({ dropId, wallet })` — reads `drops(dropId)`, `eligible(dropId, wallet)`, `claimed(dropId, wallet)`, and verifies the oracle has a matching event. Returns `{ eligible: bool, alreadyClaimed: bool, oracleReady: bool }`.
- `payDrop({ dropId, wallet, destinationDomain? })` — the agent triggers a payout on behalf of a whitelisted wallet. Call path:
  - If `destinationDomain` is undefined or matches Injective's domain: nothing to do (the wallet must call `claim` themselves — we cannot claim for them because `claim` uses `msg.sender`). Instead, return a signed EIP-712 payload the frontend can execute, OR: change `FanDrops.claim` to accept `claim(dropId, recipient)` where AGENT_ROLE can push directly. **Prefer the second** — simpler for the agent. Update `FanDrops.sol` accordingly: add `claimFor(dropId, recipient)` and `claimForToChain(dropId, recipient, destinationDomain, mintRecipient)` gated on AGENT_ROLE.
- `feederEarnings({ feeder })` — reads `OracleTreasury.earnedBy(feeder)` and `feederEventCount(feeder)`. Returns `{ earnedUsdc, eventCount, totalPaid }`.
- `withdrawFeederEarnings({ amount, destinationDomain? })` — if same-chain, calls `OracleTreasury.withdraw`. If cross-chain, calls `withdrawToChain`. Returns `{ txHash, cctpNonce? }`.

All contract writes should use `viem` `writeContract` with the agent's wallet client that already exists in `tools.ts`. All reads use `readContract` on the public client.

For the `TOKEN_MESSENGER_ABI` and CCTP wiring inside the tools, only expose it via the treasury / FanDrops contracts — the agent should not call `TokenMessenger` directly. All CCTP burns are proxied through our contracts.

### Task 6 — Update the MCP server tool registrations

In `agent/src/server.ts`, replace the tool list. Remove the old `settle_match` tool. Add:

- `create_drop`
- `whitelist_drop`
- `check_drop_eligibility`
- `pay_drop`
- `feeder_earnings`
- `withdraw_feeder_earnings`

Each entry needs:
- `name`
- `description` (one line, agent-consumable — see examples below)
- `inputSchema` matching the tool arg shape

Descriptions must be prescriptive and unambiguous. Example:

```
{ name: 'create_drop',
  description: 'Create a sponsor-funded fan drop. Sponsor must have approved USDC to the FanDrops contract. Returns dropId.',
  inputSchema: {
    type: 'object',
    properties: {
      matchId: { type: 'number' },
      eventType: { type: 'string', enum: ['goal','card','sub','halftime','final'] },
      minuteFrom: { type: 'number' },
      minuteTo: { type: 'number' },
      perWinnerAmountUsdc: { type: 'string', description: 'USDC amount as decimal string, e.g. "0.5"' },
      maxWinners: { type: 'number' }
    },
    required: ['matchId','eventType','minuteFrom','minuteTo','perWinnerAmountUsdc','maxWinners']
  }
}
```

Update the `schemas` zod object in the same file to match.

### Task 7 — Update the chat orchestrator

In `agent/src/chat.ts`:

- Update the `toolSchema` array to match the new tool set.
- Update the system prompt to describe the new capabilities:

```
You are CupAgent. You have four categories of tools:
1) READ oracle events (get_latest_event, list_events).
2) BUY premium analytics from a paywalled endpoint via x402 (get_premium_stats).
3) MANAGE fan drops sponsored by brands (create_drop, whitelist_drop, check_drop_eligibility, pay_drop).
4) MANAGE feeder earnings from the oracle data marketplace (feeder_earnings, withdraw_feeder_earnings).

Never invent match IDs — always ask the user or use list_events to discover them. When paying drops or withdrawing earnings, ask the user which destination chain they want (Injective same-chain, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, or Avalanche Fuji). If they don't specify, default to same-chain.
```

- Keep the tool-call loop, trace log, and 5-step max unchanged.

### Task 8 — Update the x402 endpoint

In `x402-endpoint/src/index.ts`:

1. On successful payment verification, **actually settle** the payment on-chain instead of just recording it in memory:
   - The endpoint's signer has been granted `X402_SETTLER_ROLE` on `OracleTreasury`.
   - After verifying the signed payment header, the endpoint must:
     - Do a `USDC.transferFrom(payer, treasury, amount)` — this requires the payer (the agent) to have pre-approved USDC to the endpoint's signer address, OR to have pre-approved to the treasury and the endpoint calls a helper on the treasury. **Simpler path:** have the agent pre-approve USDC to the treasury once at startup, and the endpoint calls `treasury.pullPayment(payer, amount)` — add this function to the treasury (X402_SETTLER_ROLE only, does the transferFrom internally and calls `recordRevenue`).
   - Then call `treasury.recordRevenue(amount)`.
2. If the on-chain settlement fails, return a 402 error to the caller — do not deliver the data.
3. Keep the nonce-replay protection.
4. Add a `GET /health` endpoint returning `{ ok: true, revenueUsdc: <total> }`.

Also expose new premium endpoints that meter separately (each with its own `amount` in the 402 response):

- `GET /premium-stats?matchId=…` — 0.10 USDC (existing).
- `GET /historical-events?matchId=…&from=…&to=…` — 0.25 USDC.
- `GET /webhooks/subscribe?matchId=…&url=…` — 1.00 USDC (returns a subscription ID; stubbed webhook impl is fine for demo).

### Task 9 — Update the feeder

In `feeder/src/index.ts` no code change is strictly needed — the treasury gets notified automatically via `oracle.addEvent → treasury.recordEvent`. But add:

- A startup log line printing `feederEarnings` from the treasury so you can visually confirm on demo day.
- A `--simulator` CLI flag (if not already present) and a JSON file `feeder/scripts/canned.json` with the 4-event canned sequence. Ship both real and simulator modes.

### Task 10 — Frontend: rename Rewards → Drops

- Rename directory: `frontend/src/app/rewards/` → `frontend/src/app/drops/`.
- Update all navbar links (`src/app/layout.tsx` or wherever the nav lives): `Rewards` → `Drops`.
- Update landing-page copy references (`page.tsx`) from "prediction market" / "stake" language to "sponsor-funded drops" and "oracle data marketplace."

### Task 11 — Rewrite `/drops` page

Delete the old rewards page contents. Build the new page with three tabs (use shadcn `Tabs`):

**Tab 1: Active Drops**
- Grid of cards, one per active drop.
- Each card: sponsor address (or ENS/label), match teams, trigger criteria (event + minute window), per-winner amount, progress bar `claimedCount/maxWinners`, "Check eligibility" button, "Claim" button.
- Eligibility button calls the agent's `check_drop_eligibility` tool via `POST /chat` or a new direct `POST /tool/check_drop_eligibility` on the agent server.
- Claim button opens a modal with:
  - Destination chain radio group: Injective (same-chain), Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, Avalanche Fuji.
  - "Claim" button: same-chain → user calls `FanDrops.claim(dropId)` directly with wagmi. Cross-chain → user calls `FanDrops.claimToChain(dropId, destinationDomain, mintRecipient)`.
  - If cross-chain, show the same 4-step CCTP progress stepper described in `BUILD_GUIDE.md` §9.2 (Approval → Burn → Attestation → Mint on destination).

**Tab 2: Sponsor a Drop**
- Form: match dropdown (populated from `oracle.allMatchIds`), event-type dropdown, minute range slider, per-winner amount, max winners, computed total cost.
- "Approve USDC" button, then "Create Drop" button. Both are wagmi `useWriteContract`.
- Alternative: "Ask the agent to create this drop" — sends a natural-language prompt to `/chat` that the agent turns into a `create_drop` tool call. Show this alongside the direct button so judges see both paths.
- After creation, show a share link and a "Whitelist wallets" panel where the sponsor pastes a newline-separated list and the agent calls `whitelist_drop`.

**Tab 3: Feeder Earnings**
- Only visible/populated if the connected wallet has `feederEventCount > 0`.
- Cards: Events submitted · Earned to date · Available to withdraw · Total withdrawn.
- "Withdraw" button with chain picker (same options as Tab 1 Claim modal). Calls `OracleTreasury.withdraw` or `withdrawToChain`.
- Below: leaderboard of top feeders by event count (read `feederEventCount` for each address in `allFeeders` — you'll need to track feeders as they submit; simplest is to index the `FeederEventRecorded` events client-side with `viem`'s `getContractEvents`).

### Task 12 — Frontend: update landing page

In `frontend/src/app/page.tsx`:

- Change the `<Features />` grid from 4 features to 4 features that reflect the new model:
  1. **Live Event Oracle** — unchanged.
  2. **Sponsor-funded Fan Drops** — brand pools, zero user risk, cross-chain payouts via CCTP.
  3. **Autonomous x402 Data Marketplace** — every premium query is paid; agents transact machine-to-machine.
  4. **Self-sustaining Feeder Economy** — feeders earn x402 revenue, withdraw cross-chain via CCTP.

- In the `<HowItWorks />` section, rewrite the 3 steps:
  1. Feeders push live match events on-chain.
  2. Agents (or dApps) query events; premium queries pay via x402 into a treasury.
  3. Sponsors fund drops; fans claim free rewards to any supported chain via CCTP; feeders withdraw their share of treasury revenue the same way.

- Remove any language about staking, betting, or prediction markets from the landing page.

### Task 13 — Frontend: update Agent page prompt chips

In `frontend/src/app/agent/page.tsx`, replace the `<PromptChips />` example prompts with:

- "What was the latest event in match 12345?"
- "Get premium stats for match 12345"
- "Create a drop: 0.5 USDC each to the first 20 wallets when Argentina scores"
- "How much have I earned as a feeder?"
- "Pay out drop #3 to eligible wallets, cross-chain to Base"

### Task 14 — Update README and docs

Update `README.md`:

- Rewrite the "Why this exists" section to describe the drops + marketplace model.
- Update the tech-integration table:

| Tech | Where |
|------|-------|
| MCP Server  | `agent/src/server.ts` — 8 tools registered |
| x402        | `x402-endpoint/` metered endpoints; `agent/src/tools.ts:getPremiumStats`; on-chain settlement via `OracleTreasury.pullPayment` |
| CCTP        | `FanDrops.claimToChain`, `OracleTreasury.withdrawToChain`, `frontend/src/app/drops/**` |
| Agent Skills| Tool schemas + system prompt in `agent/src/chat.ts` |

- Update the "Roadmap" section: keep decentralised feeders, but frame them in terms of the marketplace model.
- Update the demo-video description and the X post template so both no longer mention staking.

### Task 15 — Update the acceptance script

Replace §10 of `BUILD_GUIDE.md` (E2E Testing) locally in a `docs/acceptance.md` file with the new flow:

1. Deploy contracts. Confirm oracle, treasury, drops addresses printed.
2. Verify `oracle.treasury() == treasury.address` and treasury has `FEEDER_TRACKER_ROLE` granted to oracle.
3. Start feeder (simulator). Confirm events land on-chain within 20s and `feederEventCount` increments.
4. Start x402 endpoint. Confirm agent can call `get_premium_stats` and treasury's `totalRevenue` increases.
5. From the agent chat: "Create a drop: 0.5 USDC each to the first 5 wallets when the halftime event fires on match X." — confirm on-chain drop created and USDC escrowed.
6. Whitelist 3 wallets via `whitelist_drop`.
7. Trigger the halftime event via the simulator.
8. Each whitelisted wallet can call `claim(dropId)` on the frontend and receive USDC on Injective.
9. A separate whitelisted wallet uses `claimToChain` targeting Ethereum Sepolia. Verify 4-step stepper completes and destination USDC lands.
10. Feeder wallet views its earnings on `/drops` Tab 3. Withdraws same-chain — balance increases. Withdraws cross-chain — CCTP fires end-to-end.
11. Refresh every page. All state loads from chain.

Everything in this list must pass before you consider the migration complete.

---

## Constraints and non-negotiables

- **Do not touch `CupEventOracle.sol` beyond adding `setTreasury` and the treasury notification hook in `addEvent`.**
- **Do not introduce user staking anywhere.** No `stake`, `bet`, `wager`, `prediction` functions. Users only ever *receive* USDC in this project, never send it into a wager pool.
- **All CCTP burns route through our contracts** (`FanDrops.claimToChain`, `OracleTreasury.withdrawToChain`). The frontend never calls `TokenMessenger` directly. This keeps CCTP integration testable and auditable in one place.
- **Every new external function must have at least one Foundry test.** No exceptions.
- **Keep the risk register in `BUILD_GUIDE.md` §15 accurate.** If you introduce a new risk (e.g. "agent needs to pre-approve USDC to treasury"), add it there with a mitigation.
- **Do not remove the simulator feeder path.** Live-match reliability is a demo-day risk.

## Definition of done

- [ ] `forge test` green on all contracts (old and new).
- [ ] Local run: feeder, x402 endpoint, agent chat, frontend all start with no errors.
- [ ] All 11 acceptance steps in Task 15 pass end-to-end at least once.
- [ ] README updated; no stale references to staking, prediction markets, or `CupRewards`.
- [ ] `.env.example` includes the new keys and none of the deleted ones.
- [ ] `BUILD_GUIDE.md` §14 (Judging Rubric) tech-integration column reflects the new file paths.
- [ ] A single commit or PR summarises: contracts changed, files added, files removed, .env keys added/removed.

When you're done, print a short report:

```
Migration complete.
Deleted:  <files>
Added:    <files>
Modified: <files>
Contracts on testnet:
  Oracle:   0x...
  Treasury: 0x...
  Drops:    0x...
Acceptance: 11/11 passed.
```

If any step fails or is ambiguous, **stop and ask** before working around it. Do not silently skip anything.
