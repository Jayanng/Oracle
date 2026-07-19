import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import type { Chain } from "viem";

/** Injective EVM testnet — NEVER default to Ethereum mainnet (1). */
export const INJECTIVE_EVM_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_INJ_EVM_CHAIN_ID || "1439"
);

export const injRpc =
  process.env.NEXT_PUBLIC_INJ_EVM_RPC ||
  "https://k8s.testnet.json-rpc.injective.network";

const injExplorer =
  process.env.NEXT_PUBLIC_INJ_EVM_EXPLORER ||
  "https://testnet.blockscout.injective.network";

export const injectiveEvmTestnet = {
  id: INJECTIVE_EVM_CHAIN_ID,
  name: "Injective EVM Testnet",
  nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
  rpcUrls: { default: { http: [injRpc] }, public: { http: [injRpc] } },
  blockExplorers: { default: { name: "Injective Testnet Blockscout", url: injExplorer } },
  testnet: true,
} as const satisfies Chain;

/** Sepolia RPC — the old rpc.sepolia.org now 404s; use a reliable public node. */
export const sepoliaRpc =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC ||
  "https://ethereum-sepolia-rpc.publicnode.com";

/** Sepolia testnet — CCTP destination for cross-chain claims. */
export const sepolia = {
  id: 11_155_111,
  name: "Ethereum Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [sepoliaRpc] }, public: { http: [sepoliaRpc] } },
  blockExplorers: { default: { name: "Etherscan", url: "https://sepolia.etherscan.io" } },
  testnet: true,
} as const satisfies Chain;

export const config = createConfig({
  chains: [injectiveEvmTestnet, sepolia],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [injectiveEvmTestnet.id]: http(injRpc),
    [sepolia.id]: http(sepoliaRpc),
  },
  multiInjectedProviderDiscovery: true,
  ssr: true,
});
