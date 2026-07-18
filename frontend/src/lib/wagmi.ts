import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import type { Chain } from "viem";

/** Injective EVM testnet — NEVER default to Ethereum mainnet (1). */
export const INJECTIVE_EVM_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_INJ_EVM_CHAIN_ID || "1439"
);

const rpc =
  process.env.NEXT_PUBLIC_INJ_EVM_RPC ||
  "https://k8s.testnet.json-rpc.injective.network";

const explorer =
  process.env.NEXT_PUBLIC_INJ_EVM_EXPLORER ||
  "https://testnet.blockscout.injective.network";

/**
 * Single-chain app config. Native gas token is INJ (not ETH).
 * Drops use USDC ERC-20 on this chain.
 */
export const injectiveEvmTestnet = {
  id: INJECTIVE_EVM_CHAIN_ID,
  name: "Injective EVM Testnet",
  nativeCurrency: {
    name: "Injective",
    symbol: "INJ",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [rpc] },
    public: { http: [rpc] },
  },
  blockExplorers: {
    default: {
      name: "Injective Testnet Blockscout",
      url: explorer,
    },
  },
  testnet: true,
} as const satisfies Chain;

export const config = createConfig({
  // Only Injective — MetaMask must not fall back to Ethereum for writes
  chains: [injectiveEvmTestnet],
  connectors: [
    injected({
      // Prefer the chain we care about when the wallet supports multi-chain
      shimDisconnect: true,
    }),
  ],
  transports: {
    [injectiveEvmTestnet.id]: http(rpc),
  },
  // Disable EIP-6963 multi-provider discovery. When true (the wagmi default),
  // wagmi dispatches `eip6963:requestProvider`, which makes some wallet
  // extensions re-inject `window.ethereum` via Object.defineProperty and throw
  // `TypeError: Cannot redefine property: ethereum` when another provider has
  // already claimed it as non-configurable. This app is single-chain with one
  // injected connector, so we read `window.ethereum` directly instead.
  multiInjectedProviderDiscovery: false,
  ssr: true,
});
