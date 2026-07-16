const EXPLORER =
  process.env.NEXT_PUBLIC_INJ_EVM_EXPLORER ||
  "https://testnet.blockscout.injective.network";

export function explorerAddress(addr: string) {
  return `${EXPLORER}/address/${addr}`;
}

export function explorerTx(hash: string) {
  return `${EXPLORER}/tx/${hash}`;
}

export function getExplorerBase() {
  return EXPLORER;
}
