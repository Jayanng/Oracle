const EXPLORER =
  process.env.NEXT_PUBLIC_INJ_EVM_EXPLORER ||
  "https://testnet.blockscout.injective.network";

const CCTP_EXPLORERS: Record<number, string> = {
  // domain -> explorer
  0: "https://sepolia.etherscan.io",
  6: "https://sepolia.basescan.org",
  2: "https://sepolia.arbiscan.io",
  1: "https://testnet.snowtrace.io",
};

export function explorerAddress(addr: string, domain?: number) {
  const base = domain != null && CCTP_EXPLORERS[domain] ? CCTP_EXPLORERS[domain] : EXPLORER;
  return `${base}/address/${addr}`;
}

export function explorerTx(hash: string, domain?: number) {
  const base = domain != null && CCTP_EXPLORERS[domain] ? CCTP_EXPLORERS[domain] : EXPLORER;
  return `${base}/tx/${hash}`;
}

export function getExplorerBase() {
  return EXPLORER;
}
