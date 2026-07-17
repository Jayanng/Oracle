"use client";

import { useState } from "react";
import {
  useAccount,
  useChainId,
  useConfig,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { parseUnits, pad, type Hex } from "viem";
import { toast } from "sonner";
import {
  REWARDS_ABI,
  REWARDS_ADDRESS,
  USDC_ADDRESS,
  ERC20_ABI,
  CCTP_TOKEN_MESSENGER,
  TOKEN_MESSENGER_ABI,
} from "@/lib/contracts";
import { shortAddr } from "@/lib/utils";
import { explorerTx } from "@/lib/chain";
import { ensureInjectiveChain, isInjectiveChain } from "@/lib/ensureInjective";
import { INJECTIVE_EVM_CHAIN_ID } from "@/lib/wagmi";

// Internal default WC 2022 opener (Qatar vs Ecuador) — not shown as "match id" in UI
const MATCH = 855736;
/** CCTP destination domain only. Source burn is always Injective. */
const SEPOLIA_DOMAIN = 0;

type Step = "idle" | "pending" | "done" | "error" | "sim";

type HistoryItem = {
  id: string;
  kind: "claim" | "cctp" | "x402";
  label: string;
  hash?: string;
  at: string;
  detail?: string;
};

export default function RewardsPage() {
  const { address, isConnected } = useAccount();
  const config = useConfig();
  const chainId = useChainId();
  const pub = usePublicClient();
  const [amount, setAmount] = useState("5");
  const [cctpSim, setCctpSim] = useState(true);
  const [steps, setSteps] = useState<Record<number, Step>>({
    1: "idle",
    2: "idle",
    3: "idle",
    4: "idle",
  });
  const [burnTx, setBurnTx] = useState<string | null>(null);
  const [attestNote, setAttestNote] = useState<string | null>(null);
  const [x402Log, setX402Log] = useState<unknown>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const { writeContractAsync, isPending } = useWriteContract();

  const hasRewards = Boolean(REWARDS_ADDRESS && REWARDS_ADDRESS.length === 42);
  const onInjective = isInjectiveChain(chainId);

  const { data: market } = useReadContract({
    address: hasRewards ? REWARDS_ADDRESS : undefined,
    abi: REWARDS_ABI,
    functionName: "markets",
    args: [BigInt(MATCH)],
    query: { enabled: hasRewards, refetchInterval: 10_000 },
  });

  const { data: userStakes } = useReadContract({
    address: hasRewards && address ? REWARDS_ADDRESS : undefined,
    abi: REWARDS_ABI,
    functionName: "stakes",
    args: address ? [BigInt(MATCH), address] : undefined,
    query: { enabled: Boolean(hasRewards && address) },
  });

  const { data: usdcBal } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const m = market as
    | readonly [bigint, bigint, number, bigint, bigint, bigint, boolean]
    | undefined;
  const totalStaked = m ? Number(m[3] + m[4] + m[5]) / 1e6 : 0;
  const settled = m?.[6] ?? false;
  const resolved = m?.[2] ?? 0;
  const stakes = userStakes as readonly [bigint, bigint, bigint] | undefined;

  function pushHistory(item: Omit<HistoryItem, "id" | "at">) {
    setHistory((h) =>
      [
        {
          ...item,
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          at: new Date().toISOString(),
        },
        ...h,
      ].slice(0, 20)
    );
  }

  async function claim() {
    if (!hasRewards) return toast.error("REWARDS_ADDRESS not set");
    try {
      await ensureInjectiveChain(config);
      const hash = await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: REWARDS_ADDRESS,
        abi: REWARDS_ABI,
        functionName: "claim",
        args: [BigInt(MATCH)],
      });
      toast.success(`Claim tx ${hash.slice(0, 12)}… (Injective)`);
      pushHistory({
        kind: "claim",
        label: "Claim payout",
        hash,
        detail: `match ${MATCH}`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "claim failed");
    }
  }

  async function runCctp() {
    if (!address) return toast.error("Connect wallet");
    const amt = parseUnits(amount, 6);

    try {
      await ensureInjectiveChain(config);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Switch to Injective first");
      return;
    }

    if (cctpSim) {
      setSteps({ 1: "sim", 2: "sim", 3: "sim", 4: "sim" });
      setBurnTx(null);
      setAttestNote("Simulator: no real burn or Circle attestation.");
      try {
        if (hasRewards) {
          const recipient = pad(address as `0x${string}`, { size: 32 });
          const hash = await writeContractAsync({
            chainId: INJECTIVE_EVM_CHAIN_ID,
            address: REWARDS_ADDRESS,
            abi: REWARDS_ABI,
            functionName: "logCrossChainWithdraw",
            args: [BigInt(MATCH), SEPOLIA_DOMAIN, amt, recipient],
          });
          pushHistory({
            kind: "cctp",
            label: "CCTP simulator intent",
            hash,
            detail: `${amount} USDC → Sepolia domain ${SEPOLIA_DOMAIN}`,
          });
        } else {
          pushHistory({
            kind: "cctp",
            label: "CCTP simulator (UI only)",
            detail: "REWARDS_ADDRESS not set",
          });
        }
        toast.success(
          "CCTP simulator: intent logged on Injective (no live attestation wait)"
        );
      } catch (e) {
        toast.message(
          "Simulator UI only — " + (e instanceof Error ? e.message : "")
        );
      }
      return;
    }

    try {
      setSteps({ 1: "pending", 2: "idle", 3: "idle", 4: "idle" });
      setAttestNote(null);
      setBurnTx(null);

      await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CCTP_TOKEN_MESSENGER, amt],
      });
      setSteps((s) => ({ ...s, 1: "done", 2: "pending" }));

      const mintRecipient = pad(address as `0x${string}`, { size: 32 });
      const hash = await writeContractAsync({
        chainId: INJECTIVE_EVM_CHAIN_ID,
        address: CCTP_TOKEN_MESSENGER,
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        args: [amt, SEPOLIA_DOMAIN, mintRecipient, USDC_ADDRESS],
      });

      setBurnTx(hash);
      setSteps((s) => ({ ...s, 2: "done", 3: "pending" }));
      pushHistory({
        kind: "cctp",
        label: "CCTP depositForBurn",
        hash,
        detail: `${amount} USDC on Injective → Sepolia`,
      });
      toast.success(`Burn submitted on Injective ${hash.slice(0, 12)}…`);

      // Batch 2: wait for burn receipt + attestation guidance (safe, non-blocking settle path)
      setAttestNote("Waiting for burn receipt on Injective…");
      try {
        if (pub) {
          await pub.waitForTransactionReceipt({ hash: hash as Hex });
        }
        setSteps((s) => ({ ...s, 3: "done", 4: "pending" }));
        setAttestNote(
          "Burn confirmed on Injective. Circle iris attestation (domain 29 → 0) can take minutes on sandbox. Complete receiveMessage on Sepolia with message bytes from the burn logs when ready."
        );
      } catch (e) {
        setSteps((s) => ({ ...s, 3: "error" }));
        setAttestNote(
          e instanceof Error
            ? e.message
            : "Could not wait for receipt — check burn tx on explorer."
        );
      }
    } catch (e) {
      setSteps((s) => ({ ...s, 1: "error", 2: "error" }));
      toast.error(e instanceof Error ? e.message : "CCTP failed");
    }
  }

  async function x402Demo() {
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: "Get premium stats for Qatar vs Ecuador",
            },
          ],
        }),
      });
      const data = await r.json();
      setX402Log(data);
      const first = Array.isArray(data.trace) ? data.trace[0] : null;
      const result = first?.result as Record<string, unknown> | undefined;
      const x402 = result?._x402 as { transaction?: string } | undefined;
      const tx =
        (typeof x402?.transaction === "string" && x402.transaction) ||
        (typeof result?.hash === "string" && result.hash) ||
        undefined;
      pushHistory({
        kind: "x402",
        label: "Agent x402 premium stats",
        hash: tx,
        detail: data.answer
          ? String(data.answer).slice(0, 120)
          : "premium stats",
      });
      toast.success("x402 premium stats purchased by agent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "x402 demo failed");
    }
  }

  const stepLabel = (s: Step) =>
    s === "done"
      ? "✅"
      : s === "pending"
        ? "⏳"
        : s === "error"
          ? "❌"
          : s === "sim"
            ? "🧪"
            : "○";

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-display text-3xl font-bold">Rewards Center</h1>
        <p className="mt-1 text-ink-muted">
          Stake on match outcomes, claim USDC, bridge via Circle CCTP.
        </p>
        <p className="mt-2 text-xs">
          Active wallet network:{" "}
          <span className={onInjective ? "text-cyan-accent" : "text-amber-300"}>
            {onInjective
              ? `Injective EVM · ${chainId} (gas = INJ, stake = USDC)`
              : `chain ${chainId} — switch to Injective ${INJECTIVE_EVM_CHAIN_ID} before claim/stake`}
          </span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <div className="text-xs text-ink-muted">
            Total staked (match {MATCH})
          </div>
          <div className="font-display text-2xl font-semibold">
            {totalStaked} USDC
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-ink-muted">Your stakes H / D / A</div>
          <div className="font-display text-2xl font-semibold">
            {stakes
              ? `${Number(stakes[0]) / 1e6} / ${Number(stakes[1]) / 1e6} / ${Number(stakes[2]) / 1e6}`
              : "—"}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-ink-muted">USDC balance</div>
          <div className="font-display text-2xl font-semibold">
            {usdcBal != null
              ? `${Number(usdcBal) / 1e6}`
              : isConnected
                ? "…"
                : "connect"}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-4">
          <h2 className="font-display text-lg font-semibold">My positions</h2>
          <div className="text-sm text-ink-muted">
            Market:{" "}
            {settled
              ? `settled (outcome ${resolved})`
              : m?.[1]
                ? "open"
                : "not opened"}
          </div>
          <button
            className="btn-primary"
            disabled={!settled || isPending}
            onClick={claim}
          >
            Claim payout
          </button>
          <p className="text-xs text-ink-muted">
            Open a market from admin/deployer, stake from Dashboard, wait for{" "}
            <code className="text-cyan-accent">final</code> + settle via agent.
          </p>
        </div>

        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">CCTP withdraw</h2>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={cctpSim}
                onChange={(e) => setCctpSim(e.target.checked)}
              />
              Simulator
            </label>
          </div>
          <p className="text-xs text-ink-muted">
            <strong className="text-white">Source burn:</strong> Injective EVM
            (chain {INJECTIVE_EVM_CHAIN_ID}, domain 29) ·{" "}
            <strong className="text-white">Destination mint:</strong> Sepolia
            CCTP domain {SEPOLIA_DOMAIN} only (predictions stay on Injective).
            Messenger {shortAddr(CCTP_TOKEN_MESSENGER)}
          </p>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-ink-border bg-ink px-3 py-2 text-sm"
            placeholder="USDC amount"
          />
          <ol className="space-y-2 text-sm">
            {[
              "Approve USDC → TokenMessenger",
              "depositForBurn on Injective",
              "Poll Circle attestation",
              "receiveMessage on Sepolia",
            ].map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                <span className="w-6 text-center">
                  {stepLabel(steps[i + 1])}
                </span>
                <span
                  className={
                    steps[i + 1] === "done" || steps[i + 1] === "sim"
                      ? "text-white"
                      : "text-ink-muted"
                  }
                >
                  {i + 1}. {label}
                </span>
              </li>
            ))}
          </ol>
          {burnTx && (
            <a
              href={explorerTx(burnTx)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-cyan-accent hover:underline"
            >
              Burn tx {shortAddr(burnTx)}
            </a>
          )}
          {attestNote && (
            <p className="rounded-lg border border-ink-border bg-ink px-3 py-2 text-[11px] text-ink-muted">
              {attestNote}
            </p>
          )}
          <button
            className="btn-primary w-full"
            onClick={runCctp}
            disabled={isPending}
          >
            {cctpSim ? "Run CCTP simulator" : "Start CCTP burn"}
          </button>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-display text-lg font-semibold">x402 demo</h2>
        <p className="text-sm text-ink-muted">
          Agent buys premium stats on Injective via x402 (HTTP 402 → USDC
          payment → data).
        </p>
        <button className="btn-ghost" onClick={x402Demo}>
          Simulate agent buying premium stats
        </button>
        {x402Log != null && (
          <pre className="max-h-48 overflow-auto rounded-lg bg-ink p-3 font-mono text-[11px] text-ink-muted">
            {JSON.stringify(x402Log, null, 2)}
          </pre>
        )}
      </div>

      {/* Batch 3: session history */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Session history</h2>
          {history.length > 0 && (
            <button
              type="button"
              className="text-xs text-ink-muted hover:text-white"
              onClick={() => setHistory([])}
            >
              Clear
            </button>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          Claims, CCTP burns, and x402 demos from this browser session.
        </p>
        {history.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-muted">
            No actions yet.
          </p>
        ) : (
          <ul className="divide-y divide-ink-border text-sm">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <span className="font-medium text-white">{h.label}</span>
                  <span className="ml-2 text-[10px] uppercase text-ink-muted">
                    {h.kind}
                  </span>
                  {h.detail && (
                    <div className="text-xs text-ink-muted">{h.detail}</div>
                  )}
                  <div className="text-[10px] text-ink-muted">
                    {new Date(h.at).toLocaleString()}
                  </div>
                </div>
                {h.hash && (
                  <a
                    href={explorerTx(h.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-cyan-accent"
                  >
                    {shortAddr(h.hash)}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
