# Step 0 — Verification Report

**Date:** 2026-07-16  
**Hackathon:** Injective Global Cup (HackQuest) — deadline 2026-07-19

## 0.2 Package verification (npm)

| Package | Status | Version | Notes |
|---------|--------|---------|-------|
| `@injectivelabs/sdk-ts` | ✅ exists | `1.20.24` | TS SDK monorepo [injective-ts](https://github.com/InjectiveLabs/injective-ts) |
| `@injectivelabs/x402` | ✅ exists | `0.0.1` (also `0.1.0-rc.1`) | Official Injective x402. Repo: [InjectiveLabs/x402](https://github.com/InjectiveLabs/x402) |
| `x402` | ✅ exists | `1.2.0` | x402 Foundation / Coinbase reference |
| `@x402/core` / `@x402/evm` | ✅ exists | `2.18.0` | Newer modular x402 packages |
| `@modelcontextprotocol/sdk` | ✅ exists | `1.29.0` | Official MCP SDK |
| `viem` | ✅ exists | `2.55.2` | Used for all EVM reads/writes |
| `wagmi` | ✅ exists | `3.7.1` | Frontend wallet |

### Decision: x402

**Default (official):** `@injectivelabs/x402` — `injectivePaymentMiddleware` + `createInjectiveClient`.
- Network: `eip155:1439` (testnet) / `eip155:1776` (mainnet)
- Asset: Circle USDC EIP-3009 (`0x0C382e…` testnet, `0xa00C59…` mainnet)
- Amount: `10000` = 0.01 USDC
- Flow: HTTP 402 → EIP-3009 auth sign → local/remote facilitator settles on Injective → data

**Fallback:** `X402_MODE=demo` — vanilla EIP-712 header only (no on-chain USDC) when facilitator/USDC unavailable.

### Decision: MCP

`InjectiveLabs/injective-mcp` → **404**. Official repo is **[InjectiveLabs/mcp-server](https://github.com/InjectiveLabs/mcp-server)** (trading-focused). We ship our own MCP server with `@modelcontextprotocol/sdk` + viem tools for oracle/rewards.

`InjectiveLabs/solidity-contracts` → **200** (exists; not required for this build).  
`circlefin/evm-cctp-contracts` → **200**.

## 0.3 Injective EVM testnet

| Item | Value |
|------|-------|
| Chain ID | `1439` (hex `0x59f`) — native cosmos id `injective-888` |
| JSON-RPC | `https://k8s.testnet.json-rpc.injective.network/` |
| WS | `wss://k8s.testnet.ws.injective.network/` |
| Explorer | `https://testnet.blockscout.injective.network/` |
| Explorer API | `https://testnet.blockscout-api.injective.network/api` |
| INJ faucet | https://testnet.faucet.injective.network/ |
| INJ faucet (Google) | https://cloud.google.com/application/web3/faucet/injective/testnet |
| USDC faucet | https://faucet.circle.com/ |
| RPC smoke test | `eth_chainId` → `0x59f` ✅ |

### USDC + CCTP (testnet)

| Contract | Address |
|----------|---------|
| USDC | `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d` |
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| TokenMinterV2 | `0xb43db544E2c27092c107639Ad201b3dEfAbcF192` |
| CCTP domain (Injective) | `29` |
| Attestation API | `https://iris-api-sandbox.circle.com` |

Mainnet USDC (reference): `0xa00C59fF5a080D2b954d0c75e46E22a0c371235a`, domain `29`.

Source: [docs.injective.network USDC](https://docs.injective.network/developers-defi/usdc-stablecoin) + `@injectivelabs/x402` TOKENS registry.

## 0.4 Sports data API

| Provider | Notes |
|----------|-------|
| api-football (`v3.football.api-sports.io`) | Free tier ~100 req/day; header `x-apisports-key` |
| thesportsdb.com | Free fallback, less structured |
| **Demo default** | `FEEDER_MODE=simulator` — canned WC final sequence |

## 0.5 LLM

| Provider | Model | Notes |
|----------|-------|-------|
| OpenAI | `gpt-4o-mini` | Primary for agent chat tool-calling |
| Fallback | Deterministic regex router in `agent/src/chat.ts` | Bypasses LLM for demo prompts |

## Downstream pin list

```
@injectivelabs/sdk-ts@1.20.24   # optional; viem covers EVM
@injectivelabs/x402@0.0.1       # optional; vanilla x402 used in demo path
@modelcontextprotocol/sdk@1.29.0
viem@^2.21.0
wagmi@^2.14.0 || ^3
openai@latest
express / cors / axios / zod / dotenv / pino / p-retry
```

## Fallbacks adopted

1. Own MCP server (not InjectiveLabs trading MCP).
2. Vanilla x402 signature flow (no facilitator required for demo).
3. Feeder simulator mode by default.
4. `settleWithOutcome` admin path on CupRewards + JSON `settle()`.
5. CCTP UI with simulator toggle for flaky attestation.

---

# End-to-end demo verification (fan-pays flow)

**Live testnet (Injective EVM 1439) contracts:**

| Contract | Address |
|----------|---------|
| CupEventOracle | `0xbfB37D11a830f521C9D9804cc0E463B6c8Ee8Bf9` |
| OracleTreasury | `0xac4Bf838417AbC5BB6e3721c17A9b9B48F7de211` |
| FanDrops | `0x27B66425B6eD1c28e26FF2D962C9A1758D904Deb` |
| USDC (Circle testnet) | `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d` |
| Agent wallet | `0x3Ff34877B1CB3eBf91Ff46C6EFbD11565D466004` (funded ~31.9 USDC + ~2 INJ) |

**Live demo drops:** #0 (match 103, active) and #1 (match 99, agent auto-created,
active) — both eligible for demo wallet `0x0185dc75043D08324d65181F31CA7B49972331B3`.

### Runbook

1. Start stack: `dev:feeder` (:4030), `dev:agent` (:4020), `dev:x402` (:4021),
   `dev:web` (:3000).
2. **Fan pays x402** — connect wallet on `/x402`, buy premium stats. The fan's
   own wallet signs an EIP-3009 `TransferWithAuthorization`; the facilitator
   settles on-chain into `OracleTreasury`. ✅ Success modal shows amount + a
   settlement-tx explorer link.
3. **Auto-whitelist** — the page POSTs `{ matchId, address }` to `/api/whitelist`.
   Agent resolves the drop (auto-creating one if the match has none) and
   whitelists the payer. ✅ Modal shows "Whitelisted ✓". Verified: match 99 →
   Drop #1 auto-created + whitelisted.
4. **Claim** — open `/drops`; the just-whitelisted drop appears (reads use a
   dedicated Injective client so it shows even if the wallet is on another
   chain). Claim same-chain **or** cross-chain via CCTP.
5. **CCTP mint** — burn on Injective → poll Circle Iris → `receiveMessage` on the
   destination chain. Pay destination gas in native token (ETH/AVAX):
   Sepolia ~0.00015 ETH (buffer 0.01), Base ~0.000001 ETH, Arbitrum ~0.000003
   ETH, Fuji ~0 AVAX (buffer 0.05).

### Fixes validated in this pass

- Browser EIP-3009 payer (`frontend/src/lib/x402.ts`) matches
  `@injectivelabs/x402` `createPayment` wire format (domain `name:"USDC"`,
  `version:"2"`; headers `PAYMENT-SIGNATURE` + `X-PAYMENT`).
- x402 endpoint CORS exposes `PAYMENT-REQUIRED`/`PAYMENT-RESPONSE` so the browser
  can read the challenge + settlement receipt.
- Dead `rpc.sepolia.org` (404) replaced with
  `https://ethereum-sepolia-rpc.publicnode.com` (`NEXT_PUBLIC_SEPOLIA_RPC`,
  default baked into `wagmi.ts` + `CHAIN_CONFIG`).
- `/drops` reads via dedicated Injective client and always shows eligible/claimed
  drops (even FT matches).
