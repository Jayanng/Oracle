# Env checklist — what to fix

## Your path error

```bash
# You were ALREADY in contracts:
@Tebasv2 ➜ /workspaces/Oracle/contracts (Master) $ cd contracts
bash: cd: contracts: No such file or directory
```

| Goal | Correct command |
|------|-----------------|
| Repo root | `cd /workspaces/Oracle` |
| Contracts | `cd /workspaces/Oracle/contracts` |
| From root into contracts | `cd contracts` (only from `/workspaces/Oracle`) |
| Forge tests | `cd /workspaces/Oracle/contracts && forge test -vv` |
| Deploy (Injective) | from `contracts/`, with root `.env` loaded |

---

## Two modes

### A) Local Anvil (works now)

| Variable | Value |
|----------|-------|
| `INJ_EVM_RPC` | `http://127.0.0.1:8545` |
| `INJ_EVM_CHAIN_ID` | `31337` |
| `ORACLE_ADDRESS` | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| `REWARDS_ADDRESS` | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| `USDC_TESTNET_ADDRESS` | Mock `0x5FbDB231…` (Anvil deploy) |
| Keys | Anvil defaults (in `.env`) |

**Frontend:** Next only reads `NEXT_PUBLIC_*` from `frontend/.env.local` — **not** root `.env`.  
If those are missing, Dashboard/Explorer show empty chain data.

### B) Injective EVM testnet (hackathon target)

| Variable | Fix to |
|----------|--------|
| `INJ_EVM_RPC` | `https://k8s.testnet.json-rpc.injective.network` |
| `INJ_EVM_CHAIN_ID` | `1439` |
| `INJ_EVM_EXPLORER` | `https://testnet.blockscout.injective.network` |
| `USDC_TESTNET_ADDRESS` | `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d` |
| `DEPLOYER_PRIVATE_KEY` | Your key (0x…), funded with testnet INJ |
| `FEEDER_PRIVATE_KEY` | Separate key preferred, funded |
| `AGENT_PRIVATE_KEY` | Separate key preferred, funded |
| `ORACLE_ADDRESS` / `REWARDS_ADDRESS` | **After** you redeploy on 1439 |
| `X402_RECEIVER_ADDRESS` | Agent or treasury address |
| `OPENAI_API_KEY` | Optional (`sk-…`) for LLM; leave empty for deterministic chips |
| `SPORTS_API_KEY` | Only if `FEEDER_MODE=live` |
| `AUTO_DROP_AMOUNT_USDC` | Per-winner USDC when the agent auto-creates a drop on x402 purchase (default `0.10`) |
| `AUTO_DROP_MAX_WINNERS` | Max winners for agent auto-created drops (default `20`) |

Mirror all chain/contract fields into `frontend/.env.local` as `NEXT_PUBLIC_*`.

### CCTP / cross-chain RPCs (frontend `.env.local`)

| Variable | Fix to |
|----------|--------|
| `NEXT_PUBLIC_SEPOLIA_RPC` | `https://ethereum-sepolia-rpc.publicnode.com` — **`https://rpc.sepolia.org` is DEAD (404), do not use** |

Per-destination RPCs for CCTP mint live in `frontend/src/lib/contracts.ts`
(`CHAIN_CONFIG[domain].rpc`); Base/Arbitrum/Fuji default to publicnode RPCs.
The CCTP **mint runs on the destination chain** and is paid in that chain's
**native token** (ETH/AVAX, not INJ) — keep a small buffer: Sepolia ~0.01 ETH,
Base/Arbitrum ~0.001 ETH, Fuji ~0.05 AVAX.

---

## Common env bugs

1. **Wrong directory** — run forge from `/workspaces/Oracle/contracts`, not nested `contracts/contracts`.
2. **Missing `NEXT_PUBLIC_*`** — UI won’t see oracle; fix `frontend/.env.local` then restart `npm run dev:web`.
3. **Chain mismatch** — root says 1439 but Anvil is 31337 (or reverse) → txs fail.
4. **Stale Anvil** — restart Anvil → **old addresses are dead** → redeploy and update `.env` + `.env.local`.
5. **Empty private keys** — feeder/agent write tools fail.
6. **No FEEDER_ROLE** — deploy with `FEEDER_ADDRESS=0x…` or grant role after deploy.
7. **x402 receiver empty** — set `X402_RECEIVER_ADDRESS` to a checksummed address.
8. **Wallet on wrong chain** — MetaMask must use same chain id as `NEXT_PUBLIC_INJ_EVM_CHAIN_ID`. (The `/drops` reads use a dedicated Injective client so drops still load even if the wallet is on Sepolia, but **claim txs** need the right chain.)
9. **Dead Sepolia RPC** — `rpc.sepolia.org` now 404s; set `NEXT_PUBLIC_SEPOLIA_RPC` to publicnode or CCTP mints hang.
10. **No native gas on destination** — CCTP mint fails silently without ETH/AVAX on the destination chain (see CCTP RPC table above).

---

## Restart stack (from repo root)

```bash
cd /workspaces/Oracle

# terminals:
npm run dev:x402
npm run dev:agent
npm run dev:feeder
npm run dev:web
```

Open http://localhost:3000
