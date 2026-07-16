import type { createPublicClient, createWalletClient } from "viem";
import pRetry from "p-retry";
import { ORACLE_ABI } from "./chain.js";

export type SimEvent = {
  minute: number;
  type: string;
  details: Record<string, unknown>;
};

/** Canned Argentina vs France WC final script for demos */
export const DEMO_SCRIPT: SimEvent[] = [
  { minute: 0, type: "kickoff", details: { home: "Argentina", away: "France" } },
  { minute: 12, type: "goal", details: { team: "Argentina", player: "Messi", score: "1-0" } },
  { minute: 34, type: "card", details: { team: "France", player: "Mbappé", kind: "yellow" } },
  { minute: 67, type: "goal", details: { team: "France", player: "Mbappé", score: "1-1" } },
  { minute: 90, type: "final", details: { home: 1, away: 1 } },
];

type Wallet = ReturnType<typeof createWalletClient>;
type Pub = ReturnType<typeof createPublicClient>;

export async function runSimulator(opts: {
  wallet: Wallet;
  pub: Pub;
  oracle: `0x${string}`;
  matchId: bigint;
  intervalMs?: number;
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
  onEvent?: (e: SimEvent, hash: string) => void;
}) {
  const interval = opts.intervalMs ?? 5_000;
  for (const step of DEMO_SCRIPT) {
    const hash = await pRetry(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () =>
        opts.wallet.writeContract({
          address: opts.oracle,
          abi: ORACLE_ABI,
          functionName: "addEvent",
          args: [
            opts.matchId,
            step.minute,
            "football",
            step.type,
            JSON.stringify(step.details),
          ],
        } as any),
      { retries: 3 }
    );
    await opts.pub.waitForTransactionReceipt({ hash });
    opts.log.info({ hash, type: step.type, minute: step.minute }, "simulator event pushed");
    opts.onEvent?.(step, hash);
    await new Promise((r) => setTimeout(r, interval));
  }
  opts.log.info("simulator script complete");
}
