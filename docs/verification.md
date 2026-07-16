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

Use **vanilla HTTP-402 + EIP-712 signed payment header** for the demo (zero facilitator gas dependency). Optionally wire `@injectivelabs/x402` client/middleware later — package confirmed real with Injective chain IDs 1776/1439 and EIP-3009 USDC support.

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
