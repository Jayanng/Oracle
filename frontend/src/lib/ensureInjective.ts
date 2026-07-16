import type { Config } from "wagmi";
import { getAccount, switchChain } from "wagmi/actions";
import { INJECTIVE_EVM_CHAIN_ID, injectiveEvmTestnet } from "./wagmi";

/**
 * Ensure the connected wallet is on Injective EVM (chain 1439), not Ethereum.
 * MetaMask often stays on mainnet/sepolia after connect; without this, stake txs
 * appear as ETH-network transactions.
 */
export async function ensureInjectiveChain(config: Config): Promise<number> {
  const account = getAccount(config);
  const current = account.chainId;

  if (current === INJECTIVE_EVM_CHAIN_ID) {
    return INJECTIVE_EVM_CHAIN_ID;
  }

  try {
    await switchChain(config, { chainId: INJECTIVE_EVM_CHAIN_ID });
    return INJECTIVE_EVM_CHAIN_ID;
  } catch (err) {
    // Wallet may not have Injective added — prompt wallet_addEthereumChain
    const ethereum = (
      typeof window !== "undefined"
        ? (window as Window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } })
            .ethereum
        : undefined
    );

    if (!ethereum?.request) {
      throw new Error(
        `Wrong network (chain ${current ?? "unknown"}). Switch MetaMask to Injective EVM Testnet (chain ${INJECTIVE_EVM_CHAIN_ID}).`
      );
    }

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${INJECTIVE_EVM_CHAIN_ID.toString(16)}` }],
      });
      return INJECTIVE_EVM_CHAIN_ID;
    } catch (switchError: unknown) {
      const code =
        typeof switchError === "object" &&
        switchError &&
        "code" in switchError
          ? Number((switchError as { code: number }).code)
          : 0;

      // 4902 = chain not added to wallet
      if (code === 4902 || code === -32603) {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: `0x${INJECTIVE_EVM_CHAIN_ID.toString(16)}`,
              chainName: injectiveEvmTestnet.name,
              nativeCurrency: injectiveEvmTestnet.nativeCurrency,
              rpcUrls: [...injectiveEvmTestnet.rpcUrls.default.http],
              blockExplorerUrls: [
                injectiveEvmTestnet.blockExplorers.default.url,
              ],
            },
          ],
        });
        return INJECTIVE_EVM_CHAIN_ID;
      }

      throw new Error(
        `Please switch MetaMask to Injective EVM Testnet (chain ${INJECTIVE_EVM_CHAIN_ID}, native gas = INJ). ` +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }
}

export function isInjectiveChain(chainId?: number) {
  return chainId === INJECTIVE_EVM_CHAIN_ID;
}
