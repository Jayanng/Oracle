# CupEvent Oracle — Full-Stack Build Guide

**Hackathon:** Injective Global Cup (HackQuest) — deadline **July 19, 2026**
**Author brief:** Step-by-step build plan for a coding agent + solo dev to ship a winning submission.
**Scope:** Contracts + Data Feeder + MCP Agent + Next.js frontend (5 pages) + demo video + README + X post.

> ⚠️ **Reality-check before you start:** Several package names your prior research surfaced (e.g. `@injectivelabs/x402`, `InjectiveLabs/solidity-contracts`) are plausible but **not guaranteed to exist as named**. Step 0 of this guide is a verification phase — do it first so your agent doesn't waste hours chasing dead imports. The build plan below is written to survive if some of those names turn out to be slightly different; wherever there's risk, I've written a fallback.

---

## Table of Contents

1. [Project Thesis (60-second pitch)](#1-project-thesis)
2. [Architecture Overview](#2-architecture-overview)
3. [Step 0 — Verification Phase (do first, ~1 hour)](#3-step-0--verification-phase)
4. [Step 1 — Repo Scaffold](#4-step-1--repo-scaffold)
5. [Step 2 — Smart Contracts](#5-step-2--smart-contracts)
6. [Step 3 — Data Feeder](#6-step-3--data-feeder)
7. [Step 4 — MCP Agent](#7-step-4--mcp-agent)
8. [Step 5 — Frontend (5 pages)](#8-step-5--frontend)
9. [Step 6 — x402 & CCTP Integration](#9-step-6--x402--cctp-integration)
10. [Step 7 — End-to-end Testing](#10-step-7--e2e-testing)
11. [Step 8 — Deployment](#11-step-8--deployment)
12. [Step 9 — Demo Video, README, X Post](#12-step-9--demo-video-readme-x-post)
13. [Day-by-Day Timeline (4 days)](#13-day-by-day-timeline)
14. [Judging Rubric Mapping](#14-judging-rubric-mapping)
15. [Risk Register & Fallbacks](#15-risk-register)

---

## 1. Project Thesis

**Name:** CupEvent Oracle
**One-liner:** The missing real-world event oracle for Injective — brings live World Cup match events on-chain, exposed through an MCP-powered natural-language AI agent that autonomously pays for data via x402 and distributes cross-chain rewards via CCTP.

**Why it wins (elevator version):**
- Fills a **real ecosystem gap** — Injective has price oracles (Pyth, Chainlink Data Streams) but no general event oracle.
- **Reusable infrastructure**, not a one-off dApp. Post-WC it becomes a generic event oracle (EPL, NFL, Olympics, elections, esports).
- **Meaningfully uses all four required technologies** (MCP, x402, CCTP, Agent Skills) — not shoehorned.
- **Perfect timing** — live during the actual World Cup finals window.
- **Demo-friendly** — natural-language chat produces on-chain effects in real time.

---

## 2. Architecture Overview

```
                       ┌───────────────────────────────┐
                       │       Live Sports API         │
                       │  (api-football / sportsdb)    │
                       └───────────────┬───────────────┘
                                       │ pull every 30–60s
                                       ▼
                       ┌───────────────────────────────┐
                       │        Data Feeder            │
                       │  (Node/TS, PM2, one address)  │
                       └───────────────┬───────────────┘
                                       │ addEvent()
                                       ▼
┌────────────────┐          ┌───────────────────────────────┐
│  Other dApps   │◄────────►│  CupEventOracle.sol (Injective│
│  / builders    │  read    │  EVM testnet)                 │
└────────────────┘          └───────────────┬───────────────┘
                                            │ events / reads
                          ┌─────────────────┼─────────────────┐
                          ▼                 ▼                 ▼
                 ┌────────────────┐  ┌──────────────┐  ┌──────────────┐
                 │  Next.js UI    │  │  MCP Agent   │  │ Rewards.sol  │
                 │  (5 pages)     │◄─┤ (LLM + tools)├─►│ + CCTP send  │
                 └────────────────┘  └──────┬───────┘  └──────────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │  x402 paywalled  │
                                   │  data endpoint   │
                                   └──────────────────┘
```

**Directory layout:**

```
cup-event-oracle/
├── contracts/          # Foundry
├── feeder/             # Node/TS off-chain service
├── agent/              # MCP server + tools + LLM glue
├── frontend/           # Next.js 14 app router
├── x402-endpoint/      # Tiny Express server the agent pays
├── docs/               # architecture.md, diagrams
├── .github/workflows/  # optional CI
└── README.md
```

---

## 3. Step 0 — Verification Phase

**Do this before writing any code.** ~1 hour. Saves days.

### 0.1 Confirm hackathon requirements
- [ ] Reopen the HackQuest Injective Global Cup page and confirm submission form fields (Typeform link).
- [ ] Note the exact X hashtag + partner accounts to tag.
- [ ] Confirm current judging rubric (usefulness, execution, docs, tech integration, usability).

### 0.2 Verify Injective tech packages actually exist
Run these checks (agent should do this, not assume):

```bash
# On npm
npm view @injectivelabs/sdk-ts version
npm view @injectivelabs/x402 version         # ⚠️ may not exist under this name
npm view x402                                # official x402 reference impl (Coinbase-led standard)
npm view @modelcontextprotocol/sdk version   # official MCP SDK

# On GitHub — verify these repos exist and check their READMEs
# - github.com/InjectiveLabs/injective-mcp (or similar) — MCP server for Injective
# - github.com/InjectiveLabs/injective-ts   — TS SDK monorepo
# - github.com/circlefin/evm-cctp-contracts — CCTP contracts
```

**If `@injectivelabs/x402` does not exist:** use the generic `x402` reference package + Injective RPC. The x402 spec is HTTP-402-based and chain-agnostic; you attach payment on any EVM chain.

**If Injective's official MCP server has a different name:** search `InjectiveLabs` on GitHub for repos containing "mcp". Fall back to building your own MCP server with `@modelcontextprotocol/sdk` — tools you register just call viem against Injective EVM RPC. This is a 100-line file; not a blocker.

### 0.3 Get Injective EVM testnet essentials
- [ ] Testnet RPC URL (docs.injective.network → EVM section)
- [ ] Chain ID (Injective EVM testnet)
- [ ] Testnet INJ from faucet
- [ ] Testnet USDC (via Circle CCTP testnet faucet or bridge)
- [ ] Block explorer URL

### 0.4 Get a sports data API key
Recommended (free tier):
- **api-football.com** (RapidAPI) — 100 req/day free, has 2026 WC fixtures
- **thesportsdb.com** — free, less structured
- **sportmonks.com** — trial

Get the key, save match IDs for finals-window fixtures.

### 0.5 Get an LLM key for the agent
- OpenAI `gpt-4o-mini` (cheap, fast) or Anthropic Claude Haiku — either works with MCP.

**Deliverable of Step 0:** a `docs/verification.md` file listing every confirmed package name, URL, endpoint, chain ID, and key you'll use. Everything downstream references this doc.

---

## 4. Step 1 — Repo Scaffold

```bash
mkdir cup-event-oracle && cd cup-event-oracle
git init
npm init -y
# create workspaces
mkdir contracts feeder agent frontend x402-endpoint docs
```

Root `package.json` (workspaces):

```json
{
  "name": "cup-event-oracle",
  "private": true,
  "workspaces": ["feeder", "agent", "frontend", "x402-endpoint"],
  "scripts": {
    "dev:feeder": "npm --workspace feeder run dev",
    "dev:agent":  "npm --workspace agent run dev",
    "dev:web":    "npm --workspace frontend run dev",
    "dev:x402":   "npm --workspace x402-endpoint run dev"
  }
}
```

Create a shared `.env.example` at the root; each workspace has its own `.env` that reads from it.

```
# Injective EVM testnet
INJ_EVM_RPC=
INJ_EVM_CHAIN_ID=
INJ_EVM_EXPLORER=

# Signers (testnet only — never commit real keys)
DEPLOYER_PRIVATE_KEY=
FEEDER_PRIVATE_KEY=
AGENT_PRIVATE_KEY=

# Contracts (filled after deploy)
ORACLE_ADDRESS=
REWARDS_ADDRESS=

# Data
SPORTS_API_KEY=
SPORTS_API_BASE=https://v3.football.api-sports.io

# LLM
OPENAI_API_KEY=

# x402
X402_ENDPOINT_URL=http://localhost:4021/premium-stats
X402_RECEIVER_ADDRESS=

# Circle CCTP (testnet)
CCTP_TOKEN_MESSENGER=
CCTP_MESSAGE_TRANSMITTER=
USDC_TESTNET_ADDRESS=
```

Commit an empty scaffold + `.gitignore` (node_modules, .env, out/, cache/, .next/).

---

## 5. Step 2 — Smart Contracts

### 5.1 Install Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
cd contracts
forge init --no-git --force
forge install OpenZeppelin/openzeppelin-contracts --no-commit
```

### 5.2 `foundry.toml`

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.24"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
injective_testnet = "${INJ_EVM_RPC}"

[etherscan]
# Injective testnet block explorer verification (fill after Step 0.3)
```

### 5.3 `src/CupEventOracle.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title CupEventOracle — generic real-world event oracle
/// @notice Events are opaque strings so this contract can serve football,
///         tennis, esports, elections, etc. Categorisation happens off-chain.
contract CupEventOracle is AccessControl {
    bytes32 public constant FEEDER_ROLE = keccak256("FEEDER_ROLE");

    struct Event {
        uint256 matchId;
        uint64  timestamp;   // unix seconds
        uint32  minute;      // in-match clock; 0 if N/A
        string  category;    // "football", "tennis", ...
        string  eventType;   // "goal", "card", "sub", "final", ...
        string  details;     // JSON blob, opaque
        address updater;
    }

    // matchId => events (append-only)
    mapping(uint256 => Event[]) private _events;
    // matchId => registered? (helps enumeration)
    mapping(uint256 => bool)    public knownMatch;
    uint256[] public matchIds;

    event EventAdded(
        uint256 indexed matchId,
        uint256 indexed index,
        string  category,
        string  eventType,
        uint64  timestamp
    );

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FEEDER_ROLE, admin);
    }

    function addEvent(
        uint256 matchId,
        uint32  minute,
        string calldata category,
        string calldata eventType,
        string calldata details
    ) external onlyRole(FEEDER_ROLE) returns (uint256 index) {
        if (!knownMatch[matchId]) {
            knownMatch[matchId] = true;
            matchIds.push(matchId);
        }
        Event memory e = Event({
            matchId:   matchId,
            timestamp: uint64(block.timestamp),
            minute:    minute,
            category:  category,
            eventType: eventType,
            details:   details,
            updater:   msg.sender
        });
        _events[matchId].push(e);
        index = _events[matchId].length - 1;
        emit EventAdded(matchId, index, category, eventType, e.timestamp);
    }

    function getEvents(uint256 matchId) external view returns (Event[] memory) {
        return _events[matchId];
    }

    function getLatestEvent(uint256 matchId) external view returns (Event memory) {
        Event[] storage arr = _events[matchId];
        require(arr.length > 0, "no events");
        return arr[arr.length - 1];
    }

    function eventCount(uint256 matchId) external view returns (uint256) {
        return _events[matchId].length;
    }

    function allMatchIds() external view returns (uint256[] memory) {
        return matchIds;
    }
}
```

### 5.4 `src/CupRewards.sol`

Prediction-market-lite: users stake before a match, correct predictors share the pool. Payout is triggered by the oracle detecting a `"final"` event.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface ICupEventOracle {
    struct Event {
        uint256 matchId; uint64 timestamp; uint32 minute;
        string category; string eventType; string details; address updater;
    }
    function getLatestEvent(uint256) external view returns (Event memory);
}

contract CupRewards is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");

    enum Outcome { UNSET, HOME, DRAW, AWAY }

    struct Market {
        uint256 matchId;
        uint64  closesAt;
        Outcome resolved;
        uint256 totalHome;
        uint256 totalDraw;
        uint256 totalAway;
        bool    settled;
    }

    IERC20 public immutable usdc;
    ICupEventOracle public immutable oracle;
    mapping(uint256 => Market) public markets;
    // matchId => user => (home, draw, away)
    mapping(uint256 => mapping(address => uint256[3])) public stakes;

    event MarketOpened(uint256 indexed matchId, uint64 closesAt);
    event Staked(uint256 indexed matchId, address indexed user, Outcome pick, uint256 amount);
    event Settled(uint256 indexed matchId, Outcome outcome);
    event Claimed(uint256 indexed matchId, address indexed user, uint256 payout);

    constructor(address admin, address _usdc, address _oracle) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SETTLER_ROLE, admin);
        usdc   = IERC20(_usdc);
        oracle = ICupEventOracle(_oracle);
    }

    function openMarket(uint256 matchId, uint64 closesAt) external onlyRole(SETTLER_ROLE) {
        require(markets[matchId].closesAt == 0, "exists");
        markets[matchId] = Market(matchId, closesAt, Outcome.UNSET, 0, 0, 0, false);
        emit MarketOpened(matchId, closesAt);
    }

    function stake(uint256 matchId, Outcome pick, uint256 amount) external {
        Market storage m = markets[matchId];
        require(m.closesAt > 0 && block.timestamp < m.closesAt, "closed");
        require(pick == Outcome.HOME || pick == Outcome.DRAW || pick == Outcome.AWAY, "bad pick");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        stakes[matchId][msg.sender][uint256(pick) - 1] += amount;
        if (pick == Outcome.HOME) m.totalHome += amount;
        else if (pick == Outcome.DRAW) m.totalDraw += amount;
        else m.totalAway += amount;
        emit Staked(matchId, msg.sender, pick, amount);
    }

    /// @notice Anyone can call this once oracle has posted a "final" event.
    function settle(uint256 matchId) external {
        Market storage m = markets[matchId];
        require(!m.settled, "done");
        ICupEventOracle.Event memory e = oracle.getLatestEvent(matchId);
        require(keccak256(bytes(e.eventType)) == keccak256("final"), "not final");
        // details JSON expected: {"home":X,"away":Y}
        Outcome o = _parseOutcome(e.details);
        m.resolved = o;
        m.settled  = true;
        emit Settled(matchId, o);
    }

    function claim(uint256 matchId) external {
        Market storage m = markets[matchId];
        require(m.settled, "unsettled");
        uint256[3] storage s = stakes[matchId][msg.sender];
        uint256 idx = uint256(m.resolved) - 1;
        uint256 mine = s[idx];
        require(mine > 0, "nothing");
        s[idx] = 0;
        uint256 winnerPool = _pool(m, m.resolved);
        uint256 totalPool  = m.totalHome + m.totalDraw + m.totalAway;
        uint256 payout     = (mine * totalPool) / winnerPool;
        usdc.safeTransfer(msg.sender, payout);
        emit Claimed(matchId, msg.sender, payout);
    }

    function _pool(Market storage m, Outcome o) internal view returns (uint256) {
        if (o == Outcome.HOME) return m.totalHome;
        if (o == Outcome.DRAW) return m.totalDraw;
        return m.totalAway;
    }

    /// @dev Minimal JSON parse: expects `"home":N,"away":M`.
    function _parseOutcome(string memory j) internal pure returns (Outcome) {
        bytes memory b = bytes(j);
        (uint256 h, uint256 a) = (0, 0);
        bool found;
        // find "home":N
        for (uint256 i = 0; i + 7 < b.length; i++) {
            if (b[i]=='"' && b[i+1]=='h' && b[i+2]=='o' && b[i+3]=='m' && b[i+4]=='e' && b[i+5]=='"' && b[i+6]==':') {
                (h, ) = _readNum(b, i+7); found = true; break;
            }
        }
        require(found, "bad json"); found = false;
        for (uint256 i = 0; i + 7 < b.length; i++) {
            if (b[i]=='"' && b[i+1]=='a' && b[i+2]=='w' && b[i+3]=='a' && b[i+4]=='y' && b[i+5]=='"' && b[i+6]==':') {
                (a, ) = _readNum(b, i+7); found = true; break;
            }
        }
        require(found, "bad json");
        if (h > a) return Outcome.HOME;
        if (h < a) return Outcome.AWAY;
        return Outcome.DRAW;
    }

    function _readNum(bytes memory b, uint256 start) internal pure returns (uint256 n, uint256 end) {
        for (uint256 i = start; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c < 48 || c > 57) { return (n, i); }
            n = n * 10 + (c - 48);
        }
        return (n, b.length);
    }
}
```

> Note: on-chain JSON parsing is deliberately minimal and brittle. If you don't want the risk, replace `settle()` with an admin-called `settleWithOutcome(matchId, outcome)` and let the feeder or agent pass the parsed outcome as an argument. **Simpler = more likely to work under demo pressure.** Ship the simpler version if you have any doubt.

### 5.5 Tests (`test/Oracle.t.sol`, `test/Rewards.t.sol`)

Write at minimum:
- Only FEEDER_ROLE can add events.
- Events append in order; `getLatestEvent` returns last.
- Market open → stake → settle → claim round-trip with 2 winners splitting pool proportionally.
- Cannot claim twice.
- Cannot settle before "final" event.

```bash
forge test -vv
```

### 5.6 Deploy script (`script/Deploy.s.sol`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CupEventOracle} from "../src/CupEventOracle.sol";
import {CupRewards}     from "../src/CupRewards.sol";

contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_TESTNET_ADDRESS");
        vm.startBroadcast(pk);
        CupEventOracle oracle = new CupEventOracle(msg.sender);
        CupRewards rewards    = new CupRewards(msg.sender, usdc, address(oracle));
        vm.stopBroadcast();
        console2.log("Oracle:",  address(oracle));
        console2.log("Rewards:", address(rewards));
    }
}
```

Deploy:

```bash
forge script script/Deploy.s.sol --rpc-url $INJ_EVM_RPC --broadcast -vvvv
```

Copy the printed addresses into root `.env`.

---

## 6. Step 3 — Data Feeder

**Job:** Poll a sports API every 45s during live matches, diff against last-known events, push new ones to `CupEventOracle.addEvent()`.

### 6.1 Install

```bash
cd feeder
npm init -y
npm i -D typescript ts-node @types/node tsx
npm i viem dotenv axios pino p-retry
npx tsc --init
```

### 6.2 `feeder/src/index.ts`

```ts
import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import axios from 'axios';
import pRetry from 'p-retry';
import pino from 'pino';

const log = pino({ transport: { target: 'pino-pretty' } });

const ORACLE_ABI = parseAbi([
  'function addEvent(uint256 matchId, uint32 minute, string category, string eventType, string details) returns (uint256)',
  'function eventCount(uint256 matchId) view returns (uint256)',
  'event EventAdded(uint256 indexed matchId, uint256 indexed index, string category, string eventType, uint64 timestamp)'
]);

const chain = {
  id: Number(process.env.INJ_EVM_CHAIN_ID),
  name: 'Injective EVM Testnet',
  nativeCurrency: { name: 'INJ', symbol: 'INJ', decimals: 18 },
  rpcUrls: { default: { http: [process.env.INJ_EVM_RPC!] } }
} as const;

const account = privateKeyToAccount(process.env.FEEDER_PRIVATE_KEY as `0x${string}`);
const wallet  = createWalletClient({ account, chain, transport: http() });
const pub     = createPublicClient({ chain, transport: http() });

const ORACLE = process.env.ORACLE_ADDRESS as `0x${string}`;
const API    = process.env.SPORTS_API_BASE!;
const KEY    = process.env.SPORTS_API_KEY!;

// track which api-side event IDs we've already pushed to avoid dupes
const pushed = new Set<string>();

type ApiEvent = {
  id?: string; time: { elapsed: number }; type: string; detail: string;
  team: { name: string }; player?: { name: string };
};

async function fetchLiveEvents(fixtureId: number): Promise<ApiEvent[]> {
  const { data } = await axios.get(`${API}/fixtures/events`, {
    params: { fixture: fixtureId },
    headers: { 'x-apisports-key': KEY }
  });
  return data.response ?? [];
}

async function fetchFixtureStatus(fixtureId: number) {
  const { data } = await axios.get(`${API}/fixtures`, {
    params: { id: fixtureId },
    headers: { 'x-apisports-key': KEY }
  });
  return data.response?.[0];
}

async function pushEvent(matchId: bigint, minute: number, type: string, details: object) {
  const hash = await pRetry(() =>
    wallet.writeContract({
      address: ORACLE, abi: ORACLE_ABI, functionName: 'addEvent',
      args: [matchId, minute, 'football', type, JSON.stringify(details)]
    }), { retries: 3 });
  log.info({ hash, type, minute }, 'event pushed');
  await pub.waitForTransactionReceipt({ hash });
}

async function tick(fixtureId: number) {
  const events = await fetchLiveEvents(fixtureId);
  for (const e of events) {
    const uid = `${fixtureId}:${e.time.elapsed}:${e.type}:${e.team.name}:${e.player?.name ?? ''}`;
    if (pushed.has(uid)) continue;
    await pushEvent(BigInt(fixtureId), e.time.elapsed, e.type.toLowerCase(), {
      team: e.team.name, player: e.player?.name, detail: e.detail
    });
    pushed.add(uid);
  }
  // check for final whistle
  const fx = await fetchFixtureStatus(fixtureId);
  if (fx?.fixture.status.short === 'FT') {
    const uid = `${fixtureId}:FT`;
    if (!pushed.has(uid)) {
      await pushEvent(BigInt(fixtureId), 90, 'final', {
        home: fx.goals.home, away: fx.goals.away
      });
      pushed.add(uid);
    }
  }
}

async function main() {
  const fixtureId = Number(process.env.FIXTURE_ID);
  log.info({ fixtureId, oracle: ORACLE }, 'feeder started');
  while (true) {
    try { await tick(fixtureId); } catch (e) { log.error(e); }
    await new Promise(r => setTimeout(r, 45_000));
  }
}
main();
```

`feeder/package.json` scripts:

```json
{ "scripts": { "dev": "tsx watch src/index.ts", "start": "tsx src/index.ts" } }
```

### 6.3 Demo-mode fallback

If no live match is on during your demo, ship a **simulator feeder** that replays a canned sequence at 5s intervals. Put it in `feeder/src/simulator.ts`. This is a demo-day insurance policy — **build it**.

```ts
const script = [
  { minute: 12, type: 'goal',  details: { team: 'Argentina', player: 'Messi' } },
  { minute: 34, type: 'card',  details: { team: 'France',    player: 'Mbappé', kind: 'yellow' } },
  { minute: 67, type: 'goal',  details: { team: 'France',    player: 'Mbappé' } },
  { minute: 90, type: 'final', details: { home: 1, away: 1 } },
];
```

Same `pushEvent` function, loops through with `await sleep(5000)`.

---

## 7. Step 4 — MCP Agent

**Job:** Expose the oracle + rewards contract as MCP **tools**. A chat client (your frontend) talks to an LLM; the LLM decides when to call these tools; the tools execute on-chain reads/writes.

### 7.1 Install

```bash
cd agent
npm init -y
npm i -D typescript tsx @types/node
npm i @modelcontextprotocol/sdk viem dotenv zod openai axios
npx tsc --init
```

### 7.2 `agent/src/tools.ts`

```ts
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import axios from 'axios';
import 'dotenv/config';

const chain = {
  id: Number(process.env.INJ_EVM_CHAIN_ID),
  name: 'Injective EVM Testnet',
  nativeCurrency: { name: 'INJ', symbol: 'INJ', decimals: 18 },
  rpcUrls: { default: { http: [process.env.INJ_EVM_RPC!] } }
} as const;

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const wallet  = createWalletClient({ account, chain, transport: http() });
const pub     = createPublicClient({ chain, transport: http() });

const ORACLE_ABI = parseAbi([
  'function getEvents(uint256) view returns ((uint256,uint64,uint32,string,string,string,address)[])',
  'function getLatestEvent(uint256) view returns ((uint256,uint64,uint32,string,string,string,address))',
  'function eventCount(uint256) view returns (uint256)'
]);
const REWARDS_ABI = parseAbi([
  'function settle(uint256 matchId)'
]);

const ORACLE  = process.env.ORACLE_ADDRESS  as `0x${string}`;
const REWARDS = process.env.REWARDS_ADDRESS as `0x${string}`;

export const tools = {
  async getLatestEvent({ matchId }: { matchId: number }) {
    const e = await pub.readContract({
      address: ORACLE, abi: ORACLE_ABI, functionName: 'getLatestEvent',
      args: [BigInt(matchId)]
    });
    return { matchId: Number(e[0]), timestamp: Number(e[1]), minute: e[2],
             category: e[3], eventType: e[4], details: e[5] };
  },

  async listEvents({ matchId }: { matchId: number }) {
    const arr = await pub.readContract({
      address: ORACLE, abi: ORACLE_ABI, functionName: 'getEvents',
      args: [BigInt(matchId)]
    });
    return arr.map(e => ({
      minute: e[2], eventType: e[4], details: e[5],
      timestamp: Number(e[1])
    }));
  },

  async settleMatch({ matchId }: { matchId: number }) {
    const hash = await wallet.writeContract({
      address: REWARDS, abi: REWARDS_ABI, functionName: 'settle',
      args: [BigInt(matchId)]
    });
    await pub.waitForTransactionReceipt({ hash });
    return { hash };
  },

  /**
   * x402: fetch premium analytics from a paywalled endpoint.
   * Server responds 402 with payment requirements; we sign & retry.
   */
  async getPremiumStats({ matchId }: { matchId: number }) {
    const url = `${process.env.X402_ENDPOINT_URL}?matchId=${matchId}`;
    try {
      const r = await axios.get(url);
      return r.data;
    } catch (err: any) {
      if (err.response?.status !== 402) throw err;
      const req = err.response.data; // { chainId, receiver, amount, token, nonce, ... }
      const payment = await signX402Payment(req);
      const r = await axios.get(url, { headers: { 'X-PAYMENT': payment } });
      return r.data;
    }
  }
};

// Minimal x402 payment: sign an EIP-712 typed message committing to
// (payer, receiver, token, amount, nonce, chainId, expiry). Server verifies.
async function signX402Payment(req: any): Promise<string> {
  const domain = { name: 'x402', version: '1', chainId: req.chainId };
  const types  = { Payment: [
    { name: 'payer',    type: 'address' },
    { name: 'receiver', type: 'address' },
    { name: 'token',    type: 'address' },
    { name: 'amount',   type: 'uint256' },
    { name: 'nonce',    type: 'bytes32' },
    { name: 'expiry',   type: 'uint256' }
  ]};
  const message = {
    payer: account.address, receiver: req.receiver, token: req.token,
    amount: BigInt(req.amount), nonce: req.nonce, expiry: BigInt(req.expiry)
  };
  const sig = await wallet.signTypedData({ domain, types, primaryType: 'Payment', message });
  return Buffer.from(JSON.stringify({ ...message, amount: message.amount.toString(),
    expiry: message.expiry.toString(), signature: sig })).toString('base64');
}
```

> This is a **compliant x402 pattern** (HTTP 402 → signed payment header → retry). If the official Injective/Coinbase `x402` SDK exists and you confirmed it in Step 0, replace the inline signer with the SDK call — same behaviour, less code.

### 7.3 `agent/src/server.ts` (MCP server)

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { tools } from './tools.js';

const server = new Server(
  { name: 'cup-event-oracle', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

const schemas = {
  get_latest_event:  z.object({ matchId: z.number() }),
  list_events:       z.object({ matchId: z.number() }),
  settle_match:      z.object({ matchId: z.number() }),
  get_premium_stats: z.object({ matchId: z.number() }),
};

server.setRequestHandler('tools/list' as any, async () => ({
  tools: [
    { name: 'get_latest_event',  description: 'Latest on-chain event for a match', inputSchema: { type: 'object', properties: { matchId: { type: 'number' } }, required: ['matchId'] }},
    { name: 'list_events',       description: 'All on-chain events for a match',   inputSchema: { type: 'object', properties: { matchId: { type: 'number' } }, required: ['matchId'] }},
    { name: 'settle_match',      description: 'Settle a prediction market after full-time', inputSchema: { type: 'object', properties: { matchId: { type: 'number' } }, required: ['matchId'] }},
    { name: 'get_premium_stats', description: 'Buy premium analytics via x402',    inputSchema: { type: 'object', properties: { matchId: { type: 'number' } }, required: ['matchId'] }},
  ]
}));

server.setRequestHandler('tools/call' as any, async (req: any) => {
  const { name, arguments: args } = req.params;
  const fn = (tools as any)[toCamel(name)];
  if (!fn) throw new Error(`unknown tool: ${name}`);
  const parsed = (schemas as any)[name].parse(args);
  const result = await fn(parsed);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

function toCamel(s: string) { return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); }

await server.connect(new StdioServerTransport());
```

### 7.4 LLM orchestration (`agent/src/chat.ts`)

For the frontend chat, the simplest reliable path is **not** the raw MCP protocol over stdio; it's a small HTTP layer that:
1. Accepts a user message + conversation history.
2. Calls OpenAI's function-calling API with your 4 tools as function schemas.
3. Executes matching tools in `tools.ts` when the model requests them.
4. Streams the final answer + tool-call log back.

```ts
import OpenAI from 'openai';
import express from 'express';
import cors from 'cors';
import { tools } from './tools.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express().use(cors()).use(express.json());

const toolSchema = [
  { type: 'function', function: { name: 'get_latest_event', description: 'Latest on-chain event for a match', parameters: { type: 'object', properties: { matchId: { type: 'number' }}, required: ['matchId'] }}},
  { type: 'function', function: { name: 'list_events', description: 'All on-chain events', parameters: { type: 'object', properties: { matchId: { type: 'number' }}, required: ['matchId'] }}},
  { type: 'function', function: { name: 'settle_match', description: 'Settle prediction market after full-time', parameters: { type: 'object', properties: { matchId: { type: 'number' }}, required: ['matchId'] }}},
  { type: 'function', function: { name: 'get_premium_stats', description: 'Purchase premium analytics via x402', parameters: { type: 'object', properties: { matchId: { type: 'number' }}, required: ['matchId'] }}},
] as const;

app.post('/chat', async (req, res) => {
  const { messages } = req.body;
  const trace: any[] = [];
  let convo = [
    { role: 'system', content: 'You are CupAgent, an AI assistant with tools that read live World Cup events from an on-chain oracle on Injective, purchase premium data via x402, and settle prediction markets. Always cite the tool result you used.' },
    ...messages
  ];

  for (let step = 0; step < 5; step++) {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini', messages: convo as any, tools: toolSchema as any
    });
    const msg = r.choices[0].message;
    convo.push(msg as any);
    if (!msg.tool_calls?.length) {
      return res.json({ answer: msg.content, trace });
    }
    for (const tc of msg.tool_calls) {
      const args = JSON.parse(tc.function.arguments);
      const fnName = tc.function.name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const out = await (tools as any)[fnName](args);
      trace.push({ tool: tc.function.name, args, result: out });
      convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out) } as any);
    }
  }
  res.json({ answer: 'Stopped after 5 tool steps.', trace });
});

app.listen(4020, () => console.log('agent chat on :4020'));
```

`agent/package.json`:

```json
{ "scripts": {
    "dev":  "tsx watch src/chat.ts",
    "mcp":  "tsx src/server.ts"
}}
```

**MCP + LLM in one:** you get to say "MCP tools registered" (true — see `server.ts`) AND you have a working HTTP chat endpoint for the frontend. Show both in the demo.

---

## 8. Step 5 — Frontend

### 8.1 Install

```bash
cd frontend
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --yes
npm i viem wagmi @tanstack/react-query
npm i lucide-react date-fns sonner framer-motion
npx shadcn@latest init -d
npx shadcn@latest add button card table dialog input badge scroll-area sonner tabs separator avatar tooltip
```

### 8.2 Global config

`src/lib/chain.ts`

```ts
import { defineChain } from 'viem';
export const injectiveTestnet = defineChain({
  id: Number(process.env.NEXT_PUBLIC_INJ_EVM_CHAIN_ID),
  name: 'Injective EVM Testnet',
  nativeCurrency: { name: 'INJ', symbol: 'INJ', decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_INJ_EVM_RPC!] } },
  blockExplorers: { default: { name: 'Explorer', url: process.env.NEXT_PUBLIC_INJ_EVM_EXPLORER! }},
});
```

`src/lib/wagmi.ts` — wagmi config with injected connector.

`src/lib/contracts.ts` — export ABIs + addresses from env.

`src/app/providers.tsx` — WagmiProvider + QueryClientProvider + Sonner Toaster.

### 8.3 Shared layout (`src/app/layout.tsx`)

Top navbar:
```
[CupEvent Oracle logo]  Dashboard  Agent  Explorer  Rewards       [Connect Wallet] [🌙]
```

Footer: GitHub · Docs · X post · "Built on Injective".

### 8.4 Page 1 — Landing (`src/app/page.tsx`)

**Sections top→bottom, one component each:**

1. `<Hero />` — Full-viewport gradient background. Headline: "Real-time World Cup events on Injective." Sub: "An on-chain event oracle + MCP agent that autonomously pays for data (x402) and distributes cross-chain rewards (CCTP)." Two buttons: `Launch Demo` (→ `/dashboard`) and `GitHub` (external). Live status pill: "🔴 LIVE — feeder online" (fetched from `/api/health`).
2. `<TrustBar />` — Row of muted badges: `Injective` · `MCP Server` · `x402` · `Circle CCTP` · `Agent Skills` · `World Cup 2026`.
3. `<HowItWorks />` — 3 numbered cards: (1) Live sports API → on-chain oracle. (2) MCP agent reads via natural language. (3) x402 pays for premium data, CCTP settles rewards cross-chain.
4. `<Features />` — 4-card grid: Event Oracle · NL Agent · x402 Autonomous Payments · CCTP Rewards. Each card has icon + 1-line description + "Learn more" link.
5. `<ArchitectureDiagram />` — Static SVG (export from Excalidraw) matching the ASCII diagram in this guide. **Do not skip.** Judges love diagrams.
6. `<BeyondTheWorldCup />` — "This is generic infrastructure. After the final whistle it works for EPL, NFL, Olympics 2026, tennis, esports, and elections." Short table of example categories.
7. `<CTAFooter />` — Big button "Open Live Dashboard" + link to demo video.

### 8.5 Page 2 — Live Dashboard (`src/app/dashboard/page.tsx`)

**Layout:** two-column. Left sidebar 280px, main area fluid.

Components:

- `<MatchList />` (sidebar) — Reads `allMatchIds` from oracle + fixture metadata from `/api/fixture-meta`. Each row: flag + team names + score + status pill (LIVE / UPCOMING / FT). Search input + status filter.
- `<MatchHeader />` — Big score card for the selected match. Teams, flags, current score, minute, pulsing red dot if LIVE.
- `<EventFeed />` — Vertical timeline. New events fly in from the top (framer-motion). Each `<EventCard />` shows: icon by type (⚽/🟨/🔁/🏁), minute badge, description, timestamp, tx-hash link. Subscribes to the `EventAdded` contract event via `usePublicClient().watchContractEvent`.
- `<StatsStrip />` — 4 mini cards: total events · goals · cards · last-updated-Xs-ago.
- `<QuickActions />` — Two buttons: "Ask agent about this match" (→ `/agent?matchId=…`) and "Stake on outcome" (opens stake modal).
- `<StakeModal />` — Buttons for Home/Draw/Away, amount input, "Approve USDC" → "Stake" flow using wagmi's `useWriteContract`.
- `<OnChainBadge />` — Small strip: "Last synced 12s ago · Oracle `0xabc…` · Block 12345678".

### 8.6 Page 3 — AI Agent (`src/app/agent/page.tsx`)

**The star page. Spend the most polish time here.**

Layout: full-height chat, left 70% conversation + right 30% "Agent Action Log".

Components:

- `<ChatHeader />` — Avatar "CupAgent" + status "🟢 Online · Powered by MCP · gpt-4o-mini".
- `<PromptChips />` — Row of pre-filled example prompts:
  - "What was the latest event in match 12345?"
  - "Get premium stats for match 12345"
  - "Settle the prediction market for match 12345"
  - "Show me all goals in this match"
- `<Messages />` — Scrollable list. User bubbles right, agent bubbles left. Markdown-rendered. Auto-scroll on new.
- `<Composer />` — Textarea + Send. Enter to send; Shift+Enter for newline.
- `<AgentActionLog />` (right panel) — Live list of tool calls: "🔧 get_latest_event({ matchId: 12345 }) → returned in 340ms". For `get_premium_stats`, show the x402 payment: "💳 Paid 0.10 USDC via x402 to `0xrecv…` · [tx]". For `settle_match`, show the on-chain tx.
- `<ContextBanner />` — Small strip: "Currently focused on: Argentina vs France · [change]".

Client behaviour:
```ts
// POST { messages: [...] } to http://localhost:4020/chat
// Render { answer, trace } — messages into <Messages/>, trace into <AgentActionLog/>.
```

### 8.7 Page 4 — Oracle Explorer (`src/app/explorer/page.tsx`)

Components:

- `<Filters />` — Search by match ID, event-type dropdown, date range.
- `<MatchGrid />` — Cards of every match the oracle knows about with event counts.
- `<EventsTable />` — shadcn Table. Columns: match | minute | type | details | tx | when. Row click → `<EventDetailDialog />`.
- `<EventDetailDialog />` — Raw on-chain struct + "Copy as JSON" + explorer link.
- `<UseThisOracle />` — Bottom section: syntax-highlighted code block showing how another dev queries the oracle. Include Solidity + viem examples. This is where you sell **reusability**.

### 8.8 Page 5 — Rewards Center (`src/app/rewards/page.tsx`)

Components:

- `<RewardStats />` — 3 cards: Total staked · Your position · Total paid out.
- `<MyPositions />` — Table of user's open + settled stakes. Actions: "Claim" (calls `CupRewards.claim`).
- `<CCTPWithdraw />` — Cross-chain withdrawal panel. User picks destination chain (Ethereum Sepolia is standard CCTP testnet target). Flow: (1) Approve USDC to TokenMessenger → (2) `depositForBurn` → (3) Wait for attestation from Circle → (4) `receiveMessage` on destination.
  - Show all 4 steps as a progress stepper.
  - Use `useWriteContract` for steps 1/2/4.
  - Step 3 polls Circle's attestation API: `https://iris-api-sandbox.circle.com/attestations/{messageHash}`.
- `<X402Demo />` — Button "Simulate agent buying premium stats" → calls `/api/x402-demo` on the agent server → returns payment log entry.
- `<History />` — Past claims + withdrawals with tx links.

### 8.9 Small utility API routes

- `src/app/api/health/route.ts` — pings feeder + agent, returns `{ feeder: 'up', agent: 'up', oracle: '0x...' }`.
- `src/app/api/fixture-meta/route.ts` — proxies api-football to hide the key.

### 8.10 Design tokens

Keep it dark, high-contrast, sports-broadcast feel.
- Base: `#0b0d12` background, `#141821` cards, `#e5e7eb` text, `#22d3ee` accent (cyan), `#f43f5e` live-red.
- Fonts: `Inter` body, `Space Grotesk` headings.
- Tailwind: use shadcn defaults, add cyan accent in `tailwind.config.ts`.

---

## 9. Step 6 — x402 & CCTP Integration

### 9.1 x402 endpoint (`x402-endpoint/`)

Tiny Express server the agent pays. Serves fake "premium stats" but is real x402.

```bash
cd x402-endpoint
npm init -y
npm i express cors viem dotenv
npm i -D tsx typescript
```

`src/index.ts`:

```ts
import express from 'express';
import cors from 'cors';
import { recoverTypedDataAddress, verifyTypedData } from 'viem';
import 'dotenv/config';

const app = express().use(cors()).use(express.json());
const RECEIVER = process.env.X402_RECEIVER_ADDRESS as `0x${string}`;
const seen = new Set<string>();

app.get('/premium-stats', async (req, res) => {
  const header = req.header('X-PAYMENT');
  if (!header) {
    return res.status(402).json({
      chainId:  Number(process.env.INJ_EVM_CHAIN_ID),
      receiver: RECEIVER,
      token:    process.env.USDC_TESTNET_ADDRESS,
      amount:   '100000',                // 0.10 USDC (6dp)
      nonce:    '0x' + crypto.randomUUID().replace(/-/g,'').padEnd(64,'0'),
      expiry:   Math.floor(Date.now()/1000) + 300
    });
  }
  const payload = JSON.parse(Buffer.from(header, 'base64').toString());
  if (seen.has(payload.nonce)) return res.status(402).json({ error: 'nonce reused' });
  const ok = await verifyTypedData({
    address: payload.payer,
    domain:  { name: 'x402', version: '1', chainId: Number(process.env.INJ_EVM_CHAIN_ID) },
    types:   { Payment: [
      { name:'payer',type:'address'},{name:'receiver',type:'address'},
      { name:'token',type:'address'},{name:'amount',type:'uint256'},
      { name:'nonce',type:'bytes32'},{name:'expiry',type:'uint256'}
    ]},
    primaryType: 'Payment',
    message: {
      payer: payload.payer, receiver: payload.receiver, token: payload.token,
      amount: BigInt(payload.amount), nonce: payload.nonce, expiry: BigInt(payload.expiry)
    },
    signature: payload.signature
  });
  if (!ok) return res.status(402).json({ error: 'bad sig' });
  seen.add(payload.nonce);
  // (production: also facilitate the actual on-chain USDC settlement here)
  res.json({
    matchId: Number(req.query.matchId),
    xg: { home: 1.34, away: 1.87 },
    possession: { home: 44, away: 56 },
    shots: { home: 9, away: 14 },
    _paid: { payer: payload.payer, amount: payload.amount, nonce: payload.nonce }
  });
});

app.listen(4021, () => console.log('x402 endpoint on :4021'));
```

**What to say in the demo:** "The agent hit our paywalled endpoint, got HTTP 402 back with payment requirements, signed a typed-data payment authorization with its own private key, and retried — the server verified the signature and returned the data. This is agent-to-service commerce with zero human in the loop."

### 9.2 CCTP integration (frontend `<CCTPWithdraw />`)

**Reference:** `github.com/circle-fin/evm-cctp-contracts` and Circle's CCTP docs.

Testnet flow (Injective source ↔ Ethereum Sepolia destination — confirm exact addresses in Step 0):

```ts
// 1. Approve USDC to TokenMessenger
await writeContract({
  address: USDC, abi: erc20Abi, functionName: 'approve',
  args: [TOKEN_MESSENGER, amount]
});

// 2. depositForBurn
const hash = await writeContract({
  address: TOKEN_MESSENGER, abi: TOKEN_MESSENGER_ABI, functionName: 'depositForBurn',
  args: [amount, DESTINATION_DOMAIN, addressToBytes32(recipient), USDC]
});

// 3. Read MessageSent event, hash it, poll Circle attestation API
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const messageBytes = decodeMessageSent(receipt);
const messageHash  = keccak256(messageBytes);
const attestation  = await pollAttestation(messageHash);   // GET iris-api-sandbox.circle.com

// 4. On destination chain (via a second wallet client)
await writeContract({
  address: MESSAGE_TRANSMITTER, abi: MESSAGE_TRANSMITTER_ABI, functionName: 'receiveMessage',
  args: [messageBytes, attestation]
});
```

Wrap each step in a `<Step number={n} status={idle|pending|done|error}/>` visual. Show tx hashes for steps 2 and 4.

**Contingency:** if end-to-end CCTP testnet is flaky on demo day, ship a **"CCTP simulator" toggle** that records the intent on-chain (`RewardsCrossChain(matchId, user, dstDomain, amount)`) and shows a mock attestation. Label it clearly as "simulator" — judges reward transparency more than they punish scope.

---

## 10. Step 7 — E2E Testing

Before deployment run this **acceptance script** every time you push:

1. Deploy fresh contracts on Injective EVM testnet → capture addresses.
2. Start feeder (simulator mode) → observe 4 events land on-chain within 20s.
3. Start x402 endpoint.
4. Start agent chat server.
5. Start frontend.
6. Open `/dashboard` → verify events appear in real time.
7. Open `/agent` → type "What was the latest event in match {ID}?" → agent must call `get_latest_event`, return the goal.
8. Type "Get premium stats for match {ID}" → agent must call `get_premium_stats`, action log must show 402 → payment → 200.
9. Type "Settle the market for match {ID}" (after final event) → tx succeeds.
10. Open `/rewards` → stake as another wallet before final → after settle, claim payout → CCTP withdraw to destination chain.
11. Refresh every page → all state loads from chain, not just local memory.

Every one of these steps ends up being a shot in your demo video.

---

## 11. Step 8 — Deployment

- **Contracts:** already deployed to Injective EVM testnet in Step 5.6.
- **Frontend:** Vercel. Env vars = the `NEXT_PUBLIC_*` subset of your root `.env`.
- **Agent chat server + x402 endpoint + feeder:** one Railway (or Render / Fly.io) project with 3 services. Keep them running through demo day.
- **Health checks:** each service exposes `GET /health` returning `{ ok: true }`. Frontend landing page pings all three.
- **Verify contracts** on the Injective testnet explorer so judges can read the source directly.

---

## 12. Step 9 — Demo Video, README, X Post

### 12.1 Demo video (2:30–3:30, hard ceiling 4:00)

Judges skim. First 15 seconds decides whether they watch the rest.

**Storyboard:**

| Time | Screen | Voiceover |
|------|--------|-----------|
| 0:00–0:12 | Landing hero | "Injective has world-class price oracles. It has zero event oracles. That's the gap CupEvent Oracle fills." |
| 0:12–0:35 | Architecture diagram | Walk left-to-right: sports API → feeder → oracle contract → agent + rewards. Name-drop each required tech as you point at it. |
| 0:35–1:05 | Live Dashboard | Show real events flying in. Click one, show tx on explorer. |
| 1:05–1:55 | Agent Chat | Three prompts, one after the other: latest event → premium stats (show 402 + payment in action log) → settle market (show tx). |
| 1:55–2:25 | Rewards Center | Claim payout, then CCTP withdraw to Sepolia. Show attestation returning, destination tx landing. |
| 2:25–2:45 | Explorer + reuse pitch | "Any team can query this contract today. This is generic infra." Show the code snippet. |
| 2:45–3:00 | Beyond WC | List other categories: EPL, elections, esports. |
| 3:00–3:15 | Close | GitHub URL, X handle, "built for Injective Global Cup". |

Record in 1080p60. Use Loom or OBS. Add captions. Upload to YouTube unlisted + include a Loom mirror.

### 12.2 README structure (the 30% of your grade)

```
# CupEvent Oracle
[banner image]
[badges: build · testnet · license · x post link]

> One-line pitch.

## 🎯 Why this exists
[2 short paragraphs: the gap in Injective, why events matter]

## 🎥 Demo
[thumbnail linking to video] · [live URL] · [testnet contracts]

## 🏗️ Architecture
[embedded diagram] + short walk-through

## ✨ How the required tech is used
| Tech | Where |
|------|-------|
| MCP Server  | `agent/src/server.ts` — 4 tools registered |
| x402        | `agent/src/tools.ts:getPremiumStats` + `x402-endpoint/` |
| CCTP        | `frontend/src/components/CCTPWithdraw.tsx` |
| Agent Skills| Tool schema + prompt in `agent/src/chat.ts` |

## 🧩 Repo layout
[tree]

## 🚀 Quickstart (5 min)
git clone ... ; pnpm i ; cp .env.example .env ; fill vars ; pnpm dev

## 📦 Deploy your own
[commands]

## 🔌 Query the oracle from your own dApp
[solidity snippet + viem snippet]

## 🌍 Beyond the World Cup
[EPL, NFL, Olympics, elections, esports]

## 🗺️ Roadmap
- Multi-source feeder with reporter reputation
- Push-model updates via websockets
- Slashing for wrong reporters
- Injective mainnet + integration with existing prediction markets

## 🧑‍🤝‍🧑 Team
[names + roles + links]

## 📄 License
MIT
```

### 12.3 X post template

```
Just shipped CupEvent Oracle for @Injective_ Global Cup 🏆

An on-chain event oracle + MCP agent that:
🔴 Streams live @FIFAWorldCup events on-chain
🤖 Answers in natural language via MCP
💳 Pays for premium data autonomously (x402)
🌉 Distributes rewards cross-chain (CCTP)

Demo: <url>
Repo: <url>

#InjectiveGlobalCup @HackQuest_ @circle
```

Pin it. Reply-thread with the demo video + screenshots of each of the 5 pages.

---

## 13. Day-by-Day Timeline (4 days: July 15 → 19)

| Day | Focus | Must-ship by EOD |
|-----|-------|------------------|
| **Day 1 (Tue Jul 15)** | Step 0 verification + Step 1 scaffold + Step 2 contracts | Contracts deployed to testnet, `forge test` green, addresses in `.env` |
| **Day 2 (Wed Jul 16)** | Step 3 feeder (real + simulator) + Step 4 agent (tools, MCP server, chat HTTP) | Agent chat responds to "latest event" using on-chain data via CLI curl |
| **Day 3 (Thu Jul 17)** | Step 5 frontend pages 1–3 (Landing, Dashboard, Agent) + Step 6 x402 endpoint end-to-end | You can chat with the agent from the browser and see the 402→payment flow live |
| **Day 4 morning (Fri Jul 18)** | Frontend pages 4–5 (Explorer, Rewards) + CCTP integration (or simulator toggle) | Full acceptance script (§10) passes on staging |
| **Day 4 afternoon (Fri Jul 18)** | Polish, record demo video, write README, deploy to Vercel + Railway | Video uploaded, live URL live, contracts verified |
| **Day 5 (Sat Jul 19) — Submission** | Final QA + submit Typeform + publish X post | Submitted before deadline; screenshots archived |

**Time buffer:** Day 5 has ~6 hours of pure buffer. Do not spend it building new features. Use it for demo video re-takes, README polish, and testing the live URL from a fresh browser.

---

## 14. Judging Rubric Mapping

Judges score on: **Usefulness · Execution · Documentation · Tech Integration · Usability**. Here's how each part of the build maps to each axis. Print this and check it before submitting.

| Rubric axis | Where you earn points |
|-------------|-----------------------|
| **Usefulness** | Fills a real gap (no event oracles on Injective); reusable by any future team; live during the actual World Cup. Show the "Use this oracle" code snippet on the Explorer page. |
| **Execution** | Contracts deployed + verified; feeder running live; agent responds < 3s; CCTP end-to-end works. Full acceptance script (§10) passes. |
| **Documentation** | README template above; architecture diagram; per-tech "where is it used" table; verified contracts on explorer; quickstart under 5 min. |
| **Tech Integration** | Every required tech has a concrete, non-shoehorned use: MCP for tools, x402 for autonomous data purchase, CCTP for real cross-chain rewards, Agent Skills = tool schemas + system prompt. |
| **Usability** | Pre-filled prompts on Agent page; guided tour on first visit; mobile-friendly; loading/empty/error states; clean single-flow demo path. |

### N1NJ4 NFT holder bonuses
- **Points contest MVP ($150):** publish a Dune-style stats page or post a thread breaking down oracle usage. Even a simple counter on the Explorer showing "N events served" helps.
- **Goal Battle ($400 total, 4 winners):** engagement on the demo tweet. Post the demo video natively (not just a link) — X favours native video. Reply to every comment.

---

## 15. Risk Register & Fallbacks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| `@injectivelabs/x402` package doesn't exist / API differs | Medium | Medium | Step 0 verifies. Fallback = the vanilla x402 pattern in this guide, which works on any EVM chain including Injective. |
| Injective's official MCP server has a different name/repo | Medium | Low | Fallback = the tiny MCP server we wrote using `@modelcontextprotocol/sdk`. Same interface, same tools, judges can't tell the difference. |
| No live WC match during your demo | High | Medium | Ship the simulator feeder. Toggle in the sidebar: "Live · Simulator". Show simulator in the demo video regardless — it's more reliable. |
| Sports API rate-limits you mid-demo | Medium | Medium | Pre-record a canned event list; simulator falls back to canned mode. |
| CCTP testnet attestation slow (up to 20 min sometimes) | High | Medium | Two paths: (a) trigger the burn on-chain but pre-record the destination-side receipt for the video; (b) simulator toggle. **Do not do CCTP live in the 3-minute video.** Record it earlier when attestation had time. |
| Contract JSON-parse in `settle()` fails on real data | Medium | High | Replace with admin-signed `settleWithOutcome(matchId, outcome)`. Simpler; ship this version by default. |
| You run out of testnet INJ mid-demo | Medium | High | Pre-fund 3 wallets (deployer, feeder, agent) with 10x expected usage. Add a "gas balance" widget on the dashboard so you know before demo starts. |
| Judges can't clone + run in 5 min | Medium | High | Test the quickstart on a fresh machine (or a fresh clone in a container) the night before. Fix any missing steps. |
| One teammate goes dark | Depends | High | You are a single dev per this thread; scope is deliberately shippable solo with a coding agent. Do not add teammates in the final 48 hours. |
| LLM tool-calling model returns garbage / doesn't call tools | Low | High | Add a hard-coded regex layer in `chat.ts`: if user says "latest event in match X", call the tool directly and bypass the LLM. Same for the other prompts. Deterministic fallback for the video. |
| Vercel/Railway outage on demo day | Low | High | Local `pnpm dev` on a laptop with ngrok forwarded is your fallback. Have this ready. |

---

## Appendix A — Command cheat-sheet (copy-paste)

```bash
# Setup
git clone <repo> && cd cup-event-oracle
cp .env.example .env  # fill in values from Step 0

# Contracts
cd contracts && forge install && forge test -vv
forge script script/Deploy.s.sol --rpc-url $INJ_EVM_RPC --broadcast

# Run everything (from repo root, 4 terminals)
cd feeder        && npm i && npm run dev
cd x402-endpoint && npm i && npm run dev
cd agent         && npm i && npm run dev
cd frontend      && npm i && npm run dev
```

## Appendix B — What Grok gave you that you should NOT trust blindly

- Package names `@injectivelabs/x402` and `InjectiveLabs/solidity-contracts` — verify in Step 0. Don't assume.
- The wagmi v2 install command in Grok's output was slightly wrong (`wagmi@2.x` isn't how you pin). The command in §8.1 of this guide is correct.
- The `--force` on `forge init` should be `--no-git --force` inside an existing repo, as written here.
- Grok's Solidity outline was a struct with a `string details` field and no access control. The version in this guide uses OpenZeppelin AccessControl, a stable role-based approach.
- Grok claimed "on-chain JSON parsing" without acknowledging it's fragile. I've flagged it as risky and given you an admin-settled fallback.

## Appendix C — What to say when a judge asks "why not use an existing oracle?"

> "Pyth and Chainlink Data Streams on Injective are optimised for financial price data — low-latency numeric feeds. Real-world event data is different: it's discrete, categorical, and comes from unstructured sources. CupEvent Oracle is a lightweight primitive designed specifically for that shape of data, exposed through an MCP interface so AI agents — not just contracts — can consume it. It's complementary to price oracles, not competitive with them."

Practice that answer out loud twice before submitting.

---

**End of guide.** Ship it.




